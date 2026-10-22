import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from './types';
import { runCollection, runHousekeeping, DAILY_PROVIDER_SCAN_LIMIT } from './collector';
import { deliverPending } from './delivery';
import { readFreshStartPlan, clearCollectionHistory } from './fresh-start';

/**
 * Single periodic scanner without account-level Cron Triggers.
 * Durable Object alarms are persisted and automatically wake the object.
 */
export const ALARM_INTERVAL_MS=120_000;

export class RadarScheduler extends DurableObject<Bindings> {
 // DO events may interleave across awaits. Prevent overlapping alarm scans
 // without writing per-model D1 leases on every tick.
 private scanning = false;

 async fetch(_request: Request): Promise<Response> {
  if(this.env.COLLECTION_PAUSED==='true'){
   await this.ctx.storage.deleteAlarm();
   return Response.json({armed:false,collection_paused:true});
  }
  const current = Date.now();
  const plan = readFreshStartPlan(this.env, current);
  const next = await this.ctx.storage.getAlarm();
  if (plan && current < plan.startAt) {
   const completed = await this.ctx.storage.get<boolean>('fresh-start:' + plan.id) === true;
   if (current < plan.purgeAt) {
    if (next !== plan.purgeAt) await this.ctx.storage.setAlarm(plan.purgeAt);
   } else if (completed) {
    if (next !== plan.startAt) await this.ctx.storage.setAlarm(plan.startAt);
   } else if (next === null || next > current + ALARM_INTERVAL_MS) {
    await this.ctx.storage.setAlarm(current + ALARM_INTERVAL_MS);
   }
   return Response.json({armed:true,collection_paused:true,reset_completed:completed,start_at:new Date(plan.startAt).toISOString()});
  }
  // Move old 15-minute alarms forward after upgrading the scanner.
  if (next === null || next > current + ALARM_INTERVAL_MS) {
   await this.ctx.storage.setAlarm(current + 1_000);
   return Response.json({armed:true,reason:next === null ? 'initial' : 'cadence_updated'});
  }
  // Retry an unsuccessful initial catalogue sync no more than once per minute.
  const lastRetry = await this.ctx.storage.get<number>('bootstrapRetryAt') ?? 0;
  if (current - lastRetry > ALARM_INTERVAL_MS) {
   const state = await this.env.DB.prepare("SELECT last_success FROM sync_state WHERE name='catalog'")
    .first<{last_success:number}>();
   if (!state?.last_success) {
    await this.ctx.storage.put('bootstrapRetryAt',current);
    await this.ctx.storage.setAlarm(current+1_000);
    return Response.json({armed:true,reason:'first_sync_retry'});
   }
  }
  return Response.json({armed:true,next_alarm:next});
 }

 async alarm(): Promise<void> {
  if(this.env.COLLECTION_PAUSED==='true'){
   await this.ctx.storage.deleteAlarm();
   return;
  }
  const current = Date.now();
  const plan = readFreshStartPlan(this.env, current);
  if (plan) {
   if (current < plan.purgeAt) {
    await this.ctx.storage.setAlarm(plan.purgeAt);
    return;
   }
   const resetKey = 'fresh-start:' + plan.id;
   if (await this.ctx.storage.get<boolean>(resetKey) !== true) {
    try {
     await clearCollectionHistory(this.env.DB);
     // Mark complete only after *all* table deletes and watermarks succeed.
     await this.ctx.storage.put(resetKey,true);
     console.log('Fresh-start historical data discarded; awaiting collection start',plan.id);
    } catch (error) {
     // No collection is allowed with a partially reset database.
     console.error('Fresh-start cleanup failed; will retry, scans remain paused',error);
     await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
     return;
    }
   }
   if (Date.now() < plan.startAt) {
    await this.ctx.storage.setAlarm(plan.startAt);
    return;
   }
  }
  // Arm the next alarm first, including when upstream errors occur.
  await this.ctx.storage.setAlarm(Date.now()+ALARM_INTERVAL_MS);
  if (this.scanning) return;
  this.scanning = true;
  try {
   // Daily scan budget lives in DO storage, avoiding D1 writes for accounting.
   const day = Math.floor(Date.now()/86_400_000);
   const budget = await this.ctx.storage.get<{day:number;used:number}>('providerScanBudget');
   const used = budget?.day===day?budget.used:0;
   await runCollection(this.env,Math.max(0,DAILY_PROVIDER_SCAN_LIMIT-used),async attempted=>{
    // Reserve BEFORE model scans; a failed scan still consumes a budget slot.
    await this.ctx.storage.put('providerScanBudget',{day,used:used+attempted});
   });
   // DO storage (not D1) tracks completion and retries on the next alarm.
   if ((await this.ctx.storage.get<number>('housekeepingDay')) !== day) {
    await runHousekeeping(this.env);
    await this.ctx.storage.put('housekeepingDay',day);
   }
   await deliverPending(this.env);
  } catch (error) {
   console.error('Radar scheduler failed, will retry on next alarm',error);
  } finally {
   this.scanning = false;
  }
 }
}

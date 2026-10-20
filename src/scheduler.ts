import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from './types';
import { runCollection } from './collector';
import { deliverPending } from './delivery';

/**
 * Single periodic scanner without account-level Cron Triggers.
 * Durable Object alarms are persisted and automatically wake the object.
 */
export const ALARM_INTERVAL_MS=60_000;

export class RadarScheduler extends DurableObject<Bindings> {
 async fetch(_request: Request): Promise<Response> {
  const current=Date.now();
  const next=await this.ctx.storage.getAlarm();
  // Move old 15-minute alarms forward after upgrading the scanner.
  if(next===null || next>current+ALARM_INTERVAL_MS) {
   await this.ctx.storage.setAlarm(current+1_000);
   return Response.json({armed:true,reason:next===null?'initial':'cadence_updated'});
  }
  // After a failed first catalogue sync, retry early but never more than once
  // per minute, even if public health checks are frequently requested.
  const lastRetry=await this.ctx.storage.get<number>('bootstrapRetryAt')??0;
  if(current-lastRetry>ALARM_INTERVAL_MS) {
   const state=await this.env.DB.prepare("SELECT last_success FROM sync_state WHERE name='catalog'")
    .first<{last_success:number}>();
   if(!state?.last_success) {
    await this.ctx.storage.put('bootstrapRetryAt',current);
    await this.ctx.storage.setAlarm(current+1_000);
    return Response.json({armed:true,reason:'first_sync_retry'});
   }
  }
  return Response.json({armed:true,next_alarm:next});
 }
 async alarm(): Promise<void> {
  // Arm the next alarm first, including when upstream errors occur.
  await this.ctx.storage.setAlarm(Date.now()+ALARM_INTERVAL_MS);
  try {
   await runCollection(this.env);
   await deliverPending(this.env);
  } catch (error) {
   console.error('Radar scheduler failed, will retry on next alarm',error);
  }
 }
}

import { DurableObject } from 'cloudflare:workers';
import type { Bindings } from './types';
import { runCollection } from './collector';
import { deliverPending } from './delivery';

/**
 * Single periodic scanner without account-level Cron Triggers.
 * Durable Object alarms are persisted and automatically wake the object.
 */
export class RadarScheduler extends DurableObject<Bindings> {
 async fetch(_request: Request): Promise<Response> {
  const next=await this.ctx.storage.getAlarm();
  if (next===null) await this.ctx.storage.setAlarm(Date.now()+1_000);
  return Response.json({armed:true,next_alarm:next??Date.now()+1_000});
 }
 async alarm(): Promise<void> {
  // Arm the next alarm first, including when upstream errors occur.
  await this.ctx.storage.setAlarm(Date.now()+15*60*1000);
  try {
   await runCollection(this.env);
   await deliverPending(this.env);
  } catch (error) {
   console.error('Radar scheduler failed, will retry on next alarm',error);
  }
 }
}

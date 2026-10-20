import assert from 'node:assert/strict';
import test from 'node:test';
import { clearCollectionHistory, readFreshStartPlan } from '../src/fresh-start';

const settings = {
 APP_ORIGIN: 'https://radar.example',
 FRESH_START_INSTANCE: 'https://radar.example',
 FRESH_START_ID: 'fresh-start-test',
 FRESH_START_PURGE_AT: '2026-10-21T00:10:00Z',
 FRESH_START_START_AT: '2026-10-21T01:00:00Z',
};

test('one-time restart pauses through cleanup and starts exactly at 10:00 JST',()=>{
 const plan = readFreshStartPlan(settings,Date.parse('2026-10-20T10:00:00Z'));
 assert.equal(plan?.purgeAt,Date.parse('2026-10-21T00:10:00Z'));
 assert.equal(plan?.startAt,Date.parse('2026-10-21T01:00:00Z'));
 assert.equal(new Date(plan!.startAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}),'10:00');
});

test('reset cannot silently run in another self-hosted instance or long after the cutoff',()=>{
 assert.equal(readFreshStartPlan({...settings,APP_ORIGIN:'https://different.example'}),null);
 assert.equal(readFreshStartPlan(settings,Date.parse('2026-10-23T01:00:00Z')),null);
 assert.equal(readFreshStartPlan({...settings,FRESH_START_ID:undefined}),null);
});

test('cleanup deletes snapshots only and resets synchronisation watermarks',async()=>{
 const statements:string[]=[];
 const db = {prepare:(sql:string)=>({
  first:async()=>({n:0}),
  run:async()=>{statements.push(sql);return {};}
 })} as unknown as D1Database;
 await clearCollectionHistory(db);
 assert.deepEqual(statements,[
  'DELETE FROM channel_deliveries','DELETE FROM notifications','DELETE FROM price_events',
  'DELETE FROM price_observations','DELETE FROM price_history','DELETE FROM endpoints',
  'DELETE FROM collection_jobs','DELETE FROM models',
  'UPDATE sync_state SET last_success=0,leased_until=0,last_error=NULL'
 ]);
 assert.ok(statements.every(sql=>!sql.includes('users')&&!sql.includes('d1_migrations')));
});

test('cleanup refuses to cascade-delete existing subscriptions',async()=>{
 let wrote = false;
 const db = {prepare:(_sql:string)=>({
  first:async()=>({n:1}),
  run:async()=>{wrote=true;return {};}
 })} as unknown as D1Database;
 await assert.rejects(clearCollectionHistory(db),/subscriptions exist/);
 assert.equal(wrote,false);
});

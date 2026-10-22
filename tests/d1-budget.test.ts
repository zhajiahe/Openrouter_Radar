import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicCacheSeconds } from '../src/public-cache';
import { refreshCatalog, runCollection, DAILY_PROVIDER_SCAN_LIMIT } from '../src/collector';
import type { Bindings } from '../src/types';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('only anonymous public read endpoints are cacheable',()=>{
 assert.equal(publicCacheSeconds('/api/models'),120);
 assert.equal(publicCacheSeconds('/api/events'),60);
 assert.equal(publicCacheSeconds('/api/provider-stability'),120);
 for(const route of ['/api/auth/me','/api/health','/api/subscriptions','/api/notifications','/api/events/export','/api/unknown'])
  assert.equal(publicCacheSeconds(route),0);
 const app=read('src/index.ts');
 assert.match(app,/c.req.header\('cookie'\)/);
 assert.match(app,/c.req.header\('authorization'\)/);
});

test('scanner does not lease-write every Provider and does housekeeping daily',()=>{
 const scanner=read('src/collector.ts');
 const scheduler=read('src/scheduler.ts');
 assert.doesNotMatch(scanner,/UPDATE collection_jobs SET leased_until=/);
 assert.match(scanner,/previous:chosen\?\?null/);
 assert.match(scanner,/export async function runHousekeeping/);
 assert.match(scheduler,/housekeepingDay/);
 assert.match(scheduler,/runHousekeeping\(this.env\)/);
});

test('unchanged catalog does not rewrite models, aggregate endpoints or jobs',async()=>{
 const modelsRaw={prompt:'0.000001',completion:'0.000002'};
 const old={
  id:'demo/a',name:'A',description:'',pricing_json:JSON.stringify(modelsRaw),
  context_length:null,capabilities_json:'{}',expiration_date:null,alias_target:null,
  model_kind:'standard',lifecycle_status:'active',missing_count:0
 };
 const batches:{sql:string;args:unknown[]}[][]=[];
 const db={
  prepare(sql:string){return {bind(...args:unknown[]){return {sql,args,
   async all(){
    if(sql.includes('FROM models WHERE id>?'))return {results:[old]};
    throw new Error('Unexpected all: '+sql);
   },
   async first(){if(sql.includes('FROM sync_state'))return {last_success:123};throw new Error('Unexpected first: '+sql);},
   async run(){return {meta:{changes:1}};}
  };}};},
  async batch(stmts:{sql:string;args:unknown[]}[]){batches.push(stmts);return stmts.map(()=>({success:true}));}
 };
 const env={DB:db,OPENROUTER_API_KEY:'test'} as unknown as Bindings;
 const checked=await refreshCatalog(env,async()=>[{id:'demo/a',name:'A',pricing:modelsRaw}]);
 assert.equal(checked,1);
 assert.deepEqual(batches,[]);
});

test('daily provider quota is enforced in the singleton alarm before running scans',()=>{
 const worker=read('src/scheduler.ts');
 const collector=read('src/collector.ts');
 const config=JSON.parse(read('wrangler.jsonc'));
 assert.equal(DAILY_PROVIDER_SCAN_LIMIT,4_000);
 assert.equal(config.vars.MAX_MODELS_PER_TICK,'6');
 assert.equal(config.vars.COLLECTION_PAUSED,'false');
 assert.deepEqual(Object.keys(config.vars).filter(key=>key.startsWith('FRESH_START_')),[]);
 assert.match(worker,/providerScanBudget/);
 assert.match(worker,/deleteAlarm\(\)/);
 assert.match(collector,/if\(attempted&&reserveScans\)await reserveScans\(attempted\)/);
});

test('an exhausted daily quota skips Provider job selection but can replay events',async()=>{
 const sqlCalls:string[]=[];
 const db={
  prepare(sql:string){sqlCalls.push(sql);return {
   bind(){return this;},
   async run(){return {meta:{changes:0}};},
   async all(){return {results:[]};}
  };}
 } as unknown as D1Database;
 const env={DB:db} as unknown as Bindings;
 assert.equal(await runCollection(env,0),0);
 assert.ok(sqlCalls.some(sql=>sql.includes('FROM price_events')));
 assert.ok(!sqlCalls.some(sql=>sql.includes('FROM collection_jobs j')));
});

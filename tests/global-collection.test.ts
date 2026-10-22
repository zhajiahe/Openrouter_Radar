import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOG_INTERVAL_SECONDS, PROVIDER_INTERVAL_SECONDS, modelsPerTick, refreshCatalog } from '../src/collector';
import type { Bindings } from '../src/types';

const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('hourly global scanner stays within per-invocation budget and ignores subscriptions',()=>{
 assert.equal(CATALOG_INTERVAL_SECONDS,3600);
 assert.equal(PROVIDER_INTERVAL_SECONDS,3600);
 assert.match(source('src/scheduler.ts'),/ALARM_INTERVAL_MS=120_000/);
 assert.equal(modelsPerTick(),6);
 assert.equal(modelsPerTick('5'),5);
 assert.equal(modelsPerTick('999'),6);
 assert.equal(modelsPerTick('-1'),6);
 assert.equal(modelsPerTick('bad number'),6);
 const collector=source('src/collector.ts');
 assert.match(collector,/FROM collection_jobs j JOIN models m/);
 assert.doesNotMatch(collector,/collection_jobs j JOIN subscriptions/);
 assert.match(collector,/INSERT OR IGNORE INTO collection_jobs\(model_id\)/);
 const app=source('src/index.ts');
 assert.doesNotMatch(app,/INSERT OR IGNORE INTO collection_jobs\(model_id\)/);
});

test('catalog creates collection jobs for all new models without a subscription',async()=>{
 const batches:Array<Array<{sql:string;args:unknown[]}>>=[];
 let success=false;
 const db={
  prepare(sql:string){
   return {sql,bind(...args:unknown[]){
    return {sql,args,
     async first(){if(sql.includes('FROM sync_state'))return {last_success:0};throw new Error('Unexpected first: '+sql);},
     async run(){if(sql.includes('UPDATE sync_state SET last_success'))success=true;return {meta:{changes:1}};},
     async all(){if(sql.includes('FROM models WHERE id>?'))return {results:[]};throw new Error('Unexpected SQL: '+sql);}
    };
   }};
  },
  async batch(stmts:Array<{sql:string;args:unknown[]}>){batches.push(stmts);return stmts.map(()=>({success:true}));}
 };
 const env={DB:db,OPENROUTER_API_KEY:'test-only'} as unknown as Bindings;
 const result=await refreshCatalog(env,async()=>[
  {id:'demo/a',name:'A',pricing:{prompt:'0.000001',completion:'0.000002'}},
  {id:'demo/b',name:'B',pricing:{prompt:'0.000003',completion:'0.000004'}}
 ]);
 assert.equal(result,2);
 assert.equal(success,true);
 const stmts=batches.flat();
 assert.deepEqual(stmts.filter(x=>x.sql.includes('INSERT OR IGNORE INTO collection_jobs')).map(x=>x.args[0]),['demo/a','demo/b']);
 assert.equal(stmts.filter(x=>x.sql.includes('INSERT OR IGNORE INTO price_events')).length,0);
 assert.equal(stmts.filter(x=>x.sql.includes('INSERT INTO endpoints')).length,2);
});

test('migration enqueues existing models independent of user subscriptions',()=>{
 assert.match(source('migrations/0003_global_collection.sql'),/INSERT OR IGNORE INTO collection_jobs\(model_id\)\s+SELECT id FROM models/);
});

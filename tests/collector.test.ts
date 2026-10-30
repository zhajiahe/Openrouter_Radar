import test from 'node:test';
import assert from 'node:assert/strict';
import {matchUnmatchedEvents} from '../src/collector';
import type {Bindings} from '../src/types';

type Row=Record<string,unknown>;
function stubDb(events:Row[],subscriptions:Row[]) {
 const executed:{sql:string;args:unknown[]}[][]=[];
 const queries:string[]=[];
 const db={
  prepare(sql:string){
   queries.push(sql);
   return {
    bind(...args:unknown[]){
     return {
      sql,args,
      async all(){
       if(sql.includes('FROM price_events'))return {results:events};
       if(sql.includes('FROM subscriptions'))return {results:subscriptions};
       throw new Error('unexpected query: '+sql);
      }
     };
    }
   };
  },
  async batch(stmts:{sql:string;args:unknown[]}[]){
   executed.push(stmts);
   return stmts.map(()=>({success:true}));
  }
 };
 return {env:{DB:db} as unknown as Bindings,executed,queries};
}
const event={id:'evt1',model_id:'sample/model',provider:'Provider A',kind:'price.decreased',dimension:'input',change_pct:-25,created_at:1792390000};
const sub=(id:string,provider:string|null,threshold_pct:number,events_json='["price.decreased"]')=>({
 id,user_id:id,provider,threshold_pct,events_json,frequency:'instant'
});
test('unmatched events are replayed, filtered, queued and watermarked atomically',async()=>{
 const {env,executed}=stubDb([event],[
  {...sub('matching-dimension',null,15),price_dimension:'input'},
  {...sub('wrong-dimension',null,15),price_dimension:'cache_read'},
  sub('too-high',null,30),
  sub('wrong-provider','Provider B',0),
  sub('wrong-kind',null,0,'["price.increased"]')
 ]);
 assert.equal(await matchUnmatchedEvents(env),1);
 assert.equal(executed.length,1);
 assert.equal(executed[0].length,2);
 assert.match(executed[0][0].sql,/INSERT OR IGNORE INTO notifications/);
 assert.equal(executed[0][0].args[1],'matching-dimension');
 assert.equal(executed[0][0].args[2],'evt1');
 assert.match(executed[0][1].sql,/matched_at/);
 assert.equal(executed[0][1].args[1],'evt1');
});
test('unmatched events with no subscribers still advance the replay watermark',async()=>{
 const {env,executed}=stubDb([event],[]);
 assert.equal(await matchUnmatchedEvents(env),1);
 assert.equal(executed[0].length,1);
 assert.match(executed[0][0].sql,/UPDATE price_events/);
});

test('subscription price dimensions do not suppress independent lifecycle events',async()=>{
 const incident={...event,id:'evt2',kind:'endpoint.added',dimension:null,change_pct:null};
 const {env,executed}=stubDb([incident],[{...sub('subscriber',null,0,'["endpoint.added"]'),price_dimension:'cache_read'}]);
 assert.equal(await matchUnmatchedEvents(env),1);
 assert.equal(executed[0].length,2);
 assert.equal(executed[0][0].args[1],'subscriber');
});

test('empty unmatched replay uses the selective partial index without follow-up queries',async()=>{
 const {env,executed,queries}=stubDb([],[]);
 assert.equal(await matchUnmatchedEvents(env,25),0);
 assert.equal(queries.length,1);
 assert.match(queries[0],/FROM price_events INDEXED BY idx_events_unmatched_observed WHERE matched_at IS NULL AND quality='observed' ORDER BY created_at ASC LIMIT \\?/);
 assert.deepEqual(executed,[]);
});

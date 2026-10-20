import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyStatements, missingHistoryStatements, imageHistoryStatements, safeCollectionError } from '../src/history';
import type { Bindings } from '../src/types';
import { parsePrices } from '../src/pricing';

test('price history writes only new observations, never simulated hourly duplicates',()=>{
 const calls:{sql:string;args:unknown[]}[]=[];
 const env={DB:{prepare:(sql:string)=>({bind:(...args:unknown[])=>{
  calls.push({sql,args});return {sql,args};
 }})}} as unknown as Bindings;
 const price=parsePrices({prompt:'0.000001',completion:'0.000002'});
 const baseline=historyStatements(env,'endpoint','author/model','Provider','provider',price,null,12345);
 assert.equal(baseline.length,2);
 assert.equal(calls[0].args[4],'input');
 assert.equal(calls[0].args[5],'USD/token');
 assert.equal(calls[0].args[7],12345);
 assert.deepEqual(historyStatements(env,'endpoint','author/model','Provider','provider',price,price,20000),[]);
 const next=parsePrices({prompt:'0.000003',completion:'0.000002'});
 assert.equal(historyStatements(env,'endpoint','author/model','Provider','provider',next,price,20001).length,1);
 assert.equal(calls.at(-1)?.args[4],'input');
});
test('public collection errors never leak upstream URLs or operator API keys',()=>{
 assert.equal(safeCollectionError('OpenRouter API HTTP 429'), 'Upstream HTTP 429');
 assert.equal(safeCollectionError('abort: timed out'), 'Upstream request timed out');
 assert.equal(safeCollectionError('bad endpoint https://private.example/key=secret'), 'Upstream collection failed');
 assert.equal(safeCollectionError(null),null);
});

test('legacy price histories are seeded only when missing, with the actual scan timestamp',()=>{
 const queries:{sql:string;args:unknown[]}[]=[];
 const env={DB:{prepare:(sql:string)=>({bind:(...args:unknown[])=>{
  queries.push({sql,args});return {sql,args};
 }})}} as unknown as Bindings;
 const price=parsePrices({prompt:'0.0000015',completion:'0.000003'});
 const stmts=missingHistoryStatements(env,'ep1','author/model','Provider','provider',price,1792400000);
 assert.equal(stmts.length,2);
 assert.match(queries[0].sql,/NOT EXISTS/);
 assert.equal(queries[0].args[7],1792400000);
 assert.equal(queries[0].args[8],'ep1');
 assert.equal(queries[1].args[9],'output');
});

test('cache, auxiliary and image rates have independent observed units and never fabricate past points',()=>{
 const calls:{sql:string;args:unknown[]}[]=[];
 const env={DB:{prepare:(sql:string)=>({bind:(...args:unknown[])=>{
  calls.push({sql,args});return {sql,args};
 }})}} as unknown as Bindings;
 const before=parsePrices({prompt:'0.000001',input_cache_read:'0.0000001',request:'0.02'});
 const after=parsePrices({prompt:'0.000001',input_cache_read:'0.0000002',request:'0.02',audio_output:'0.04'});
 const baseline=historyStatements(env,'ep','m','provider','provider',before,null,100);
 assert.equal(baseline.length,3);
 assert.deepEqual(calls.map(c=>[c.args[4],c.args[5]]),[
  ['input','USD/token'],['cache_read','USD/token'],['request','USD/request']
 ]);
 calls.length=0;
 const delta=historyStatements(env,'ep','m','provider','provider',after,before,200);
 assert.equal(delta.length,2);
 assert.deepEqual(calls.map(c=>c.args[4]),['cache_read','audio_output']);
 const image=imageHistoryStatements(env,'img','m','provider',[
  {billable:'output_image',unit:'image',cost_usd:'0.03',conditions:'{}'}
 ],null,300);
 assert.equal(image.length,1);
 assert.equal(calls.at(-1)?.args[4],'image/output_image/image');
 assert.equal(calls.at(-1)?.args[5],'USD/image');
 assert.equal(calls.at(-1)?.args[7],300);
});

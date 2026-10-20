import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyStatements, safeCollectionError } from '../src/history';
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
 assert.equal(calls[0].args[6],12345);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {modelState,modelDeltas,expiryWindow} from '../src/phase3';
import {findPriceChanges,parsePrices} from '../src/pricing';

test('model capabilities normalize parameter and architecture ordering',()=>{
 const old=modelState({id:'test/m',name:'Test',supported_parameters:['tools','temperature'],architecture:{input_modalities:['image','text']}} as any);
 const next=modelState({id:'test/m',name:'Test',supported_parameters:['temperature','tools'],architecture:{input_modalities:['text','image']}} as any,old);
 assert.deepEqual(modelDeltas(old,next),[]);
});
test('a partial model payload preserves previously observed fields',()=>{
 const old=modelState({id:'test/m',name:'Test',expiration_date:1793000000,alias_target:'test/real',context_length:16000} as any);
 assert.deepEqual(modelDeltas(old,modelState({id:'test/m',name:'Test'} as any,old)),[]);
});
test('context, alias and expiration changes are individually detected',()=>{
 const old=modelState({id:'test/m',name:'Test',context_length:8000,alias_target:'test/one',expiration_date:1793000000} as any);
 const next=modelState({id:'test/m',name:'Test',context_length:16000,alias_target:'test/two',expiration_date:1794000000} as any,old);
 assert.deepEqual(modelDeltas(old,next).map(x=>x.kind),['model.context_changed','model.expiration_changed','model.alias_changed']);
});
test('expiry windows are exclusive and do not treat expired models as upcoming',()=>{
 const n=100000000;
 assert.equal(expiryWindow(n+29*86400,n),30);
 assert.equal(expiryWindow(n+6*86400,n),7);
 assert.equal(expiryWindow(n+3600,n),1);
 assert.equal(expiryWindow(n-1,n),null);
});
test('cache prices and overrides use canonical, decimal-safe comparisons',()=>{
 const old=parsePrices({prompt:'0.1',completion:'0.2',input_cache_read:'1e-8',overrides:[{min_prompt_tokens:200000,pricing:{prompt:'0.2'}}]});
 const next=parsePrices({prompt:'0.10',completion:'0.2',input_cache_read:'0.00000002',overrides:[{pricing:{prompt:'0.3'},min_prompt_tokens:200000}]});
 const deltas=findPriceChanges(old,next);
 assert.deepEqual(deltas.map(x=>[x.kind,x.dimension]),[['price.increased','cache_read'],['price.policy_changed','overrides']]);
});
test('introduced price dimension produces policy change, not a synthetic zero-dollar increase',()=>{
 const changes=findPriceChanges(parsePrices({prompt:'0.1'}),parsePrices({prompt:'0.1',input_cache_write:'0.00002'}));
 assert.equal(changes.length,1);
 assert.equal(changes[0].kind,'price.policy_changed');
 assert.equal(changes[0].dimension,'cache_write');
});

test('object alias targets from OpenRouter use their routable slug',()=>{
 const state=modelState({id:'alias/entry',name:'Entry',alias_target:{slug:'vendor/actual',name:'Actual'}} as any);
 assert.equal(state.alias_target,'vendor/actual');
 const same=modelState({id:'alias/entry',name:'Entry',alias_target:{name:'Renamed',slug:'vendor/actual'}} as any,state);
 assert.deepEqual(modelDeltas(state,same),[]);
});

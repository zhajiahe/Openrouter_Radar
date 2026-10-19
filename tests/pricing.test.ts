import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePrice,parsePrices,findPriceChanges,thresholdMatches,endpointId} from '../src/pricing';

test('decimal normalization preserves tiny prices without Number rounding',()=>{
 assert.equal(normalizePrice('0.000000000003'),'0.000000000003');
 assert.equal(normalizePrice('1e-9'),'0.000000001');
 assert.equal(normalizePrice(0),'0');
 assert.equal(normalizePrice(null),null);
 assert.equal(normalizePrice('-0.01'),null);
 assert.equal(normalizePrice('free'),null);
});
test('input and output changes are independent and carry correct signs',()=>{
 const old=parsePrices({prompt:'0.000002',completion:'0.000004'});
 const next=parsePrices({prompt:'0.000001',completion:'0.000006'});
 const changes=findPriceChanges(old,next);
 assert.deepEqual(changes.map(x=>[x.dimension,x.kind,x.percent]),[
  ['input','price.decreased',-50],['output','price.increased',50]
 ]);
});
test('unknown prices are not treated as free',()=>{
 assert.deepEqual(findPriceChanges(parsePrices({prompt:null}),parsePrices({prompt:'0.01'})),[]);
 assert.deepEqual(findPriceChanges(parsePrices({prompt:'0'}),parsePrices({prompt:'0.01'})).map(x=>x.percent),[null]);
 assert.equal(thresholdMatches(null,5),false);
 assert.equal(thresholdMatches(null,0),true);
});
test('identical snapshots do not emit events',()=>{
 assert.deepEqual(findPriceChanges(parsePrices({prompt:'0.1'}),parsePrices({prompt:'0.10'})),[]);
});
test('endpoint identities are stable and model-specific',async()=>{
 assert.equal(await endpointId('a/m','P','tag'),await endpointId('a/m','P','tag'));
 assert.notEqual(await endpointId('a/m','P','tag'),await endpointId('b/m','P','tag'));
});

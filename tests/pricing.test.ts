import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePrice,parsePrices,findPriceChanges,thresholdMatches,endpointId,observedPrices} from '../src/pricing';

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

test('discount changes do not generate upside/downside price alarms',()=>{
 const previous=parsePrices({prompt:'0.000001',discount:0.45});
 const current=parsePrices({prompt:'0.000001',discount:0});
 const changes=findPriceChanges(previous,current);
 assert.deepEqual(changes.map(x=>[x.kind,x.dimension,x.percent]),[['price.policy_changed','discount',null]]);
});
test('unknown numeric pricing fields remain policy changes until their billing semantics are known',()=>{
 const changes=findPriceChanges(parsePrices({prompt:'0.000001',special_fee:'0.1'}),parsePrices({prompt:'0.000001',special_fee:'0.2'}));
 assert.equal(changes.length,1);
 assert.equal(changes[0].kind,'price.policy_changed');
 assert.equal(changes[0].dimension,'special_fee');
});
test('non-numeric nested policy changes are not silently ignored',()=>{
 const changes=findPriceChanges(parsePrices({prompt:'0.000001',tiers:{large:'0.9'}}),parsePrices({prompt:'0.000001',tiers:{large:'0.8'}}));
 assert.deepEqual(changes.map(x=>[x.kind,x.dimension]),[['price.policy_changed','tiers']]);
});

test('cache read/write, audio cache and image output are monetary dimensions with native units',()=>{
 const old=parsePrices({input_cache_read:'0.000001',input_cache_write:'0.000002',input_cache_write_1h:'0.000003',input_audio_cache:'0.000004',audio_output:'0.01',image_output:'0.02'});
 const next=parsePrices({input_cache_read:'0.000002',input_cache_write:'0.000001',input_cache_write_1h:'0.000006',input_audio_cache:'0.000003',audio_output:'0.02',image_output:'0.01'});
 assert.deepEqual(findPriceChanges(old,next).map(x=>x.dimension),['audio_output','cache_read','cache_write','cache_write_1h','image_output','input_audio_cache']);
 const units=Object.fromEntries(observedPrices(next).map(p=>[p.dimension,p.unit]));
 assert.equal(units.cache_read,'USD/token');
 assert.equal(units.audio_output,'USD/second');
 assert.equal(units.image_output,'USD/image');
});
test('unchanged scheduled UTC pricing is not announced as unconditional price increase',()=>{
 const overrides=[{utc_start:800,utc_end:1600,prompt:'0.000002'}];
 const before=parsePrices({prompt:'0.000001',overrides});
 const after=parsePrices({prompt:'0.000002',overrides});
 assert.deepEqual(findPriceChanges(before,after).map(c=>[c.kind,c.dimension]),[['price.policy_changed','scheduled_input']]);
});

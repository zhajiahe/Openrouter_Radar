import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeProviderPriceStability,type ProviderEndpoint,type PriceObservation} from '../src/provider-stability';

const at=Date.parse('2026-10-20T12:00:00Z')/1000;
const since=at-30*86400;
const ep=(id:string,provider:string,last_success=at-3600):ProviderEndpoint=>({id,provider,tag:'default',last_success});
const point=(endpoint_id:string,price:string,observed_at:number,unit='USD/token'):PriceObservation=>({
 endpoint_id,dimension:'input',unit,price,observed_at
});
test('stability compares real price-change endpoint-days for the same model and charge',()=>{
 const result=summarizeProviderPriceStability([
  ep('a','Alpha'),ep('b','Alpha'),ep('c','Beta')
 ],[
  point('a','0.000001',since-100),point('a','0.000002',since+86400),point('a','0.000003',since+86400+1800),
  point('b','0.000001',since-300),point('c','0.000001',since-300),
  point('c','0.000001',since+86400*2)
 ],30,at);
 assert.equal(result[0].provider,'Beta');
 assert.equal(result[0].stableDayRate,100);
 const alpha=result[1];
 assert.equal(alpha.status,'ready');
 assert.equal(alpha.changeCount,2);
 assert.equal(alpha.increaseCount,2);
 assert.equal(alpha.decreaseCount,0);
 assert.equal(alpha.changedEndpointDays,1);
 assert.ok(Math.abs((alpha.stableDayRate||0)-98.333333)<0.001);
 assert.equal(alpha.maxIncreasePct,100);
 assert.equal(alpha.coveredEndpoints,2);
 assert.equal(alpha.freshEndpoints,2);
});
test('insufficient history and stale collections do not receive a misleading stability score',()=>{
 const result=summarizeProviderPriceStability([
  ep('new','New'),ep('old','Stale',at-8*3600)
 ],[
  point('new','0.1',since+86400),point('old','0.1',since-120)
 ],30,at);
 const byProvider=Object.fromEntries(result.map(row=>[row.provider,row]));
 assert.equal(byProvider.New.status,'insufficient');
 assert.equal(byProvider.New.stableDayRate,null);
 assert.equal(byProvider.Stale.status,'stale');
 assert.equal(byProvider.Stale.stableDayRate,null);
});
test('different image pricing units cannot be pooled into a score',()=>{
 const result=summarizeProviderPriceStability([ep('img','Image Provider')],[
  point('img','0.03',since-100,'USD/image'),
  point('img','0.03',since+500,'USD/megapixel')
 ],30,at);
 assert.equal(result[0].status,'insufficient');
 assert.equal(result[0].stableDayRate,null);
});
test('changes outside requested window are not counted as instability',()=>{
 const baselineTime=at-40*86400;
 const result=summarizeProviderPriceStability([ep('x','Gamma')],[
  point('x','0.1',baselineTime),point('x','0.2',since-50)
 ],30,at);
 assert.equal(result[0].status,'ready');
 assert.equal(result[0].stableDayRate,100);
 assert.equal(result[0].changeCount,0);
});

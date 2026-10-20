import test from 'node:test';
import assert from 'node:assert/strict';
import {imageCharges,findImagePriceChanges,imageRaw,storedImageCharges} from '../src/image-pricing';

test('image price changes compare identical billing units only',()=>{
 const before=imageCharges([{billable:'output_image',unit:'image',cost_usd:0.05}]);
 const after=imageCharges([{billable:'output_image',unit:'image',cost_usd:'0.03'}]);
 assert.deepEqual(findImagePriceChanges(before,after).map(x=>[x.kind,x.dimension,x.percent]),[
  ['image.price_decreased','image/output_image/image',-40]
 ]);
});
test('changing per-image to per-megapixel is not claimed as a discount',()=>{
 const before=imageCharges([{billable:'output_image',unit:'image',cost_usd:0.05}]);
 const after=imageCharges([{billable:'output_image',unit:'megapixel',cost_usd:0.03}]);
 assert.deepEqual(findImagePriceChanges(before,after).map(x=>x.kind),[
  'image.price_policy_changed','image.price_policy_changed'
 ]);
});
test('conditions identify distinct image pricing tiers',()=>{
 const before=imageCharges([
  {billable:'output_image',unit:'image',cost_usd:'0.02',quality:'standard'},
  {billable:'output_image',unit:'image',cost_usd:'0.04',quality:'high'}
 ]);
 const after=imageCharges([
  {billable:'output_image',unit:'image',cost_usd:'0.02',quality:'standard'},
  {billable:'output_image',unit:'image',cost_usd:'0.05',quality:'high'}
 ]);
 const changes=findImagePriceChanges(before,after);
 assert.equal(changes.length,1);
 assert.equal(changes[0].kind,'image.price_increased');
 assert.equal(changes[0].percent,25);
 assert.deepEqual(storedImageCharges(JSON.stringify(imageRaw(before))),before);
});
test('unknown image price or unit fails closed',()=>{
 assert.throws(()=>imageCharges([{billable:'output_image',unit:'image',cost_usd:'unknown'}]));
 assert.throws(()=>imageCharges({pricing:[]}));
 assert.deepEqual(findImagePriceChanges(imageCharges([]),imageCharges([])),[]);
});

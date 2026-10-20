import test from 'node:test';
import assert from 'node:assert/strict';
import {stableEndpointKey,modelLifecycleTransition} from '../src/collector';
import {endpointId} from '../src/pricing';

test('provider identity is insensitive to display metadata',async()=>{
 const a=stableEndpointKey('Example Provider','  PROVIDER-TAG ');
 const b=stableEndpointKey('example provider','provider-tag');
 assert.equal(a,b);
 assert.equal(await endpointId('a/m','provider','tag'),await endpointId('a/m','provider','tag'));
});
test('two missing successful catalogues required to remove a model',()=>{
 assert.deepEqual(modelLifecycleTransition('active',0,false),{status:'active',misses:1,event:null});
 assert.deepEqual(modelLifecycleTransition('active',1,false),{status:'removed',misses:2,event:'model.removed'});
 assert.deepEqual(modelLifecycleTransition('removed',2,false),{status:'removed',misses:2,event:null});
 assert.deepEqual(modelLifecycleTransition('removed',2,true),{status:'active',misses:0,event:'model.restored'});
 assert.deepEqual(modelLifecycleTransition('active',1,true),{status:'active',misses:0,event:null});
});

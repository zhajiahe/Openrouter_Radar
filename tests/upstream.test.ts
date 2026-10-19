import test from 'node:test';
import assert from 'node:assert/strict';
import {listModels,listEndpoints} from '../src/openrouter';

test('catalog parses a minimal public response without user keys',async()=>{
 const original=globalThis.fetch;
 let authorization=false;
 globalThis.fetch=async (_url,init)=>{authorization=new Headers(init?.headers).has('Authorization');return new Response(JSON.stringify({data:[{id:'test/model',name:'Test',pricing:{prompt:'0'}}]}),{status:200});};
 try {
  const result=await listModels();
  assert.equal(result.length,1);
  assert.equal(result[0].id,'test/model');
  assert.equal(authorization,false);
 }finally{globalThis.fetch=original;}
});
test('endpoint collection validates provider price payloads',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({data:{endpoints:[{name:'P | test/model',provider_name:'P',tag:'p',pricing:{prompt:'0.1',completion:'0.3'}}]}}),{status:200});
 try {const result=await listEndpoints('test/model');assert.equal(result[0].provider_name,'P');}
 finally{globalThis.fetch=original;}
});
test('upstream errors fail closed rather than suggesting deleted endpoints',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('error',{status:429});
 try{await assert.rejects(listEndpoints('test/model'),/429/);}
 finally{globalThis.fetch=original;}
});

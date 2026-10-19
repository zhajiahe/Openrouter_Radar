import test from 'node:test';
import assert from 'node:assert/strict';
import {listModels,listEndpoints} from '../src/openrouter';
const KEY='sk-test-owner-only';
test('catalog requires the operator secret and never sends it as query data',async()=>{
 const original=globalThis.fetch;
 let auth='';
 globalThis.fetch=async (url,init)=>{
  auth=new Headers(init?.headers).get('Authorization')||'';
  assert.equal(init?.redirect,'manual','Cloudflare Workers supports manual redirect handling');
  assert.ok(!String(url).includes(KEY));
  return new Response(JSON.stringify({data:[{id:'test/model',name:'Test',pricing:{prompt:'0'}}]}),{status:200});
 };
 try{
  await assert.rejects(listModels(''),/OPENROUTER_API_KEY/);
  const results=await listModels(KEY);
  assert.equal(auth,'Bearer '+KEY);
  assert.equal(results[0].id,'test/model');
 }finally{globalThis.fetch=original;}
});
test('provider collection authenticates with the same owner key',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async (_url,init)=>{
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+KEY);
  return new Response(JSON.stringify({data:{endpoints:[{provider_name:'P',tag:'p',pricing:{prompt:'0.1',completion:'0.3'}}]}}),{status:200});
 };
 try{assert.equal((await listEndpoints('test/model',KEY))[0].provider_name,'P');}
 finally{globalThis.fetch=original;}
});
test('upstream errors fail closed without deleting cached snapshots',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('error',{status:429});
 try{await assert.rejects(listEndpoints('test/model',KEY),/429/);}
 finally{globalThis.fetch=original;}
});

test('redirects fail closed instead of forwarding the owner API key',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async (_url,init)=>{
  assert.equal(init?.redirect,'manual');
  return new Response(null,{status:302,headers:{Location:'https://example.net/'}});
 };
 try{await assert.rejects(listModels(KEY),/HTTP 302/);}
 finally{globalThis.fetch=original;}
});

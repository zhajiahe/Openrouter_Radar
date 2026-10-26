import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Hono} from 'hono';
import {secureHeaders} from 'hono/secure-headers';
import {mutablePublicCacheResponse,publicCacheSeconds} from '../src/public-cache';

test('cached responses are writable for security headers applied after cache hit',async()=>{
 const immutable=Response.redirect('https://example.com/price',302);
 assert.throws(()=>immutable.headers.set('x-content-type-options','nosniff'),TypeError);
 const service=new Hono();
 service.use('*',secureHeaders());
 service.get('/cached',c=>{
  c.res=mutablePublicCacheResponse(immutable);
  return c.res;
 });
 const result=await service.request('http://localhost/cached');
 assert.equal(result.status,302);
 assert.equal(result.headers.get('location'),'https://example.com/price');
 assert.equal(result.headers.get('x-content-type-options'),'nosniff');
});

test('public cache is restricted to explicitly allowlisted anonymous GET endpoints',()=>{
 assert.equal(publicCacheSeconds('/api/analytics'),120);
 assert.equal(publicCacheSeconds('/api/model'),120);
 assert.equal(publicCacheSeconds('/api/auth/me'),0);
 assert.equal(publicCacheSeconds('/api/subscriptions'),0);
});

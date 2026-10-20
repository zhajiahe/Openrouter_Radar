import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {limitClass,requiresJson,queryWithinBudget,trustedClientIp,sameOriginMutation,withinBodyLimit,identityPermit,edgePermit} from '../src/security';
import type {Bindings} from '../src/types';

test('classify expensive routes, reject spoofable rate-limit identifiers',()=>{
 assert.equal(trustedClientIp('2001:db8::1'),'2001:db8::1');
 assert.equal(trustedClientIp('203.0.113.11'),'203.0.113.11');
 assert.equal(trustedClientIp('203.0.113.11, 127.0.0.1'),'unidentified');
 assert.equal(trustedClientIp('any-client-id'),'unidentified');
 assert.equal(limitClass('/api/auth/login','POST'),'AUTH_RATE_LIMITER');
 assert.equal(limitClass('/api/health','GET'),'EXPENSIVE_RATE_LIMITER');
 assert.equal(limitClass('/api/provider-stability','GET'),'EXPENSIVE_RATE_LIMITER');
 assert.equal(limitClass('/api/subscriptions','POST'),'MUTATION_RATE_LIMITER');
 assert.equal(limitClass('/api/models','GET'),'API_RATE_LIMITER');
 assert.equal(limitClass('/feed.xml','GET'),'EXPENSIVE_RATE_LIMITER');
 assert.equal(limitClass('/favicon.svg','GET'),null);
});
test('query and body limits guard expensive workloads',async()=>{
 assert.equal(queryWithinBudget('?q=test&page=1'),true);
 assert.equal(queryWithinBudget('?x='+ 'x'.repeat(1050)),false);
 assert.equal(queryWithinBudget('?'+Array.from({length:21},(_,i)=>'k'+i+'=1').join('&')),false);
 assert.equal(requiresJson('/api/auth/login','POST'),true);
 assert.equal(requiresJson('/api/subscriptions/1','PATCH'),true);
 assert.equal(requiresJson('/api/auth/logout','POST'),false);
 assert.equal(await withinBodyLimit(new Request('https://example.test/',{method:'POST',body:'ok'})),true);
 assert.equal(await withinBodyLimit(new Request('https://example.test/',{method:'POST',body:'x'.repeat(9000)})),false);
});
test('cookie mutations require trusted same-origin evidence',()=>{
 const site='https://radar.example.com';
 assert.equal(sameOriginMutation(site,undefined,site,true,'same-origin'),true);
 assert.equal(sameOriginMutation('https://evil.test',undefined,site,true,undefined),false);
 assert.equal(sameOriginMutation(undefined,'https://radar.example.com/a',site,true,undefined),true);
 assert.equal(sameOriginMutation(undefined,undefined,site,true,undefined),false);
 assert.equal(sameOriginMutation(undefined,undefined,site,false,undefined),true);
 assert.equal(sameOriginMutation(undefined,undefined,site,false,'cross-site'),false);
});
test('native rate limit bindings fail closed and identity keys are scoped',async()=>{
 const accepted:string[]=[];
 const limiter={async limit(x:{key:string}){accepted.push(x.key);return {success:!x.key.includes('denied')};}};
 const env={AUTH_RATE_LIMITER:limiter,IDENTITY_RATE_LIMITER:limiter} as unknown as Bindings;
 assert.equal(await edgePermit(env,'AUTH_RATE_LIMITER','client'),true);
 assert.equal(await identityPermit(env,'login','abc'),true);
 assert.equal(await identityPermit(env,'recover','abc'),true);
 assert.deepEqual(accepted,['client','login:abc','recover:abc']);
 assert.equal(await identityPermit(env,'login','denied'),false);
 await assert.rejects(edgePermit({} as Bindings,'AUTH_RATE_LIMITER','client'),/Missing required/);
 await assert.rejects(identityPermit({} as Bindings,'login','digest'),/Missing required/);
});
test('production configuration defines isolated edge buckets and static headers',()=>{
 const cfg=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 const buckets=cfg.ratelimits as Array<{name:string;namespace_id:string;simple:{limit:number;period:number}}>;
 assert.deepEqual(buckets.map(b=>b.name).sort(),
  ['API_RATE_LIMITER','AUTH_RATE_LIMITER','EXPENSIVE_RATE_LIMITER','IDENTITY_RATE_LIMITER','MUTATION_RATE_LIMITER'].sort());
 assert.equal(new Set(buckets.map(b=>b.namespace_id)).size,buckets.length);
 for(const b of buckets){assert.equal(b.simple.period,60);assert.ok(b.simple.limit>=4);}
 const headers=readFileSync(new URL('../web/public/_headers',import.meta.url),'utf8');
 assert.match(headers,/Content-Security-Policy/);
 assert.match(headers,/frame-ancestors 'none'/);
});

import type { Bindings } from './types';

/** Native Cloudflare rate limit buckets are per-PoP, eventually consistent. */
export type LimitClass='AUTH_RATE_LIMITER'|'API_RATE_LIMITER'|'EXPENSIVE_RATE_LIMITER'|'MUTATION_RATE_LIMITER';
const expensive=new Set([
 '/api/health','/api/analytics','/api/provider-stability',
 '/api/price-history','/api/events/export','/feed.xml'
]);
export function limitClass(path:string,method:string):LimitClass|null{
 if(path.startsWith('/api/auth/'))return 'AUTH_RATE_LIMITER';
 if(path.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(method))return 'MUTATION_RATE_LIMITER';
 if(!['GET','HEAD'].includes(method))return null;
 if(expensive.has(path))return 'EXPENSIVE_RATE_LIMITER';
 if(path.startsWith('/api/'))return 'API_RATE_LIMITER';
 return null;
}
export function trustedClientIp(value:string|null|undefined):string{
 const ip=value?.trim()||'';
 // X-Forwarded-For and arbitrary user identifiers are not trusted fallbacks.
 return ip.length<=64&&/^[0-9a-fA-F:.]+$/.test(ip)?ip.toLowerCase():'unidentified';
}
export function queryWithinBudget(search:string):boolean{
 return search.length<=1024&&[...new URLSearchParams(search).keys()].length<=20;
}
export const JSON_BODY_LIMIT=8192;
export function requiresJson(path:string,method:string):boolean{
 if(method==='PATCH'&&path.startsWith('/api/subscriptions/'))return true;
 if(method==='POST'&&path==='/api/subscriptions')return true;
 return method==='POST'&&[
  '/api/auth/login','/api/auth/register','/api/auth/forgot-password','/api/auth/reset-password'
 ].includes(path);
}
export function sameOriginMutation(origin:string|undefined,referer:string|undefined,
 configured:string,hasCookie:boolean,secFetchSite:string|undefined):boolean{
 if(secFetchSite==='cross-site')return false;
 if(origin)return origin===configured;
 if(referer){
  try{return new URL(referer).origin===configured;}catch{return false;}
 }
 // Authenticated cookie-based mutations require browser origin evidence.
 // JSON-only unauthenticated clients without cookies remain usable.
 return !hasCookie;
}
export async function withinBodyLimit(request:Request,max=JSON_BODY_LIMIT):Promise<boolean>{
 const declared=request.headers.get('content-length');
 if(declared!==null&&Number(declared)>max)return false;
 if(!request.body)return true;
 const reader=request.clone().body?.getReader();
 if(!reader)return true;
 let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)return true;
   size+=value.byteLength;
   if(size>max){
    void reader.cancel().catch(()=>undefined);
    return false;
   }
  }
 }finally{reader.releaseLock();}
}
export async function edgePermit(env:Bindings,group:LimitClass,key:string):Promise<boolean>{
 const bucket=env[group];
 if(!bucket)throw new Error('Missing required edge rate limiting binding: '+group);
 return (await bucket.limit({key})).success;
}
export async function identityPermit(env:Bindings,action:'login'|'recover'|'register'|'reset',digest:string):Promise<boolean>{
 if(!env.IDENTITY_RATE_LIMITER)throw new Error('Missing required identity rate limiter');
 return (await env.IDENTITY_RATE_LIMITER.limit({key:action+':'+digest})).success;
}

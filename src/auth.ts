import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { hashPassword, verifyPassword, token, sha256 } from './crypto';
import { sendEmail } from './email';
import { now, type AppEnv, type Bindings } from './types';
import { identityPermit } from './security';

const auth = new Hono<AppEnv>();
const email=z.string().trim().toLowerCase().email().max(254);
const password=z.string().min(12).max(128);
const credentials=z.object({email,password});
const SESSION_SECONDS=30*86400;
// Count actual reset emails only. A rejected quota must not rewrite its row.
async function limitedEmail(env:Bindings,email:string,windowSeconds:number):Promise<boolean>{
 const current=now(),digest=await sha256('recover:'+email);
 const result=await env.DB.prepare(
  'INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) '+
  'ON CONFLICT(key) DO UPDATE SET '+
  'count=CASE WHEN rate_limits.reset_at<=? THEN 1 ELSE rate_limits.count+1 END, '+
  'reset_at=CASE WHEN rate_limits.reset_at<=? THEN excluded.reset_at ELSE rate_limits.reset_at END '+
  'WHERE rate_limits.reset_at<=? OR rate_limits.count<2 RETURNING count'
 ).bind(digest,current+windowSeconds,current,current,current).first<{count:number}>();
 return !!result;
}
async function allowIdentity(env:Bindings,action:'login'|'recover'|'register'|'reset',value:string):Promise<boolean>{
 return identityPermit(env,action,await sha256(value));
}
async function createEmailToken(env:Bindings,userId:string,purpose:'verify'|'reset'):Promise<string>{
 const raw=token();
 await env.DB.prepare('DELETE FROM email_tokens WHERE user_id=? AND purpose=?').bind(userId,purpose).run();
 await env.DB.prepare('INSERT INTO email_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)')
 .bind(await sha256(raw),userId,purpose,now()+3600).run();
 return raw;
}
async function createSession(c:import('hono').Context<AppEnv>,userId:string):Promise<void>{
 const raw=token();
 await c.env.DB.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES(?,?,?)')
 .bind(await sha256(raw),userId,now()+SESSION_SECONDS).run();
 setCookie(c,'radar_session',raw,{httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Lax',path:'/',maxAge:SESSION_SECONDS});
}
export async function sessionUser(env:Bindings,session:string|undefined):Promise<string|null>{
 if(!session||!/^[a-f0-9]{64}$/.test(session))return null;
 const row=await env.DB.prepare('SELECT user_id FROM sessions WHERE id_hash=? AND expires_at>?').bind(await sha256(session),now()).first<{user_id:string}>();
 return row?.user_id||null;
}
export const requireAuth=createMiddleware<AppEnv>(async (c,next)=>{
 const userId=await sessionUser(c.env,getCookie(c,'radar_session'));
 if(!userId)return c.json({error:'Authentication required'},401);
 c.set('userId',userId);
 await next();
});
auth.post('/register',async c=>{
 if(c.env.OPEN_SIGNUP==='false') return c.json({error:'Registration disabled'},403);
 if(!c.env.RESEND_API_KEY || !c.env.MAIL_FROM) return c.json({error:'Email delivery must be configured by the instance operator'},503);
 const parsed=credentials.safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Valid email and password (at least 12 characters) required'},400);
 if(!await allowIdentity(c.env,'register',parsed.data.email))return c.json({error:'Too many requests'},429);
 const existing=await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(parsed.data.email).first();
 if(existing)return c.json({message:'If the address is eligible, check your inbox'},200);
 const id=crypto.randomUUID();
 const pwHash=await hashPassword(parsed.data.password);
 await c.env.DB.prepare('INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)')
 .bind(id,parsed.data.email,pwHash,now()).run();
 const verify=await createEmailToken(c.env,id,'verify');
 const url=new URL('/api/auth/verify',c.env.APP_ORIGIN);url.searchParams.set('token',verify);
 try {await sendEmail(c.env,parsed.data.email,'Verify your Radar email','Verify your address to enable Radar subscriptions:\n'+url.toString()+'\nThis link expires in one hour.');}
 catch {await c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id).run();return c.json({error:'Unable to send verification email; try again later'},503);}
 return c.json({message:'If the address is eligible, check your inbox'},200);
});
auth.get('/verify',async c=>{
 const raw=c.req.query('token')||'';
 if(!/^[a-f0-9]{64}$/.test(raw))return c.text('Invalid verification link',400);
 const hash=await sha256(raw);
 const row=await c.env.DB.prepare("SELECT user_id FROM email_tokens WHERE token_hash=? AND purpose='verify' AND expires_at>?").bind(hash,now()).first<{user_id:string}>();
 if(!row)return c.text('Expired or invalid verification link',400);
 const changed=await c.env.DB.prepare('DELETE FROM email_tokens WHERE token_hash=? AND expires_at>?').bind(hash,now()).run();
 if(!changed.meta.changes)return c.text('Link already used',400);
 await c.env.DB.prepare('UPDATE users SET email_verified=1 WHERE id=?').bind(row.user_id).run();
 return c.redirect(new URL('/?verified=1',c.env.APP_ORIGIN).toString(),302);
});
auth.post('/login',async c=>{
 const parsed=credentials.safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid credentials'},400);
 if(!await allowIdentity(c.env,'login',parsed.data.email))return c.json({error:'Too many requests'},429);
 const row=await c.env.DB.prepare('SELECT id,password_hash,email_verified FROM users WHERE email=?')
 .bind(parsed.data.email).first<{id:string;password_hash:string;email_verified:number}>();
 if(!row || !await verifyPassword(parsed.data.password,row.password_hash))return c.json({error:'Invalid credentials'},401);
 if(!row.email_verified)return c.json({error:'Please verify your email address'},403);
 await createSession(c,row.id);
 return c.json({ok:true});
});
auth.post('/logout',async c=>{
 const raw=getCookie(c,'radar_session');
 if(raw)await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await sha256(raw)).run();
 deleteCookie(c,'radar_session',{path:'/'});
 return c.json({ok:true});
});
auth.post('/forgot-password',async c=>{
 if(!c.env.RESEND_API_KEY)return c.json({error:'Email delivery unavailable'},503);
 const parsed=z.object({email}).safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid email'},400);
 if(!await allowIdentity(c.env,'recover',parsed.data.email))return c.json({error:'Too many requests'},429);
 const row=await c.env.DB.prepare('SELECT id,email FROM users WHERE email=? AND email_verified=1').bind(parsed.data.email).first<{id:string;email:string}>();
 if(row&&await limitedEmail(c.env,parsed.data.email,3600)){
  const raw=await createEmailToken(c.env,row.id,'reset');
  const link=new URL('/?reset='+raw,c.env.APP_ORIGIN);
  try {await sendEmail(c.env,row.email,'Reset your Radar password','Reset your Radar password: '+link.toString()+'\nExpires in one hour.');}catch{ /* do not reveal accounts */ }
 }
 return c.json({message:'If the address exists, a reset email has been sent'});
});
auth.post('/reset-password',async c=>{
 const parsed=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password}).safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid reset request'},400);
 if(!await allowIdentity(c.env,'reset',parsed.data.token))return c.json({error:'Too many requests'},429);
 const digest=await sha256(parsed.data.token);
 const row=await c.env.DB.prepare("SELECT user_id FROM email_tokens WHERE token_hash=? AND purpose='reset' AND expires_at>?").bind(digest,now()).first<{user_id:string}>();
 if(!row)return c.json({error:'Expired or invalid reset link'},400);
 const hash=await hashPassword(parsed.data.password);
 const deleted=await c.env.DB.prepare("DELETE FROM email_tokens WHERE token_hash=? AND purpose='reset' AND expires_at>?").bind(digest,now()).run();
 if(!deleted.meta.changes)return c.json({error:'Link already used'},400);
 await c.env.DB.batch([
  c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash,row.user_id),
  c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id)
 ]);
 return c.json({ok:true});
});
auth.get('/me',requireAuth,async c=>{
 const u=await c.env.DB.prepare('SELECT id,email,created_at FROM users WHERE id=?').bind(c.get('userId')).first();
 return c.json({user:u});
});
export default auth;

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from './auth';
import { now, type AppEnv, type Bindings } from './types';

const channels=new Hono<AppEnv>();
channels.use('*',requireAuth);

type ChannelRow={
 user_id:string;telegram_chat_id:string|null;telegram_confirmed_at:number|null;
 telegram_code_hash:string|null;telegram_code_expires_at:number|null;telegram_code_attempts:number;
 webhook_url:string|null;webhook_secret:string|null;webhook_enabled:number;
};
async function getRow(env:Bindings,userId:string):Promise<ChannelRow|null>{
 return await env.DB.prepare('SELECT * FROM delivery_channels WHERE user_id=?').bind(userId).first<ChannelRow>();
}
function randomHex(size:number):string{
 const bytes=crypto.getRandomValues(new Uint8Array(size));
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function sha256(value:string):Promise<string>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function allowRate(env:Bindings,key:string,limit=4):Promise<boolean>{
 const clock=now();
 await env.DB.prepare("INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END")
  .bind(key,clock+3600,clock,clock).run();
 const row=await env.DB.prepare('SELECT count FROM rate_limits WHERE key=?').bind(key).first<{count:number}>();
 return !!row&&row.count<=limit;
}
export function allowedWebhookUrl(input:string,allowlist:string):string|null{
 let url:URL;
 try{url=new URL(input);}catch{return null;}
 const hosts=allowlist.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(!hosts.length||url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443')return null;
 if(!/^[a-z0-9.-]+$/.test(url.hostname)||url.hostname==='localhost'||url.hostname.endsWith('.local'))return null;
 if(/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname))return null;
 if(!hosts.includes(url.hostname.toLowerCase()))return null;
 return url.toString();
}
async function telegramMessage(env:Bindings,chatId:string,text:string):Promise<void>{
 if(!env.TELEGRAM_BOT_TOKEN)throw new Error('Telegram is disabled by the operator');
 const response=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true}),
  signal:AbortSignal.timeout(10000),redirect:'manual'
 });
 if(!response.ok)throw new Error('Telegram delivery HTTP '+response.status);
}
channels.get('/',async c=>{
 const row=await getRow(c.env,c.get('userId'));
 return c.json({
  available:{telegram:!!c.env.TELEGRAM_BOT_TOKEN,webhook:!!c.env.WEBHOOK_ALLOWED_HOSTS?.trim()},
  telegram:{enabled:!!row?.telegram_confirmed_at,chat_id:row?.telegram_confirmed_at?row.telegram_chat_id:null,
   awaiting_confirmation:!!row?.telegram_code_expires_at&&row.telegram_code_expires_at>now()},
  webhook:{enabled:!!row?.webhook_enabled,host:row?.webhook_enabled&&row.webhook_url?new URL(row.webhook_url).hostname:null}
 });
});
channels.post('/telegram/start',async c=>{
 if(!c.env.TELEGRAM_BOT_TOKEN)return c.json({error:'Telegram channel not configured by the operator'},503);
 const parsed=z.object({chat_id:z.string().regex(/^-?\d{5,20}$/)}).safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid Telegram chat id'},400);
 const userId=c.get('userId');
 if(!await allowRate(c.env,'telegram:start:'+userId))return c.json({error:'Too many verification attempts'},429);
 const code=String(100000+crypto.getRandomValues(new Uint32Array(1))[0]%900000);
 const expiry=now()+600,hash=await sha256(code+':'+userId+':'+c.env.TELEGRAM_BOT_TOKEN);
 // If the bot cannot message the chat, don't save a pending confirmation.
 try{await telegramMessage(c.env,parsed.data.chat_id,'Radar verification code: '+code+'\nExpires in 10 minutes. Never share this code.');}
 catch{return c.json({error:'Unable to message chat; start a conversation with the bot first'},422);}
 await c.env.DB.prepare("INSERT INTO delivery_channels(user_id,telegram_chat_id,telegram_confirmed_at,telegram_code_hash,telegram_code_expires_at,telegram_code_attempts,updated_at) VALUES(?,?,NULL,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET telegram_chat_id=excluded.telegram_chat_id,telegram_confirmed_at=NULL,telegram_code_hash=excluded.telegram_code_hash,telegram_code_expires_at=excluded.telegram_code_expires_at,telegram_code_attempts=0,updated_at=excluded.updated_at")
  .bind(userId,parsed.data.chat_id,hash,expiry,now()).run();
 return c.json({verification_sent:true,expires_in_seconds:600});
});
channels.post('/telegram/confirm',async c=>{
 const parsed=z.object({code:z.string().regex(/^\d{6}$/)}).safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid code'},400);
 const userId=c.get('userId'),row=await getRow(c.env,userId);
 if(!row?.telegram_code_hash||!row.telegram_code_expires_at||now()>row.telegram_code_expires_at||row.telegram_code_attempts>=5)
  return c.json({error:'Verification unavailable or expired'},400);
 const hash=await sha256(parsed.data.code+':'+userId+':'+c.env.TELEGRAM_BOT_TOKEN);
 if(hash!==row.telegram_code_hash){
  await c.env.DB.prepare('UPDATE delivery_channels SET telegram_code_attempts=telegram_code_attempts+1 WHERE user_id=?')
   .bind(userId).run();
  return c.json({error:'Incorrect code'},400);
 }
 await c.env.DB.prepare('UPDATE delivery_channels SET telegram_confirmed_at=?,telegram_code_hash=NULL,telegram_code_expires_at=NULL,telegram_code_attempts=0,updated_at=? WHERE user_id=?')
  .bind(now(),now(),userId).run();
 return c.json({enabled:true});
});
channels.delete('/telegram',async c=>{
 const userId=c.get('userId');
 await c.env.DB.prepare('UPDATE delivery_channels SET telegram_chat_id=NULL,telegram_confirmed_at=NULL,telegram_code_hash=NULL,telegram_code_expires_at=NULL,updated_at=? WHERE user_id=?')
  .bind(now(),userId).run();
 await c.env.DB.prepare("UPDATE channel_deliveries SET status='suppressed' WHERE channel='telegram' AND status IN ('pending','sending') AND notification_id IN (SELECT id FROM notifications WHERE user_id=?)").bind(userId).run();
 return c.json({enabled:false});
});
channels.post('/webhook',async c=>{
 const parsed=z.object({url:z.string().max(2048)}).safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid webhook URL'},400);
 const validated=allowedWebhookUrl(parsed.data.url,c.env.WEBHOOK_ALLOWED_HOSTS||'');
 if(!validated)return c.json({error:'Webhook HTTPS host must be on the operator allowlist'},400);
 const userId=c.get('userId');
 if(!await allowRate(c.env,'webhook:change:'+userId,10))return c.json({error:'Too many webhook changes'},429);
 const secret='rdwh_'+randomHex(32);
 await c.env.DB.prepare("INSERT INTO delivery_channels(user_id,webhook_url,webhook_secret,webhook_enabled,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET webhook_url=excluded.webhook_url,webhook_secret=excluded.webhook_secret,webhook_enabled=1,updated_at=excluded.updated_at")
  .bind(userId,validated,secret,now()).run();
 return c.json({enabled:true,host:new URL(validated).hostname,secret,note:'Secret shown once. Save it to verify X-Radar-Signature.'});
});
channels.delete('/webhook',async c=>{
 const userId=c.get('userId');
 await c.env.DB.prepare('UPDATE delivery_channels SET webhook_url=NULL,webhook_secret=NULL,webhook_enabled=0,updated_at=? WHERE user_id=?')
  .bind(now(),userId).run();
 await c.env.DB.prepare("UPDATE channel_deliveries SET status='suppressed' WHERE channel='webhook' AND status IN ('pending','sending') AND notification_id IN (SELECT id FROM notifications WHERE user_id=?)").bind(userId).run();
 return c.json({enabled:false});
});

type PendingChannel={notification_id:string;channel:'telegram'|'webhook';user_id:string;telegram_chat_id:string|null;telegram_confirmed_at:number|null;webhook_url:string|null;webhook_secret:string|null;webhook_enabled:number;model_id:string;provider:string;kind:string;dimension:string|null;old_price:string|null;new_price:string|null;change_pct:number|null;created_at:number};
async function sendWebhook(env:Bindings,row:PendingChannel):Promise<void>{
 const url=row.webhook_url&&allowedWebhookUrl(row.webhook_url,env.WEBHOOK_ALLOWED_HOSTS||'');
 if(!url||!row.webhook_secret)throw new Error('Webhook channel unavailable');
 const event={id:row.notification_id,model_id:row.model_id,provider:row.provider,kind:row.kind,dimension:row.dimension,
  old_value:row.old_price,new_value:row.new_price,change_pct:row.change_pct,observed_at:row.created_at};
 const body=JSON.stringify(event);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(row.webhook_secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body));
 const signature=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Radar-Delivery':row.notification_id,'X-Radar-Signature':'sha256='+signature},
  body,signal:AbortSignal.timeout(10000),redirect:'manual'});
 if(!response.ok)throw new Error('Webhook delivery HTTP '+response.status);
}
export async function deliverChannels(env:Bindings):Promise<number>{
 if(!env.TELEGRAM_BOT_TOKEN&&!env.WEBHOOK_ALLOWED_HOSTS)return 0;
 const clock=now();
 const pending=await env.DB.prepare("SELECT d.notification_id,d.channel,n.user_id,c.telegram_chat_id,c.telegram_confirmed_at,c.webhook_url,c.webhook_secret,c.webhook_enabled,e.model_id,e.provider,e.kind,e.dimension,e.old_price,e.new_price,e.change_pct,e.created_at FROM channel_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN delivery_channels c ON c.user_id=n.user_id JOIN price_events e ON e.id=n.event_id WHERE d.status IN ('pending','sending') AND d.next_attempt_at<=? AND d.attempts<5 ORDER BY d.next_attempt_at LIMIT 30")
  .bind(clock).all<PendingChannel>();
 let completed=0;
 for(const row of pending.results){
  const claimed=await env.DB.prepare("UPDATE channel_deliveries SET status='sending',next_attempt_at=? WHERE notification_id=? AND channel=? AND status IN ('pending','sending') AND next_attempt_at<=?")
   .bind(clock+180,row.notification_id,row.channel,clock).run();
  if(!claimed.meta.changes)continue;
  try{
   if(row.channel==='telegram'){
    if(!row.telegram_confirmed_at||!row.telegram_chat_id)throw new Error('Telegram channel unavailable');
    const text='[Radar] '+row.model_id+'\n'+row.provider+' · '+row.kind+'\n'+(row.dimension||'')+' '+(row.old_price||'')+' → '+(row.new_price||'')+'\n'+env.APP_ORIGIN;
    await telegramMessage(env,row.telegram_chat_id,text.slice(0,3500));
   }else await sendWebhook(env,row);
   await env.DB.prepare("UPDATE channel_deliveries SET status='sent',sent_at=?,last_error=NULL WHERE notification_id=? AND channel=? AND status='sending'")
    .bind(now(),row.notification_id,row.channel).run();
   completed++;
  }catch(e){
   const error=String(e).match(/(?:Telegram|Webhook) delivery HTTP \d{3}/)?.[0]||'Channel delivery failed';
   const state=await env.DB.prepare('SELECT attempts FROM channel_deliveries WHERE notification_id=? AND channel=?')
    .bind(row.notification_id,row.channel).first<{attempts:number}>();
   const tries=(state?.attempts||0)+1;
   await env.DB.prepare("UPDATE channel_deliveries SET attempts=?,status=?,next_attempt_at=?,last_error=? WHERE notification_id=? AND channel=? AND status='sending'")
    .bind(tries,tries>=5?'failed':'pending',now()+Math.min(3600,60*2**tries),error,row.notification_id,row.channel).run();
  }
 }
 return completed;
}
export default channels;

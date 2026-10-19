import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import auth, { requireAuth } from './auth';
import { EVENT_KINDS, now, type AppEnv, type Bindings } from './types';
import { runCollection } from './collector';
import { deliverPending } from './delivery';

const app=new Hono<AppEnv>();
app.use('*',secureHeaders({contentSecurityPolicy:false}));
app.use('/api/*',async (c,next)=>{
 // SameSite cookies plus same-origin checks protect authenticated mutations against CSRF.
 const method=c.req.method.toUpperCase(),origin=c.req.header('Origin');
 if(!['GET','HEAD','OPTIONS'].includes(method) && origin){
  const configured=new URL(c.env.APP_ORIGIN).origin;
  const localVite=configured==='http://localhost:8787'&&origin==='http://localhost:5173';
  if(origin!==configured&&!localVite)return c.json({error:'Cross-origin request rejected'},403);
 }
 await next();
});
app.onError((err,c)=>{console.error('Unhandled Radar error',err);return c.json({error:'Internal server error'},500);});
app.route('/api/auth',auth);
app.get('/api/health',async c=>{
 const sync=await c.env.DB.prepare("SELECT last_success,last_error FROM sync_state WHERE name='catalog'").first<{last_success:number;last_error:string|null}>();
 const total=await c.env.DB.prepare('SELECT count(*) as count FROM models').first<{count:number}>();
 const healthy=!!sync?.last_success && now()-sync.last_success<86400;
 return c.json({status:healthy?'ok':'degraded',models:total?.count||0,catalog_last_success:sync?.last_success||null,catalog_error:sync?.last_error||null,provider_monitoring:'subscriber_models',server_time:now()},healthy?200:503);
});
app.get('/api/stats',async c=>{
 const [models,providers,subscriptions,events]=await Promise.all([
  c.env.DB.prepare('SELECT count(*) n FROM models').first<{n:number}>(),
  c.env.DB.prepare("SELECT count(DISTINCT provider) n FROM endpoints WHERE source='provider' AND status='active'").first<{n:number}>(),
  c.env.DB.prepare('SELECT count(*) n FROM subscriptions').first<{n:number}>(),
  c.env.DB.prepare('SELECT count(*) n FROM price_events WHERE created_at>?').bind(now()-86400).first<{n:number}>()
 ]);
 return c.json({models:models?.n||0,providers:providers?.n||0,subscriptions:subscriptions?.n||0,events24h:events?.n||0});
});
app.get('/api/models',async c=>{
 const query=(c.req.query('q')||'').trim().slice(0,80);
 const limit=Math.min(Math.max(Number(c.req.query('limit'))||30,1),100);
 const page=Math.min(Math.max(Number(c.req.query('page'))||1,1),10000);
 const sql=`SELECT id,name,context_length,updated_at FROM models
 WHERE (?='' OR name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')
 ORDER BY name LIMIT ? OFFSET ?`;
 const like='%'+query.replace(/[\\%_]/g,'\\$&')+'%';
 const rows=await c.env.DB.prepare(sql).bind(query,like,like,limit,(page-1)*limit).all();
 return c.json({data:rows.results,page,limit});
});
app.get('/api/providers',async c=>{
 const rows=await c.env.DB.prepare(`SELECT provider,count(DISTINCT model_id) AS model_count
 FROM endpoints WHERE source='provider' AND status='active' GROUP BY provider ORDER BY provider LIMIT 500`).all();
 return c.json({data:rows.results});
});
app.get('/api/model',async c=>{
 const id=c.req.query('id');
 if(!id)return c.json({error:'Missing model id'},400);
 const model=await c.env.DB.prepare('SELECT id,name,description,context_length,updated_at FROM models WHERE id=?').bind(id).first();
 if(!model)return c.json({error:'Model not found'},404);
 const endpoints=await c.env.DB.prepare(`SELECT id,provider,tag,source,input_price,output_price,status,checked_at
 FROM endpoints WHERE model_id=? ORDER BY provider,tag`).bind(id).all();
 return c.json({model,endpoints:endpoints.results});
});
app.get('/api/events',async c=>{
 const modelId=c.req.query('model_id')||'';
 const limit=Math.min(Math.max(Number(c.req.query('limit'))||50,1),100);
 const rows=await c.env.DB.prepare(`SELECT id,model_id,provider,kind,dimension,old_price,new_price,change_pct,created_at
 FROM price_events WHERE (?='' OR model_id=?) ORDER BY created_at DESC LIMIT ?`)
 .bind(modelId,modelId,limit).all();
 return c.json({data:rows.results});
});
app.get('/feed.xml',async c=>{
 const items=await c.env.DB.prepare(`SELECT id,model_id,provider,kind,dimension,old_price,new_price,created_at
 FROM price_events ORDER BY created_at DESC LIMIT 50`).all<{id:string;model_id:string;provider:string;kind:string;dimension:string|null;old_price:string|null;new_price:string|null;created_at:number}>();
 const escape=(s:string)=>s.replace(/[<>&"']/g,ch=>({'<':'&lt;','>':'&gt;','&':'&quot;',"'":'&apos;','"':'&quot;'}[ch]||ch));
 const origin=c.env.APP_ORIGIN.replace(/\/$/,'');
 const xml='<?xml version="1.0" encoding="UTF-8"?>'+
 '<rss version="2.0"><channel><title>OpenRouter Radar changes</title><link>'+escape(origin)+'</link><description>Price and provider endpoint changes</description>'+
 items.results.map(e=>'<item><guid isPermaLink="false">'+escape(e.id)+'</guid><title>'+escape(e.model_id+' / '+e.provider+' — '+e.kind)+'</title><description>'+escape((e.dimension||'')+' '+(e.old_price||'')+' → '+(e.new_price||''))+'</description><pubDate>'+new Date(e.created_at*1000).toUTCString()+'</pubDate></item>').join('')+'</channel></rss>';
 return c.body(xml,200,{'Content-Type':'application/rss+xml; charset=utf-8'});
});
app.get('/api/subscriptions',requireAuth,async c=>{
 const rows=await c.env.DB.prepare(`SELECT s.id,s.model_id,m.name,s.provider,s.events_json,s.threshold_pct,s.frequency,s.created_at
 FROM subscriptions s JOIN models m ON m.id=s.model_id WHERE s.user_id=? ORDER BY s.created_at DESC`)
 .bind(c.get('userId')).all();
 return c.json({data:rows.results});
});
const subSchema=z.object({
 model_id:z.string().min(3).max(200),
 provider:z.string().trim().max(150).nullable().optional(),
 events:z.array(z.enum(EVENT_KINDS as [typeof EVENT_KINDS[number],...typeof EVENT_KINDS[number][]])).min(1).max(5),
 threshold_pct:z.number().min(0).max(1000).default(0),
 frequency:z.enum(['instant','daily']).default('instant')
});
app.post('/api/subscriptions',requireAuth,async c=>{
 const parsed=subSchema.safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid subscription',details:parsed.error.flatten().fieldErrors},400);
 const count=await c.env.DB.prepare('SELECT count(*) n FROM subscriptions WHERE user_id=?').bind(c.get('userId')).first<{n:number}>();
 if((count?.n||0)>=50)return c.json({error:'Limit of 50 monitoring rules per user'},429);
 const model=await c.env.DB.prepare('SELECT id FROM models WHERE id=?').bind(parsed.data.model_id).first();
 if(!model)return c.json({error:'Unknown model; wait for initial catalogue sync'},404);
 const id=crypto.randomUUID();
 await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO subscriptions(id,user_id,model_id,provider,events_json,threshold_pct,frequency,created_at)
   VALUES(?,?,?,?,?,?,?,?)`).bind(id,c.get('userId'),parsed.data.model_id,parsed.data.provider||null,JSON.stringify(parsed.data.events),parsed.data.threshold_pct,parsed.data.frequency,now()),
  c.env.DB.prepare('INSERT OR IGNORE INTO collection_jobs(model_id) VALUES(?)').bind(parsed.data.model_id)
 ]);
 return c.json({id},201);
});
app.delete('/api/subscriptions/:id',requireAuth,async c=>{
 const removed=await c.env.DB.prepare('DELETE FROM subscriptions WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('userId')).run();
 return c.json({deleted:!!removed.meta.changes});
});
app.get('/api/notifications',requireAuth,async c=>{
 const rows=await c.env.DB.prepare(`SELECT n.id,n.status,n.sent_at,n.read_at,n.created_at,
 e.kind,e.model_id,e.provider,e.dimension,e.old_price,e.new_price,e.change_pct
 FROM notifications n JOIN price_events e ON e.id=n.event_id WHERE n.user_id=?
 ORDER BY n.created_at DESC LIMIT 100`).bind(c.get('userId')).all();
 return c.json({data:rows.results});
});
app.patch('/api/notifications/:id/read',requireAuth,async c=>{
 const row=await c.env.DB.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?')
 .bind(now(),c.req.param('id'),c.get('userId')).run();
 return c.json({updated:!!row.meta.changes});
});
app.get('/api/my-stats',requireAuth,async c=>{
 const [subs,unread]=await Promise.all([
  c.env.DB.prepare('SELECT count(*) n FROM subscriptions WHERE user_id=?').bind(c.get('userId')).first<{n:number}>(),
  c.env.DB.prepare('SELECT count(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').bind(c.get('userId')).first<{n:number}>()
 ]);
 return c.json({subscriptions:subs?.n||0,unread:unread?.n||0});
});
app.all('/api/*',c=>c.json({error:'Not found'},404));
app.get('*',async c=>{
 if(c.env.ASSETS)return c.env.ASSETS.fetch(c.req.raw);
 return c.text('Build the web app with npm run build and configure the ASSETS binding.',503);
});
export default {
 fetch:(request:Request,env:Bindings,ctx:ExecutionContext)=>app.fetch(request,env,ctx),
 scheduled:(_controller:ScheduledController,env:Bindings,ctx:ExecutionContext)=>{
  ctx.waitUntil((async()=>{await runCollection(env);await deliverPending(env);})());
 }
};

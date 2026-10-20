import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import auth, { requireAuth } from './auth';
import { EVENT_KINDS, now, type AppEnv, type Bindings } from './types';
import { CATALOG_INTERVAL_SECONDS, PROVIDER_INTERVAL_SECONDS } from './collector';
import { ALARM_INTERVAL_MS } from './scheduler';
import { safeCollectionError } from './history';
export { RadarScheduler } from './scheduler';

const app=new Hono<AppEnv>();
app.use('*',secureHeaders());
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
 // Bootstrap or heal the singleton DO alarm. No account-level Cron slot is needed.
 c.executionCtx.waitUntil(c.env.SCHEDULER.get(c.env.SCHEDULER.idFromName('global')).fetch('https://internal.scheduler/arm').catch(e=>console.error('scheduler bootstrap failed',e)));
 const sync=await c.env.DB.prepare("SELECT last_success,last_error FROM sync_state WHERE name='catalog'").first<{last_success:number;last_error:string|null}>();
 const total=await c.env.DB.prepare('SELECT count(*) as count FROM models').first<{count:number}>();
 const coverage=await c.env.DB.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN last_checked>0 THEN 1 ELSE 0 END) AS scanned, SUM(CASE WHEN last_checked<? THEN 1 ELSE 0 END) AS due, SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS errors FROM collection_jobs')
  .bind(now()-PROVIDER_INTERVAL_SECONDS).first<{total:number;scanned:number|null;due:number|null;errors:number|null}>();
 const healthy=!!c.env.OPENROUTER_API_KEY&&!!sync?.last_success&&!sync?.last_error&&now()-sync.last_success<2*CATALOG_INTERVAL_SECONDS
  &&(coverage?.total===0 || (coverage?.scanned||0)>0);
 return c.json({status:healthy?'ok':'degraded',models:total?.count||0,catalog_last_success:sync?.last_success||null,catalog_error:sync?.last_error||null,provider_monitoring:'all_models',provider_total:coverage?.total||0,provider_scanned:coverage?.scanned||0,provider_due:coverage?.due||0,provider_errors:coverage?.errors||0,catalog_interval_seconds:CATALOG_INTERVAL_SECONDS,provider_interval_seconds:PROVIDER_INTERVAL_SECONDS,scheduler_interval_seconds:ALARM_INTERVAL_MS/1000,server_time:now()},healthy?200:503);
});
app.get('/api/stats',async c=>{
 const [models,providers,subscriptions,events]=await Promise.all([
  c.env.DB.prepare('SELECT count(*) n FROM models').first<{n:number}>(),
  c.env.DB.prepare("SELECT count(DISTINCT provider) n FROM endpoints WHERE source='provider' AND status='active'").first<{n:number}>(),
  c.env.DB.prepare('SELECT count(*) n FROM subscriptions').first<{n:number}>(),
  c.env.DB.prepare("SELECT count(*) n FROM price_events WHERE quality='observed' AND created_at>?").bind(now()-86400).first<{n:number}>()
 ]);
 return c.json({models:models?.n||0,providers:providers?.n||0,subscriptions:subscriptions?.n||0,events24h:events?.n||0});
});
app.get('/api/models',async c=>{
 const q=(c.req.query('q')||'').trim().slice(0,80);
 const provider=(c.req.query('provider')||'').trim().slice(0,150);
 const sort=(c.req.query('sort')||'name').trim();
 const author=(c.req.query('author')||'').trim().slice(0,100);
 const modality=(c.req.query('modality')||'').trim().slice(0,50);
 const capability=(c.req.query('capability')||'').trim().slice(0,80);
 const minContext=Math.max(0,Math.min(20000000,Number(c.req.query('min_context'))||0));
 const maxInput=Number(c.req.query('max_input_price'));
 const hasMaxInput=c.req.query('max_input_price')!==undefined && Number.isFinite(maxInput) && maxInput>=0;
 const limit=Math.min(Math.max(Number(c.req.query('limit'))||30,1),100);
 const page=Math.min(Math.max(Number(c.req.query('page'))||1,1),10000);
 const order:Record<string,string>={
  name:'m.name COLLATE NOCASE ASC, m.id ASC',
  newest:'m.updated_at DESC, m.name ASC',
  context:'m.context_length DESC, m.name ASC',
  price:'CASE WHEN lowest_input IS NULL THEN 1 ELSE 0 END, lowest_input ASC, m.name ASC'
 };
 const where=`(?='' OR instr(lower(m.name),lower(?))>0 OR instr(lower(m.id),lower(?))>0)
 AND (?='' OR EXISTS(SELECT 1 FROM endpoints ep WHERE ep.model_id=m.id AND ep.provider=? AND ep.status='active' AND ep.source='provider'))
 AND (?='' OR substr(lower(m.id),1,length(?)+1)=lower(?)||'/')
 AND m.context_length>=?
 AND (?='' OR EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(m.capabilities_json,'$.architecture.input_modalities'),'[]')) j WHERE lower(j.value)=lower(?)))
 AND (?='' OR EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(m.capabilities_json,'$.supported_parameters'),'[]')) j WHERE lower(j.value)=lower(?)))
 AND (?=0 OR EXISTS(SELECT 1 FROM endpoints x WHERE x.model_id=m.id AND x.source='provider' AND x.status='active' AND x.input_price IS NOT NULL AND CAST(x.input_price AS REAL)<=?))`;
 const binds=[q,q,q,provider,provider,author,author,author,minContext,modality,modality,capability,capability,hasMaxInput?1:0,hasMaxInput?maxInput/1e6:0] as const;
 const [rows,count]=await Promise.all([
  c.env.DB.prepare(`SELECT m.id,m.name,m.context_length,m.updated_at,m.expiration_date,m.alias_target,
   (SELECT MIN(CAST(e.input_price AS REAL)) FROM endpoints e WHERE e.model_id=m.id AND e.source='provider' AND e.status='active' AND e.input_price IS NOT NULL) AS lowest_input,
   (SELECT COUNT(DISTINCT e.provider) FROM endpoints e WHERE e.model_id=m.id AND e.source='provider' AND e.status='active') AS provider_count
   FROM models m WHERE ${where} ORDER BY ${order[sort]||order.name} LIMIT ? OFFSET ?`)
    .bind(...binds,limit,(page-1)*limit).all(),
  c.env.DB.prepare(`SELECT COUNT(*) AS total FROM models m WHERE ${where}`).bind(...binds).first<{total:number}>()
 ]);
 return c.json({data:rows.results,page,limit,total:count?.total||0});
});
app.get('/api/providers',async c=>{
 const rows=await c.env.DB.prepare(`SELECT provider,count(DISTINCT model_id) AS model_count
 FROM endpoints WHERE source='provider' AND status='active' GROUP BY provider ORDER BY provider LIMIT 500`).all();
 return c.json({data:rows.results});
});
app.get('/api/model',async c=>{
 const id=(c.req.query('id')||'').slice(0,200);
 if(!id)return c.json({error:'Missing model id'},400);
 const [model,job,endpoints]=await Promise.all([
  c.env.DB.prepare('SELECT id,name,description,context_length,expiration_date,alias_target,capabilities_json,updated_at FROM models WHERE id=?').bind(id).first(),
  c.env.DB.prepare('SELECT last_checked,last_success,last_error FROM collection_jobs WHERE model_id=?').bind(id).first<{last_checked:number;last_success:number;last_error:string|null}>(),
  c.env.DB.prepare("SELECT e.id,e.provider,e.tag,e.source,e.input_price,e.output_price,e.pricing_json,e.status,e.checked_at,e.first_seen FROM endpoints e WHERE e.model_id=? ORDER BY e.source DESC,e.provider,e.tag").bind(id).all()
 ]);
 if(!model)return c.json({error:'Model not found'},404);
 const success=job?.last_success||0;
 const failure=!!job?.last_error;
 const collection={status:failure?'error':!success?'never':now()-success>2*PROVIDER_INTERVAL_SECONDS?'stale':'fresh',
   last_attempt:job?.last_checked||null,last_success:success||null,last_error:safeCollectionError(job?.last_error||null),
   age_seconds:success?Math.max(0,now()-success):null,
   active_endpoints:endpoints.results.filter(ep=>ep.source==='provider'&&ep.status==='active').length,
   missing_endpoints:endpoints.results.filter(ep=>ep.source==='provider'&&ep.status==='missing').length};
 return c.json({model,endpoints:endpoints.results,collection});
});
app.get('/api/price-history',async c=>{
 const modelId=(c.req.query('model_id')||'').slice(0,200);
 const provider=(c.req.query('provider')||'').slice(0,150);
 const dimension=c.req.query('dimension')==='output'?'output':'input';
 if(!modelId)return c.json({error:'model_id is required'},400);
 const since=Math.max(0,Number(c.req.query('since'))||now()-90*86400);
 const rows=await c.env.DB.prepare("SELECT endpoint_id,model_id,provider,source,dimension,price,observed_at FROM price_history WHERE model_id=? AND source='provider' AND (?='' OR provider=?) AND dimension=? AND observed_at>=? ORDER BY observed_at ASC,provider ASC LIMIT 2000").bind(modelId,provider,provider,dimension,since).all();
 return c.json({data:rows.results,unit:'USD/token',method:'observed_change_points',retention_days:180});
});
app.get('/api/events',async c=>{
 const modelId=(c.req.query('model_id')||'').slice(0,200);
 const kind=(c.req.query('kind')||'').slice(0,60);
 const q=(c.req.query('q')||'').trim().slice(0,80);
 const provider=(c.req.query('provider')||'').trim().slice(0,150);
 const includeBaseline=c.req.query('include_baseline')==='1';
 const start=Math.max(0,Number(c.req.query('start'))||0);
 const end=Number(c.req.query('end'))||4102444800;
 const page=Math.min(Math.max(Number(c.req.query('page'))||1,1),10000);
 const limit=Math.min(Math.max(Number(c.req.query('limit'))||50,1),100);
 const where=`(?='' OR model_id=?) AND (?='' OR kind=?) AND (?='' OR instr(lower(model_id),lower(?))>0 OR instr(lower(provider),lower(?))>0) AND (?='' OR provider=?) AND created_at BETWEEN ? AND ? AND (?=1 OR quality='observed')`;
 const binds=[modelId,modelId,kind,kind,q,q,q,provider,provider,start,end,includeBaseline?1:0] as const;
 const [rows,count]=await Promise.all([
  c.env.DB.prepare(`SELECT id,model_id,provider,kind,dimension,old_price,new_price,change_pct,created_at,quality
   FROM price_events WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...binds,limit,(page-1)*limit).all(),
  c.env.DB.prepare(`SELECT COUNT(*) AS total FROM price_events WHERE ${where}`).bind(...binds).first<{total:number}>()
 ]);
 return c.json({data:rows.results,page,limit,total:count?.total||0});
});
app.get('/api/events/export',async c=>{
 const format=c.req.query('format')==='json'?'json':'csv';
 const modelId=(c.req.query('model_id')||'').slice(0,200);
 const kind=(c.req.query('kind')||'').slice(0,60);
 const provider=(c.req.query('provider')||'').slice(0,150);
 const q=(c.req.query('q')||'').slice(0,80);
 const includeBaseline=c.req.query('include_baseline')==='1';
 const start=Math.max(0,Number(c.req.query('start'))||0),end=Number(c.req.query('end'))||4102444800;
 const data=await c.env.DB.prepare("SELECT id,model_id,provider,kind,dimension,old_price,new_price,change_pct,created_at,quality FROM price_events WHERE (?='' OR model_id=?) AND (?='' OR kind=?) AND (?='' OR provider=?) AND (?='' OR instr(lower(model_id),lower(?))>0 OR instr(lower(provider),lower(?))>0) AND created_at BETWEEN ? AND ? AND (?=1 OR quality='observed') ORDER BY created_at DESC LIMIT 1000")
  .bind(modelId,modelId,kind,kind,provider,provider,q,q,q,start,end,includeBaseline?1:0).all();
 const headers={'Cache-Control':'no-store','Content-Disposition':'attachment; filename="radar-events.'+format+'"','X-Export-Limit':'1000'};
 if(format==='json')return c.json({data:data.results,limit:1000,exported_at:now()},200,headers);
 const keys=['id','model_id','provider','kind','dimension','old_price','new_price','change_pct','created_at','quality'];
 const escape=(value:unknown)=>{
  const raw=String(value??'');
  // Escape potential spreadsheet formula injection even after opening a CSV.
  const safe=/^[\s]*[=+\-@]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
 };
 const csv=[keys.join(','),...data.results.map(row=>keys.map(k=>escape(row[k])).join(','))].join('\r\n');
 return c.body('\ufeff'+csv,200,{...headers,'Content-Type':'text/csv; charset=utf-8'});
});
app.get('/feed.xml',async c=>{
 const page=Math.min(Math.max(Number(c.req.query('page'))||1,1),10000);
 const items=await c.env.DB.prepare(`SELECT id,model_id,provider,kind,dimension,old_price,new_price,created_at
 FROM price_events WHERE quality='observed' ORDER BY created_at DESC LIMIT 50 OFFSET ?`).bind((page-1)*50).all<{id:string;model_id:string;provider:string;kind:string;dimension:string|null;old_price:string|null;new_price:string|null;created_at:number}>();
 const escape=(s:string)=>s.replace(/[<>&"']/g,ch=>({'<':'&lt;','>':'&gt;','&':'&quot;',"'":'&apos;','"':'&quot;'}[ch]||ch));
 const origin=c.env.APP_ORIGIN.replace(/\/$/,'');
 const xml='<?xml version="1.0" encoding="UTF-8"?>'+
 '<rss version="2.0"><channel><title>OpenRouter Radar changes</title><link>'+escape(origin)+'</link><description>Price and provider endpoint changes</description><atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="'+escape(origin+'/feed.xml?page='+page)+'" rel="self" type="application/rss+xml"/>'+
 items.results.map(e=>'<item><guid isPermaLink="false">'+escape(e.id)+'</guid><title>'+escape(e.model_id+' / '+e.provider+' — '+e.kind)+'</title><description>'+escape((e.dimension||'')+' '+(e.old_price||'')+' → '+(e.new_price||''))+'</description><pubDate>'+new Date(e.created_at*1000).toUTCString()+'</pubDate></item>').join('')+'</channel></rss>';
 return c.body(xml,200,{'Content-Type':'application/rss+xml; charset=utf-8'});
});
app.get('/api/subscriptions',requireAuth,async c=>{
 const rows=await c.env.DB.prepare(`SELECT s.id,s.model_id,m.name,s.provider,s.events_json,s.threshold_pct,s.frequency,s.paused,s.created_at,
 (SELECT MAX(n.created_at) FROM notifications n WHERE n.subscription_id=s.id) AS last_hit,
 (SELECT MAX(n.sent_at) FROM notifications n WHERE n.subscription_id=s.id) AS last_sent,
 (SELECT n.status FROM notifications n WHERE n.subscription_id=s.id ORDER BY n.created_at DESC LIMIT 1) AS latest_status
 FROM subscriptions s JOIN models m ON m.id=s.model_id WHERE s.user_id=? ORDER BY s.created_at DESC`)
 .bind(c.get('userId')).all();
 return c.json({data:rows.results});
});
const subSchema=z.object({
 model_id:z.string().min(3).max(200),
 provider:z.string().trim().max(150).nullable().optional(),
 events:z.array(z.enum(EVENT_KINDS as [typeof EVENT_KINDS[number],...typeof EVENT_KINDS[number][]])).min(1).max(EVENT_KINDS.length),
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
 await c.env.DB.prepare(`INSERT INTO subscriptions(id,user_id,model_id,provider,events_json,threshold_pct,frequency,created_at)
   VALUES(?,?,?,?,?,?,?,?)`).bind(id,c.get('userId'),parsed.data.model_id,parsed.data.provider||null,JSON.stringify(parsed.data.events),parsed.data.threshold_pct,parsed.data.frequency,now()).run();
 return c.json({id},201);
});
app.patch('/api/subscriptions/:id',requireAuth,async c=>{
 const parsed=subSchema.omit({model_id:true}).partial().extend({paused:z.boolean().optional()})
  .safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:'Invalid update',details:parsed.error.flatten().fieldErrors},400);
 const userId=c.get('userId'),id=c.req.param('id');
 const old=await c.env.DB.prepare('SELECT id,provider,events_json,threshold_pct,frequency,paused FROM subscriptions WHERE id=? AND user_id=?')
  .bind(id,userId).first<{provider:string|null;events_json:string;threshold_pct:number;frequency:string;paused:number}>();
 if(!old)return c.json({error:'Subscription not found'},404);
 const d=parsed.data;
 const provider=d.provider===undefined?old.provider:d.provider||null;
 const events=d.events===undefined?old.events_json:JSON.stringify(d.events);
 const threshold=d.threshold_pct??old.threshold_pct,frequency=d.frequency??old.frequency;
 const paused=d.paused===undefined?old.paused:(d.paused?1:0);
 await c.env.DB.prepare('UPDATE subscriptions SET provider=?,events_json=?,threshold_pct=?,frequency=?,paused=? WHERE id=? AND user_id=?')
  .bind(provider,events,threshold,frequency,paused,id,userId).run();
 if(paused){
  await c.env.DB.prepare("UPDATE notifications SET status='suppressed' WHERE subscription_id=? AND user_id=? AND status IN ('pending','sending')")
   .bind(id,userId).run();

 }
 return c.json({updated:true,paused:!!paused});
});
app.delete('/api/subscriptions/:id',requireAuth,async c=>{
 const removed=await c.env.DB.prepare('DELETE FROM subscriptions WHERE id=? AND user_id=?').bind(c.req.param('id'),c.get('userId')).run();
 return c.json({deleted:!!removed.meta.changes});
});
app.get('/api/notifications',requireAuth,async c=>{
 const rows=await c.env.DB.prepare(`SELECT n.id,n.status,n.sent_at,n.read_at,n.created_at,n.attempts,n.last_error,
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
 fetch:(request:Request,env:Bindings,ctx:ExecutionContext)=>app.fetch(request,env,ctx)
};

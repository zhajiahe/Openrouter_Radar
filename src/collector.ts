import { listModels, listEndpoints, type UpstreamEndpoint } from './openrouter';
import { parsePrices, endpointId, findPriceChanges, thresholdMatches, type Prices } from './pricing';
import { now, type Bindings, type EventKind } from './types';

type Existing={id:string;input_price:string|null;output_price:string|null;status:string;missing_count:number};
type Observed={modelId:string;provider:string;tag:string;source:'model'|'provider';variant:string;prices:Prices};
const MAX_PER_TICK=25;

export async function refreshCatalog(env:Bindings,fetcher:typeof listModels=listModels):Promise<number>{
 const current=now();
 const lease=await env.DB.prepare("UPDATE sync_state SET leased_until=? WHERE name='catalog' AND leased_until<? AND last_success<?")
 .bind(current+180,current,current-6*3600).run();
 if(!lease.meta.changes)return 0;
 try {
  const models=await fetcher();
  // Avoid deletion on upstream partial responses. Models not returned remain in our catalogue.
  if(models.length===0)throw new Error('Empty model catalogue');
  for(let i=0;i<models.length;i+=40){
   const batch=models.slice(i,i+40).map(m=>env.DB.prepare(`INSERT INTO models(id,name,description,pricing_json,context_length,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
    pricing_json=excluded.pricing_json,context_length=excluded.context_length,updated_at=excluded.updated_at
    WHERE models.name!=excluded.name OR models.pricing_json!=excluded.pricing_json OR models.description!=excluded.description`)
    .bind(m.id,m.name,m.description||'',JSON.stringify(m.pricing||{}),m.context_length||null,current));
   await env.DB.batch(batch);
  }
  await env.DB.prepare("UPDATE sync_state SET last_success=?,leased_until=0,last_error=NULL WHERE name='catalog'").bind(current).run();
  return models.length;
 }catch(e){
  await env.DB.prepare("UPDATE sync_state SET last_error=?,leased_until=0 WHERE name='catalog'").bind(String(e).slice(0,200)).run();
  throw e;
 }
}
type EventRow={id:string;model_id:string;provider:string;kind:EventKind;dimension:string|null;change_pct:number|null;created_at:number};
async function matchEvent(env:Bindings,event:EventRow):Promise<void>{
 const subscriptions=await env.DB.prepare(`SELECT s.id,s.user_id,s.provider,s.events_json,s.threshold_pct,s.frequency
 FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.model_id=? AND u.email_verified=1`)
 .bind(event.model_id).all<{id:string;user_id:string;provider:string|null;events_json:string;threshold_pct:number;frequency:string}>();
 const statements:D1PreparedStatement[]=[];
 for(const sub of subscriptions.results){
  if(sub.provider!==null&&sub.provider!==event.provider)continue;
  let selected:string[];try{selected=JSON.parse(sub.events_json)}catch{continue;}
  if(!selected.includes(event.kind))continue;
  if(event.dimension&&!thresholdMatches(event.change_pct,sub.threshold_pct))continue;
  // Send daily summaries at the first 08:00 UTC after an event.
  const scheduled=sub.frequency==='daily' ? Math.ceil((event.created_at-8*3600)/86400)*86400+8*3600 : now();
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO notifications
   (id,user_id,event_id,subscription_id,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)`)
   .bind(crypto.randomUUID(),sub.user_id,event.id,sub.id,scheduled,event.created_at));
 }
 statements.push(env.DB.prepare('UPDATE price_events SET matched_at=? WHERE id=? AND matched_at IS NULL').bind(now(),event.id));
 // D1 batch rolls back all writes if any insert or the watermark update fails.
 await env.DB.batch(statements);
}
export async function matchUnmatchedEvents(env:Bindings,limit=100):Promise<number>{
 const events=await env.DB.prepare(`SELECT id,model_id,provider,kind,dimension,change_pct,created_at
 FROM price_events WHERE matched_at IS NULL ORDER BY created_at ASC LIMIT ?`).bind(limit).all<EventRow>();
 for(const event of events.results)await matchEvent(env,event);
 return events.results.length;
}
async function emit(env:Bindings,endpointIdValue:string,modelId:string,provider:string,kind:EventKind,dimension:string|null,oldValue:string|null,newValue:string|null,pct:number|null):Promise<void>{
 const eventId=crypto.randomUUID(),ts=now();
 await env.DB.prepare(`INSERT INTO price_events(id,endpoint_id,model_id,provider,kind,dimension,old_price,new_price,change_pct,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(eventId,endpointIdValue,modelId,provider,kind,dimension,oldValue,newValue,pct,ts).run();
 // If rule matching fails, this event remains unmatched and is replayed next Cron.
 await matchEvent(env,{id:eventId,model_id:modelId,provider,kind,dimension,change_pct:pct,created_at:ts});
}
export async function applySnapshot(env:Bindings,observation:Observed,allowAdded=false):Promise<void>{
 const {modelId,provider,tag,source,variant,prices}=observation;
 const id=await endpointId(modelId,provider,tag,variant);
 const previous=await env.DB.prepare('SELECT id,input_price,output_price,status,missing_count FROM endpoints WHERE id=?')
 .bind(id).first<Existing>();
 const ts=now();
 if(!previous){
  await env.DB.prepare(`INSERT INTO endpoints
  (id,model_id,provider,tag,source,input_price,output_price,pricing_json,first_seen,checked_at)
  VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,modelId,provider,tag,source,prices.prompt,prices.completion,JSON.stringify(prices.raw),ts,ts).run();
  if(allowAdded)await emit(env,id,modelId,provider,'endpoint.added',null,null,null,null);
  return;
 }
 const changes=findPriceChanges({prompt:previous.input_price,completion:previous.output_price,raw:{}},prices);
 await env.DB.prepare(`UPDATE endpoints SET input_price=?,output_price=?,pricing_json=?,status='active',
 missing_count=0,checked_at=? WHERE id=?`).bind(prices.prompt,prices.completion,JSON.stringify(prices.raw),ts,id).run();
 if(previous.status==='missing')await emit(env,id,modelId,provider,'endpoint.restored',null,null,null,null);
 for(const change of changes)await emit(env,id,modelId,provider,change.kind,change.dimension,change.oldPrice,change.newPrice,change.percent);
}
export async function collectModel(env:Bindings,modelId:string,fetcher:typeof listEndpoints=listEndpoints):Promise<void>{
 const current=now();
 const lease=await env.DB.prepare('UPDATE collection_jobs SET leased_until=? WHERE model_id=? AND leased_until<?')
 .bind(current+180,modelId,current).run();
 if(!lease.meta.changes)return;
 try{
  let items:UpstreamEndpoint[]|null=null;
  try {items=await fetcher(modelId);if(items.length===0)throw new Error('No endpoints returned; may be transient');}
  catch(e){
   // Degrade to model-level prices, never invent provider data on endpoint API failure.
   const model=await env.DB.prepare('SELECT pricing_json FROM models WHERE id=?').bind(modelId).first<{pricing_json:string}>();
   if(model)await applySnapshot(env,{modelId,provider:'OpenRouter (model aggregate)',tag:'__model__',source:'model',variant:'',prices:parsePrices(JSON.parse(model.pricing_json))});
   throw e;
  }
  const existingRows=await env.DB.prepare("SELECT id,status,missing_count FROM endpoints WHERE model_id=? AND source='provider'").bind(modelId).all<Existing>();
  const previousIds=new Set(existingRows.results.map(row=>row.id));
  const seen=new Set<string>();
  const initial=existingRows.results.length===0;
  for(const item of items){
   const provider=item.provider_name,tag=item.tag||'',variant=[item.quantization||'',String(item.service_tier||''),tag?'':item.name||''].join('|');
   const id=await endpointId(modelId,provider,tag,variant);
   if(seen.has(id))continue;
   seen.add(id);
   await applySnapshot(env,{modelId,provider,tag,source:'provider',variant,prices:parsePrices(item.pricing)},!initial&&!previousIds.has(id));
  }
  for(const row of existingRows.results){
   if(seen.has(row.id)||row.status==='missing')continue;
   const count=row.missing_count+1;
   await env.DB.prepare("UPDATE endpoints SET missing_count=?,status=?,checked_at=? WHERE id=?")
    .bind(count,count>=2?'missing':'active',current,row.id).run();
   if(count>=2){
    const removed=await env.DB.prepare('SELECT provider FROM endpoints WHERE id=?').bind(row.id).first<{provider:string}>();
    await emit(env,row.id,modelId,removed?.provider||'unknown','endpoint.removed',null,null,null,null);
   }
  }
  await env.DB.prepare('UPDATE collection_jobs SET last_checked=?,leased_until=0,last_error=NULL WHERE model_id=?').bind(current,modelId).run();
 }catch(e){
  await env.DB.prepare('UPDATE collection_jobs SET last_checked=?,leased_until=0,last_error=? WHERE model_id=?')
   .bind(current,String(e).slice(0,200),modelId).run();
 }
}
export async function runCollection(env:Bindings):Promise<void>{
 try{await refreshCatalog(env);}catch{/* health endpoint exposes last error */}
 const count=Math.min(Math.max(Number(env.MAX_MODELS_PER_TICK)||10,1),MAX_PER_TICK);
 const jobs=await env.DB.prepare(`SELECT j.model_id FROM collection_jobs j
 JOIN subscriptions s ON s.model_id=j.model_id
 WHERE j.leased_until<? AND j.last_checked<?
 GROUP BY j.model_id ORDER BY j.last_checked ASC LIMIT ?`)
 .bind(now(),now()-3600,count).all<{model_id:string}>();
 for(const job of jobs.results)await collectModel(env,job.model_id);
 await matchUnmatchedEvents(env);
 await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()).run();
 await env.DB.prepare('DELETE FROM email_tokens WHERE expires_at<?').bind(now()).run();
 await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at<?').bind(now()).run();
}

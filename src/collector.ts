import {listModels,listEndpoints,type UpstreamModel,type UpstreamEndpoint} from './openrouter';
import {parsePrices,endpointId,findPriceChanges,thresholdMatches,type Prices} from './pricing';
import {modelState,modelDeltas,expiryWindow,type ModelState} from './phase3';
import {now,type Bindings,type EventKind} from './types';

type Existing={id:string;input_price:string|null;output_price:string|null;pricing_json:string;status:string;missing_count:number};
type ModelRow=ModelState&{id:string;name:string;description:string;pricing_json:string};
type Observation={modelId:string;provider:string;tag:string;source:'model'|'provider';variant:string;prices:Prices};
type EventRow={id:string;model_id:string;provider:string;kind:EventKind;dimension:string|null;change_pct:number|null;created_at:number};
const MODEL_PROVIDER='OpenRouter (model aggregate)';
function eventStatement(env:Bindings,eventId:string,endpoint:string,model:string,provider:string,kind:EventKind,dimension:string|null,oldValue:string|null,newValue:string|null,pct:number|null,ts:number):D1PreparedStatement{
 return env.DB.prepare("INSERT OR IGNORE INTO price_events (id,endpoint_id,model_id,provider,kind,dimension,old_price,new_price,change_pct,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
  .bind(eventId,endpoint,model,provider,kind,dimension,oldValue,newValue,pct,ts);
}
function event(env:Bindings,endpoint:string,model:string,provider:string,kind:EventKind,dimension:string|null=null,oldValue:string|null=null,newValue:string|null=null,pct:number|null=null,ts=now()):D1PreparedStatement{
 return eventStatement(env,crypto.randomUUID(),endpoint,model,provider,kind,dimension,oldValue,newValue,pct,ts);
}
function storedPrices(raw:string):Prices{try{return parsePrices(JSON.parse(raw));}catch{return parsePrices({});}}

export const CATALOG_INTERVAL_SECONDS=3600;
export const PROVIDER_INTERVAL_SECONDS=3600;
export const DEFAULT_MODELS_PER_TICK=15;
export const MAX_MODELS_PER_TICK=25;

export function modelsPerTick(configured?:string):number{
 const value=Number(configured);
 return Number.isFinite(value)&&value>=1
  ?Math.min(Math.floor(value),MAX_MODELS_PER_TICK):DEFAULT_MODELS_PER_TICK;
}

/**
 * Load current baselines in pages to avoid one D1 round trip per model.
 * Subscriptions never affect which models get Provider scans.
 */
async function existingModels(env:Bindings):Promise<Map<string,ModelRow>>{
 const models=new Map<string,ModelRow>();
 let cursor='';
 for(;;){
  const page=await env.DB.prepare("SELECT id,name,description,pricing_json,context_length,capabilities_json,expiration_date,alias_target FROM models WHERE id>? ORDER BY id LIMIT 500")
   .bind(cursor).all<ModelRow>();
  for(const row of page.results)models.set(row.id,row);
  if(page.results.length<500)break;
  cursor=page.results[page.results.length-1].id;
 }
 return models;
}

export async function refreshCatalog(env:Bindings,fetcher:typeof listModels=listModels):Promise<number>{
 const current=now();
 const lease=await env.DB.prepare("UPDATE sync_state SET leased_until=? WHERE name='catalog' AND leased_until<? AND last_success<?")
  .bind(current+300,current,current-CATALOG_INTERVAL_SECONDS).run();
 if(!lease.meta.changes)return 0;
 try{
  const models=await fetcher(env.OPENROUTER_API_KEY||'');
  if(models.length===0)throw new Error('Empty model catalogue');
  const previous=await existingModels(env);
  let stmts:D1PreparedStatement[]=[];
  for(const m of models){
   const old=previous.get(m.id);
   const state=modelState(m,old),raw=m.pricing??(old?storedPrices(old.pricing_json).raw:{});
   const prices=parsePrices(raw),aggregate=await endpointId(m.id,MODEL_PROVIDER,'__model__');
   stmts.push(env.DB.prepare("INSERT INTO models (id,name,description,pricing_json,context_length,capabilities_json,expiration_date,alias_target,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,pricing_json=excluded.pricing_json,context_length=excluded.context_length,capabilities_json=excluded.capabilities_json,expiration_date=excluded.expiration_date,alias_target=excluded.alias_target,updated_at=excluded.updated_at")
    .bind(m.id,m.name,m.description??old?.description??'',JSON.stringify(raw),state.context_length,state.capabilities_json,state.expiration_date,state.alias_target,current));
   stmts.push(env.DB.prepare("INSERT INTO endpoints (id,model_id,provider,tag,source,input_price,output_price,pricing_json,first_seen,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET input_price=excluded.input_price,output_price=excluded.output_price,pricing_json=excluded.pricing_json,status='active',missing_count=0,checked_at=excluded.checked_at")
    .bind(aggregate,m.id,MODEL_PROVIDER,'__model__','model',prices.prompt,prices.completion,JSON.stringify(raw),current,current));
   stmts.push(env.DB.prepare("INSERT OR IGNORE INTO collection_jobs(model_id) VALUES(?)").bind(m.id));
   if(old){
    for(const delta of modelDeltas(old,state))
     stmts.push(event(env,aggregate,m.id,MODEL_PROVIDER,delta.kind,delta.dimension,delta.oldValue,delta.newValue,null,current));
    for(const delta of findPriceChanges(storedPrices(old.pricing_json),prices))
     stmts.push(event(env,aggregate,m.id,MODEL_PROVIDER,delta.kind,delta.dimension,delta.oldPrice,delta.newPrice,delta.percent,current));
   }
   if(stmts.length>=50){await env.DB.batch(stmts);stmts=[];}
  }
  if(stmts.length)await env.DB.batch(stmts);
  await env.DB.prepare("UPDATE sync_state SET last_success=?,leased_until=0,last_error=NULL WHERE name='catalog'").bind(current).run();
  return models.length;
 }catch(e){
  await env.DB.prepare("UPDATE sync_state SET last_error=?,leased_until=0 WHERE name='catalog'").bind(String(e).slice(0,200)).run();
  throw e;
 }
}

async function matchEvent(env:Bindings,record:EventRow):Promise<void>{
 const subs=await env.DB.prepare("SELECT s.id,s.user_id,s.provider,s.events_json,s.threshold_pct,s.frequency FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.model_id=? AND u.email_verified=1").bind(record.model_id)
  .all<{id:string;user_id:string;provider:string|null;events_json:string;threshold_pct:number;frequency:string}>();
 const stmts:D1PreparedStatement[]=[];
 for(const sub of subs.results){
  if(sub.provider!==null&&sub.provider!==record.provider)continue;
  let selected:string[];try{selected=JSON.parse(sub.events_json);}catch{continue;}
  if(!selected.includes(record.kind))continue;
  if((record.kind==='price.increased'||record.kind==='price.decreased')&&!thresholdMatches(record.change_pct,sub.threshold_pct))continue;
  const scheduled=sub.frequency==='daily'?Math.ceil((record.created_at-8*3600)/86400)*86400+8*3600:now();
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (id,user_id,event_id,subscription_id,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)")
   .bind(crypto.randomUUID(),sub.user_id,record.id,sub.id,scheduled,record.created_at));
 }
 stmts.push(env.DB.prepare('UPDATE price_events SET matched_at=? WHERE id=? AND matched_at IS NULL').bind(now(),record.id));
 await env.DB.batch(stmts);
}
export async function matchUnmatchedEvents(env:Bindings,limit=100):Promise<number>{
 const records=await env.DB.prepare("SELECT id,model_id,provider,kind,dimension,change_pct,created_at FROM price_events WHERE matched_at IS NULL ORDER BY created_at ASC LIMIT ?").bind(limit).all<EventRow>();
 for(const record of records.results)await matchEvent(env,record);
 return records.results.length;
}
export async function applySnapshot(env:Bindings,o:Observation,allowAdded=false):Promise<void>{
 const {modelId,provider,tag,source,variant,prices}=o,id=await endpointId(modelId,provider,tag,variant);
 const previous=await env.DB.prepare('SELECT id,input_price,output_price,pricing_json,status,missing_count FROM endpoints WHERE id=?').bind(id).first<Existing>();
 const ts=now();
 if(!previous){
  const stmts:D1PreparedStatement[]=[
   env.DB.prepare("INSERT INTO endpoints (id,model_id,provider,tag,source,input_price,output_price,pricing_json,first_seen,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .bind(id,modelId,provider,tag,source,prices.prompt,prices.completion,JSON.stringify(prices.raw),ts,ts)
  ];
  if(allowAdded)stmts.push(event(env,id,modelId,provider,'endpoint.added',null,null,null,null,ts));
  await env.DB.batch(stmts);return;
 }
 const changes=findPriceChanges(storedPrices(previous.pricing_json),prices);
 // A successful sweep is recorded on collection_jobs. Do not rewrite identical
 // endpoint rows every hour, which would exhaust D1 Free daily write limits.
 if(previous.status==='active'&&previous.missing_count===0&&changes.length===0)return;
 const stmts:D1PreparedStatement[]=[
  env.DB.prepare("UPDATE endpoints SET input_price=?,output_price=?,pricing_json=?,status='active',missing_count=0,checked_at=? WHERE id=?")
   .bind(prices.prompt,prices.completion,JSON.stringify(prices.raw),ts,id)
 ];
 if(previous.status==='missing')stmts.push(event(env,id,modelId,provider,'endpoint.restored',null,null,null,null,ts));
 for(const delta of changes){
  stmts.push(event(env,id,modelId,provider,delta.kind,delta.dimension,delta.oldPrice,delta.newPrice,delta.percent,ts));
 }
 await env.DB.batch(stmts);
}
export async function collectModel(env:Bindings,modelId:string,fetcher:typeof listEndpoints=listEndpoints):Promise<void>{
 const current=now(),lease=await env.DB.prepare('UPDATE collection_jobs SET leased_until=? WHERE model_id=? AND leased_until<?')
  .bind(current+180,modelId,current).run();
 if(!lease.meta.changes)return;
 try{
  if(!env.OPENROUTER_API_KEY)throw new Error('OPENROUTER_API_KEY is not configured');
  const items:UpstreamEndpoint[]=await fetcher(modelId,env.OPENROUTER_API_KEY);
  if(items.length===0)throw new Error('Empty endpoint response; no removal inferred');
  const existing=await env.DB.prepare("SELECT id,provider,status,missing_count FROM endpoints WHERE model_id=? AND source='provider'").bind(modelId)
   .all<{id:string;provider:string;status:string;missing_count:number}>();
  const prev=new Set(existing.results.map(row=>row.id)),seen=new Set<string>(),initial=existing.results.length===0;
  for(const item of items){
   const provider=item.provider_name,tag=item.tag||'';
   const variant=[item.quantization||'',String(item.service_tier||''),tag?'':item.name||''].join('|');
   const id=await endpointId(modelId,provider,tag,variant);
   if(seen.has(id))continue;
   seen.add(id);
   await applySnapshot(env,{modelId,provider,tag,source:'provider',variant,prices:parsePrices(item.pricing)},!initial&&!prev.has(id));
  }
  for(const row of existing.results){
   if(seen.has(row.id)||row.status==='missing')continue;
   const count=row.missing_count+1,stmts:D1PreparedStatement[]=[
    env.DB.prepare('UPDATE endpoints SET missing_count=?,status=?,checked_at=? WHERE id=?')
     .bind(count,count>=2?'missing':'active',current,row.id)
   ];
   if(count>=2)stmts.push(event(env,row.id,modelId,row.provider,'endpoint.removed',null,null,null,null,current));
   await env.DB.batch(stmts);
  }
  await env.DB.prepare('UPDATE collection_jobs SET last_checked=?,leased_until=0,last_error=NULL WHERE model_id=?').bind(current,modelId).run();
 }catch(e){
  await env.DB.prepare('UPDATE collection_jobs SET last_checked=?,leased_until=0,last_error=? WHERE model_id=?').bind(current,String(e).slice(0,200),modelId).run();
 }
}
export async function emitExpiryAlerts(env:Bindings):Promise<number>{
 const current=now();
 const rows=await env.DB.prepare("SELECT m.id,m.expiration_date,e.id AS endpoint_id FROM models m JOIN endpoints e ON e.model_id=m.id AND e.source='model' WHERE m.expiration_date>? AND m.expiration_date<=? LIMIT 500")
  .bind(current,current+30*86400).all<{id:string;expiration_date:number;endpoint_id:string}>();
 const stmts:D1PreparedStatement[]=[];
 for(const row of rows.results){
  const window=expiryWindow(row.expiration_date,current);if(!window)continue;
  const id=['expiry',row.id,row.expiration_date,window].join(':');
  stmts.push(eventStatement(env,id,row.endpoint_id,row.id,MODEL_PROVIDER,'model.expiring','days_remaining',null,String(window),null,current));
 }
 for(let i=0;i<stmts.length;i+=50)await env.DB.batch(stmts.slice(i,i+50));
 return stmts.length;
}
export async function runCollection(env:Bindings):Promise<void>{
 try{await refreshCatalog(env);}catch{/* Catalog error remains visible in /api/health */}
 const count=modelsPerTick(env.MAX_MODELS_PER_TICK);
 const jobs=await env.DB.prepare('SELECT model_id FROM collection_jobs WHERE leased_until<? AND last_checked<? ORDER BY last_checked ASC,model_id ASC LIMIT ?')
  .bind(now(),now()-PROVIDER_INTERVAL_SECONDS,count).all<{model_id:string}>();
 // At most three upstream endpoint requests in flight at a time.
 for(let i=0;i<jobs.results.length;i+=3){
  await Promise.all(jobs.results.slice(i,i+3).map(job=>collectModel(env,job.model_id)));
 }
 await emitExpiryAlerts(env);
 await matchUnmatchedEvents(env);
 await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()).run();
 await env.DB.prepare('DELETE FROM email_tokens WHERE expires_at<?').bind(now()).run();
 await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at<?').bind(now()).run();
}

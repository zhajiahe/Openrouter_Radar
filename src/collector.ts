import {listModels,listEndpoints,listImageModels,listImageEndpoints,type UpstreamModel,type UpstreamEndpoint,type UpstreamImageEndpoint} from './openrouter';
import {imageCharges,imageRaw,storedImageCharges,findImagePriceChanges,type ImageCharge} from './image-pricing';
import {parsePrices,endpointId,findPriceChanges,thresholdMatches,type Prices} from './pricing';
import {modelState,modelDeltas,expiryWindow,type ModelState} from './phase3';
import {now,type Bindings,type EventKind} from './types';
import {historyStatements,missingHistoryStatements,imageHistoryStatements,prunePriceHistory} from './history';

type Existing={id:string;provider:string;tag:string;input_price:string|null;output_price:string|null;pricing_json:string;status:string;missing_count:number;history_seeded:number;stable_key:string|null};
type ModelRow=ModelState&{id:string;name:string;description:string;pricing_json:string;model_kind:string;lifecycle_status:string;missing_count:number};
type Observation={modelId:string;provider:string;tag:string;source:'model'|'provider';variant:string;prices:Prices;stableKey?:string;existingId?:string;image?:ImageCharge[];snapshotId?:string;previous?:Existing|null};
type EventRow={id:string;model_id:string;provider:string;kind:EventKind;dimension:string|null;change_pct:number|null;created_at:number};
const MODEL_PROVIDER='OpenRouter (model aggregate)';
function eventStatement(env:Bindings,eventId:string,endpoint:string,model:string,provider:string,kind:EventKind,dimension:string|null,oldValue:string|null,newValue:string|null,pct:number|null,ts:number,snapshotId:string|null=null):D1PreparedStatement{
 return env.DB.prepare("INSERT OR IGNORE INTO price_events (id,endpoint_id,model_id,provider,kind,dimension,old_price,new_price,change_pct,created_at,snapshot_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
  .bind(eventId,endpoint,model,provider,kind,dimension,oldValue,newValue,pct,ts,snapshotId);
}
function event(env:Bindings,endpoint:string,model:string,provider:string,kind:EventKind,dimension:string|null=null,oldValue:string|null=null,newValue:string|null=null,pct:number|null=null,ts=now(),snapshotId:string|null=null):D1PreparedStatement{
 return eventStatement(env,crypto.randomUUID(),endpoint,model,provider,kind,dimension,oldValue,newValue,pct,ts,snapshotId);
}
function storedPrices(raw:string):Prices{try{return parsePrices(JSON.parse(raw));}catch{return parsePrices({});}}

export const CATALOG_INTERVAL_SECONDS=3600;
export const PROVIDER_INTERVAL_SECONDS=3600;
export const DEFAULT_MODELS_PER_TICK=15;
export const MAX_MODELS_PER_TICK=25;

export function modelLifecycleTransition(status:string,misses:number,found:boolean):{
 status:'active'|'removed';misses:number;event:'model.removed'|'model.restored'|null
}{
 if(found)return {status:'active',misses:0,event:status==='removed'?'model.restored':null};
 if(status==='removed')return {status:'removed',misses,event:null};
 const next=misses+1;
 return {status:next>=2?'removed':'active',misses:next,event:next===2?'model.removed':null};
}

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
  const page=await env.DB.prepare("SELECT id,name,description,pricing_json,context_length,capabilities_json,expiration_date,alias_target,model_kind,lifecycle_status,missing_count FROM models WHERE id>? ORDER BY id LIMIT 500")
   .bind(cursor).all<ModelRow>();
  for(const row of page.results)models.set(row.id,row);
  if(page.results.length<500)break;
  cursor=page.results[page.results.length-1].id;
 }
 return models;
}


/** Each upstream catalogue has its own successful-scan watermark. */
async function syncCatalog(env:Bindings,kind:'standard'|'image',fetcher:typeof listModels):Promise<number>{
 const name=kind==='image'?'images_catalog':'catalog',current=now();
 const lease=await env.DB.prepare('UPDATE sync_state SET leased_until=? WHERE name=? AND leased_until<? AND last_success<?')
  .bind(current+300,name,current,current-CATALOG_INTERVAL_SECONDS).run();
 if(!lease.meta.changes)return 0;
 try{
  const models=await fetcher(env.OPENROUTER_API_KEY||'');
  if(!models.length)throw new Error('Empty '+name+' catalogue');
  const previous=await existingModels(env);
  const prior=await env.DB.prepare('SELECT last_success FROM sync_state WHERE name=?').bind(name).first<{last_success:number}>();
  const tracked=[...previous.values()].filter(m=>m.model_kind===kind&&m.lifecycle_status==='active');
  if(tracked.length>=10&&models.length<Math.ceil(tracked.length*0.8))
   throw new Error('Incomplete '+name+' catalogue; removals not inferred');
  const seen=new Set<string>();
  let stmts:D1PreparedStatement[]=[];
  for(const m of models){
   const old=previous.get(m.id);
   if(kind==='standard'&&old?.model_kind==='image')continue;
   seen.add(m.id);
   const state=modelState(m,old);
   const raw=kind==='image'?(old?storedPrices(old.pricing_json).raw:{}):m.pricing??(old?storedPrices(old.pricing_json).raw:{});
   const prices=parsePrices(raw),aggregate=await endpointId(m.id,MODEL_PROVIDER,'__model__');
   const rawJson=JSON.stringify(raw);
   const description=m.description??old?.description??'';
   const modelChanged=!old||old.model_kind!==kind||old.lifecycle_status!=='active'||old.missing_count!==0||
    old.name!==m.name||old.description!==description||old.pricing_json!==rawJson||
    old.context_length!==state.context_length||old.capabilities_json!==state.capabilities_json||
    old.expiration_date!==state.expiration_date||old.alias_target!==state.alias_target;
   const aggregateChanged=!old||old.model_kind!==kind||old.lifecycle_status!=='active'||old.pricing_json!==rawJson;
   // Hourly HTTP sync must not imply hourly D1 writes. Preserve stable updated_at/history.
   if(modelChanged)stmts.push(env.DB.prepare("INSERT INTO models (id,name,description,pricing_json,context_length,capabilities_json,expiration_date,alias_target,updated_at,model_kind,lifecycle_status,missing_count) VALUES(?,?,?,?,?,?,?,?,?,?, 'active',0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,pricing_json=excluded.pricing_json,context_length=excluded.context_length,capabilities_json=excluded.capabilities_json,expiration_date=excluded.expiration_date,alias_target=excluded.alias_target,updated_at=CASE WHEN models.name<>excluded.name OR models.description<>excluded.description OR models.pricing_json<>excluded.pricing_json OR models.context_length IS NOT excluded.context_length OR models.capabilities_json<>excluded.capabilities_json OR models.expiration_date IS NOT excluded.expiration_date OR models.alias_target IS NOT excluded.alias_target THEN excluded.updated_at ELSE models.updated_at END,model_kind=excluded.model_kind,lifecycle_status='active',missing_count=0")
    .bind(m.id,m.name,description,rawJson,state.context_length,state.capabilities_json,state.expiration_date,state.alias_target,current,kind));
   if(aggregateChanged)stmts.push(env.DB.prepare("INSERT INTO endpoints (id,model_id,provider,tag,source,input_price,output_price,pricing_json,first_seen,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET input_price=excluded.input_price,output_price=excluded.output_price,pricing_json=excluded.pricing_json,status='active',missing_count=0,checked_at=excluded.checked_at")
    .bind(aggregate,m.id,MODEL_PROVIDER,'__model__','model',prices.prompt,prices.completion,rawJson,current,current));
   if(!old)stmts.push(env.DB.prepare('INSERT OR IGNORE INTO collection_jobs(model_id) VALUES(?)').bind(m.id));
   if(aggregateChanged)stmts.push(...historyStatements(env,aggregate,m.id,MODEL_PROVIDER,'model',prices,old?storedPrices(old.pricing_json):null,current));
   const snap=crypto.randomUUID();
   if(old){
    if(old.model_kind===kind&&modelLifecycleTransition(old.lifecycle_status,old.missing_count,true).event==='model.restored')stmts.push(event(env,aggregate,m.id,MODEL_PROVIDER,'model.restored',null,null,null,null,current,snap));
    for(const delta of (old.model_kind===kind?modelDeltas(old,state):[]))
     stmts.push(event(env,aggregate,m.id,MODEL_PROVIDER,delta.kind,delta.dimension,delta.oldValue,delta.newValue,null,current,snap));
    if(kind==='standard')for(const delta of findPriceChanges(storedPrices(old.pricing_json),prices))
     stmts.push(event(env,aggregate,m.id,MODEL_PROVIDER,delta.kind,delta.dimension,delta.oldPrice,delta.newPrice,delta.percent,current,snap));
   }else if(prior?.last_success){
    stmts.push(event(env,aggregate,m.id,MODEL_PROVIDER,'model.added',null,null,null,null,current,snap));
   }
   if(stmts.length>=50){await env.DB.batch(stmts);stmts=[];}
  }
  if(stmts.length)await env.DB.batch(stmts);
  // Never interpret failed or anomalously small responses as removals.
  stmts=[];
  for(const old of previous.values()){
   if(old.model_kind!==kind||seen.has(old.id)||old.lifecycle_status==='removed')continue;
   const next=modelLifecycleTransition(old.lifecycle_status,old.missing_count,false);
   stmts.push(env.DB.prepare('UPDATE models SET missing_count=?,lifecycle_status=? WHERE id=?')
    .bind(next.misses,next.status,old.id));
   if(next.event==='model.removed'){
    const aggregate=await endpointId(old.id,MODEL_PROVIDER,'__model__');
    stmts.push(event(env,aggregate,old.id,MODEL_PROVIDER,'model.removed',null,null,null,null,current));
   }
   if(stmts.length>=50){await env.DB.batch(stmts);stmts=[];}
  }
  if(stmts.length)await env.DB.batch(stmts);
  await env.DB.prepare('UPDATE sync_state SET last_success=?,leased_until=0,last_error=NULL WHERE name=?').bind(current,name).run();
  return models.length;
 }catch(e){
  await env.DB.prepare('UPDATE sync_state SET last_error=?,leased_until=0 WHERE name=?').bind(String(e).slice(0,200),name).run();
  throw e;
 }
}
export async function refreshCatalog(env:Bindings,fetcher:typeof listModels=listModels):Promise<number>{
 return syncCatalog(env,'standard',fetcher);
}
export async function refreshImageCatalog(env:Bindings,fetcher:typeof listModels=listImageModels):Promise<number>{
 return syncCatalog(env,'image',fetcher);
}

type SubRow={id:string;user_id:string;provider:string|null;price_dimension:string|null;events_json:string;threshold_pct:number;frequency:string};
async function matchEvent(env:Bindings,record:EventRow,subs:SubRow[]):Promise<void>{
 const stmts:D1PreparedStatement[]=[];
 for(const sub of subs){
  if(sub.provider!==null&&sub.provider!==record.provider)continue;
  if(sub.price_dimension&&record.kind.startsWith('price.')&&sub.price_dimension!==record.dimension)continue;
  if(sub.price_dimension&&record.kind.startsWith('image.price_')&&sub.price_dimension!==record.dimension)continue;
  let selected:string[];try{selected=JSON.parse(sub.events_json);}catch{continue;}
  if(!selected.includes(record.kind))continue;
  if((record.kind==='price.increased'||record.kind==='price.decreased'||record.kind==='image.price_increased'||record.kind==='image.price_decreased')&&!thresholdMatches(record.change_pct,sub.threshold_pct))continue;
  const scheduled=sub.frequency==='daily'?Math.ceil((record.created_at-8*3600)/86400)*86400+8*3600:Math.max(now(),record.created_at+120); // same snapshot shares the same deadline
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO notifications (id,user_id,event_id,subscription_id,next_attempt_at,created_at) VALUES(?,?,?,?,?,?)")
   .bind(crypto.randomUUID(),sub.user_id,record.id,sub.id,scheduled,record.created_at));

 }
 stmts.push(env.DB.prepare('UPDATE price_events SET matched_at=? WHERE id=? AND matched_at IS NULL').bind(now(),record.id));
 await env.DB.batch(stmts);
}
export async function matchUnmatchedEvents(env:Bindings,limit=100):Promise<number>{
 const records=await env.DB.prepare("SELECT id,model_id,provider,kind,dimension,change_pct,created_at FROM price_events WHERE matched_at IS NULL AND quality='observed' ORDER BY created_at ASC LIMIT ?").bind(limit).all<EventRow>();
 // A price change often emits several dimensions for the same model.
 // Reuse subscriber lists within this replay window instead of N+1 reads.
 const subscribers=new Map<string,SubRow[]>();
 for(const record of records.results){
  let subs=subscribers.get(record.model_id);
  if(!subs){
   const result=await env.DB.prepare("SELECT s.id,s.user_id,s.provider,s.price_dimension,s.events_json,s.threshold_pct,s.frequency FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.model_id=? AND u.email_verified=1 AND s.paused=0")
    .bind(record.model_id).all<SubRow>();
   subs=result.results;
   subscribers.set(record.model_id,subs);
  }
  await matchEvent(env,record,subs);
 }
 return records.results.length;
}
export async function applySnapshot(env:Bindings,o:Observation,allowAdded=false):Promise<void>{
 const {modelId,provider,tag,source,variant,prices}=o,id=o.existingId??await endpointId(modelId,provider,tag,variant);
 const raw=o.image?imageRaw(o.image):prices.raw;
 const previous=o.previous===undefined
  ?await env.DB.prepare('SELECT id,provider,tag,input_price,output_price,pricing_json,status,missing_count,history_seeded,stable_key FROM endpoints WHERE id=?').bind(id).first<Existing>()
  :o.previous;
 const ts=now();
 if(!previous){
  const stmts:D1PreparedStatement[]=[
   env.DB.prepare("INSERT INTO endpoints (id,model_id,provider,tag,source,input_price,output_price,pricing_json,first_seen,checked_at,history_seeded,stable_key) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)")
    .bind(id,modelId,provider,tag,source,prices.prompt,prices.completion,JSON.stringify(raw),ts,ts,o.stableKey??null)
  ];
  stmts.push(...(o.image?imageHistoryStatements(env,id,modelId,provider,o.image,null,ts):historyStatements(env,id,modelId,provider,source,prices,null,ts)));
  if(allowAdded)stmts.push(event(env,id,modelId,provider,'endpoint.added',null,null,null,null,ts,o.snapshotId??null));
  await env.DB.batch(stmts);return;
 }
 const changes=o.image
  ?(previous.pricing_json.includes('"image_pricing"')?findImagePriceChanges(storedImageCharges(previous.pricing_json),o.image):[])
  :findPriceChanges(storedPrices(previous.pricing_json),prices);
 // A successful sweep is recorded on collection_jobs. Do not rewrite identical
 // endpoint rows every hour, which would exhaust D1 Free daily write limits.
 if(previous.status==='active'&&previous.missing_count===0&&changes.length===0&&previous.history_seeded===1&&previous.stable_key===(o.stableKey??null)&&previous.provider===provider&&previous.tag===tag&&(!o.image||previous.pricing_json===JSON.stringify(raw)))return;
 const stmts:D1PreparedStatement[]=[
  env.DB.prepare("UPDATE endpoints SET provider=?,tag=?,input_price=?,output_price=?,pricing_json=?,status='active',missing_count=0,checked_at=?,history_seeded=1,stable_key=? WHERE id=?")
   .bind(provider,tag,prices.prompt,prices.completion,JSON.stringify(raw),ts,o.stableKey??null,id)
 ];
 if(previous.status==='missing')stmts.push(event(env,id,modelId,provider,'endpoint.restored',null,null,null,null,ts,o.snapshotId??null));
 for(const delta of changes){
  stmts.push(event(env,id,modelId,provider,delta.kind,delta.dimension,delta.oldPrice,delta.newPrice,delta.percent,ts,o.snapshotId??null));
 }
 if(o.image){
  stmts.push(...imageHistoryStatements(env,id,modelId,provider,o.image,previous.history_seeded===1?storedImageCharges(previous.pricing_json):null,ts));
 }else{
  stmts.push(...(previous.history_seeded===1
   ?historyStatements(env,id,modelId,provider,source,prices,storedPrices(previous.pricing_json),ts)
   :missingHistoryStatements(env,id,modelId,provider,source,prices,ts)));
 }
 await env.DB.batch(stmts);
}
/** Stable provider identity does not incorporate mutable name, quantization or tier. */
export function stableEndpointKey(provider:string,tag:string):string{
 return JSON.stringify([provider.trim().toLowerCase(),tag.trim().toLowerCase()]);
}
export async function collectModel(env:Bindings,modelId:string,fetcher:typeof listEndpoints=listEndpoints,
 imageFetcher:typeof listImageEndpoints=listImageEndpoints):Promise<void>{
 const current=now(),lease=await env.DB.prepare('UPDATE collection_jobs SET leased_until=? WHERE model_id=? AND leased_until<?')
  .bind(current+180,modelId,current).run();
 if(!lease.meta.changes)return;
 try{
  if(!env.OPENROUTER_API_KEY)throw new Error('OPENROUTER_API_KEY is not configured');
  const model=await env.DB.prepare('SELECT model_kind,lifecycle_status FROM models WHERE id=?').bind(modelId)
   .first<{model_kind:string;lifecycle_status:string}>();
  if(!model||model.lifecycle_status==='removed'){
   await env.DB.prepare('UPDATE collection_jobs SET leased_until=0 WHERE model_id=?').bind(modelId).run();
   return;
  }
  const isImage=model.model_kind==='image';
  const items: (UpstreamEndpoint|UpstreamImageEndpoint)[]=isImage
   ?await imageFetcher(modelId,env.OPENROUTER_API_KEY)
   :await fetcher(modelId,env.OPENROUTER_API_KEY);
  if(items.length===0)throw new Error('Empty endpoint response; no removal inferred');
  const existing=await env.DB.prepare("SELECT id,provider,tag,input_price,output_price,pricing_json,history_seeded,stable_key,status,missing_count FROM endpoints WHERE model_id=? AND source='provider'")
   .bind(modelId).all<Existing>();
  const prev=new Set(existing.results.map(r=>r.id));
  const seen=new Set<string>(),initial=existing.results.filter(r=>r.status!=='superseded').length===0;
  const assigned=new Set<string>();
  const counts=new Map<string,number>();
  for(const item of items){
   const tag='provider_tag' in item?item.provider_tag:('tag' in item?item.tag:'');
   const slug='provider_slug' in item?item.provider_slug:item.provider_name;
   const key=stableEndpointKey(String(slug||item.provider_name),String(tag||''));
   counts.set(key,(counts.get(key)||0)+1);
  }
  const ordinals=new Map<string,number>();
  for(const item of items){
   const provider=item.provider_name;
   const rawTag='provider_tag' in item?item.provider_tag:undefined;
   const rawFallback='tag' in item?item.tag:undefined;
   const tag=isImage
    ?(typeof rawTag==='string'?rawTag:'')
    :(typeof rawFallback==='string'&&rawFallback?rawFallback:typeof rawTag==='string'?rawTag:'');
   const rawSlug='provider_slug' in item?item.provider_slug:undefined;
   const slug=typeof rawSlug==='string'&&rawSlug?rawSlug:provider;
   const baseKey=stableEndpointKey(slug,tag);
   const ordinal=ordinals.get(baseKey)||0;ordinals.set(baseKey,ordinal+1);
   const suffix=(counts.get(baseKey)||0)>1?JSON.stringify(['variant',
    String('name' in item?item.name||'':''),String('quantization' in item?item.quantization||'':''),
    String('service_tier' in item?item.service_tier||'':''),ordinal]):'';
   const key=baseKey+suffix;
   // Legacy database keys can include quantization/tier/name. Reuse their IDs
   // to retain historical events and price points rather than rekeying FKs.
   const candidates=existing.results.filter(r=>r.status!=='superseded'&&!seen.has(r.id)&&
    (r.stable_key===key||(r.stable_key===null||r.stable_key===baseKey)&&(r.provider===provider&&r.tag===tag)));
   const chosen=candidates.find(r=>r.stable_key===key)??candidates.find(r=>r.status==='active')??candidates[0];
   const id=chosen?.id??await endpointId(modelId,provider,tag,suffix);
   if(assigned.has(key)||seen.has(id))continue;
   assigned.add(key);seen.add(id);
   const image=isImage?imageCharges((item as UpstreamImageEndpoint).pricing):undefined;
   await applySnapshot(env,{modelId,provider,tag,source:'provider',variant:'',
    prices:isImage?parsePrices({}):parsePrices((item as UpstreamEndpoint).pricing),
    stableKey:key,existingId:chosen?.id,previous:chosen??null,image,snapshotId:crypto.randomUUID()},!initial&&!prev.has(id));
   // Historical variants of the same provider/tag no longer count as endpoints;
   // retire them quietly, without spurious "provider removed" events.
   for(const duplicate of candidates)if(duplicate.id!==id&&duplicate.stable_key===key){
    seen.add(duplicate.id);
    await env.DB.prepare("UPDATE endpoints SET status='superseded',missing_count=0 WHERE id=?")
     .bind(duplicate.id).run();
   }
  }
  for(const row of existing.results){
   if(seen.has(row.id)||row.status==='missing'||row.status==='superseded')continue;
   const count=row.missing_count+1,stmts:D1PreparedStatement[]=[
    env.DB.prepare('UPDATE endpoints SET missing_count=?,status=?,checked_at=? WHERE id=?')
     .bind(count,count>=2?'missing':'active',current,row.id)
   ];
   if(count===2)stmts.push(event(env,row.id,modelId,row.provider,'endpoint.removed',null,null,null,null,current));
   await env.DB.batch(stmts);
  }
  await env.DB.prepare('UPDATE collection_jobs SET last_checked=?,last_success=?,leased_until=0,last_error=NULL WHERE model_id=?')
   .bind(current,current,modelId).run();
 }catch(e){
  await env.DB.prepare('UPDATE collection_jobs SET last_checked=?,leased_until=0,last_error=? WHERE model_id=?')
   .bind(current,String(e).slice(0,200),modelId).run();
 }
}
export async function emitExpiryAlerts(env:Bindings):Promise<number>{
 const current=now();
 const rows=await env.DB.prepare("SELECT m.id,m.expiration_date,e.id AS endpoint_id FROM models m JOIN endpoints e ON e.model_id=m.id AND e.source='model' WHERE m.lifecycle_status='active' AND m.expiration_date>? AND m.expiration_date<=? LIMIT 500")
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
 try{await refreshImageCatalog(env);}catch{/* Image catalogue retains its previous successful snapshot */}
 const count=modelsPerTick(env.MAX_MODELS_PER_TICK);
 const jobs=await env.DB.prepare("SELECT j.model_id FROM collection_jobs j JOIN models m ON m.id=j.model_id WHERE m.lifecycle_status='active' AND j.leased_until<? AND j.last_checked<? ORDER BY j.last_checked ASC,j.model_id ASC LIMIT ?")
  .bind(now(),now()-PROVIDER_INTERVAL_SECONDS,count).all<{model_id:string}>();
 // At most three upstream endpoint requests in flight at a time.
 for(let i=0;i<jobs.results.length;i+=3){
  await Promise.all(jobs.results.slice(i,i+3).map(job=>collectModel(env,job.model_id)));
 }
 await matchUnmatchedEvents(env);
}
/** Run infrequent retention and expiry work once per UTC day, not each minute. */
export async function runHousekeeping(env:Bindings):Promise<void>{
 await emitExpiryAlerts(env);
 await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()).run();
 await env.DB.prepare('DELETE FROM email_tokens WHERE expires_at<?').bind(now()).run();
 await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at<?').bind(now()).run();
 await prunePriceHistory(env);
}

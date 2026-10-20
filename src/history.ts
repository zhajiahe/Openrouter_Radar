import { now, type Bindings } from './types';
import { observedPrices } from './pricing';
import type { Prices } from './pricing';
import type { ImageCharge } from './image-pricing';
import { imageChargeDimension } from './image-pricing';

/** Sparse, observed-only baselines and price changes, with explicit billing units. */
export function historyStatements(env:Bindings,endpointId:string,modelId:string,provider:string,source:'model'|'provider',current:Prices,previous:Prices|null,ts=now()):D1PreparedStatement[]{
 const old=new Map(previous?observedPrices(previous).map(p=>[p.dimension,p.price] as const):[]);
 return observedPrices(current).filter(p=>!old.has(p.dimension)||old.get(p.dimension)!==p.price).map(p=>
  env.DB.prepare('INSERT OR IGNORE INTO price_observations(endpoint_id,model_id,provider,source,dimension,unit,price,observed_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(endpointId,modelId,provider,source,p.dimension,p.unit,p.price,ts));
}
export function imageHistoryStatements(env:Bindings,endpointId:string,modelId:string,provider:string,current:ImageCharge[],previous:ImageCharge[]|null,ts=now()):D1PreparedStatement[]{
 const old=new Map((previous||[]).map(charge=>[imageChargeDimension(charge),charge.cost_usd] as const));
 return current.filter(charge=>old.get(imageChargeDimension(charge))!==charge.cost_usd).map(charge=>
  env.DB.prepare('INSERT OR IGNORE INTO price_observations(endpoint_id,model_id,provider,source,dimension,unit,price,observed_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(endpointId,modelId,provider,'provider',imageChargeDimension(charge),'USD/'+charge.unit,charge.cost_usd,ts));
}
export function safeCollectionError(input:string|null):string|null{
 if(!input)return null;
 const code=input.match(/(?:OpenRouter API HTTP|Resend HTTP)\s+(\d{3})/i);
 if(code)return 'Upstream HTTP '+code[1];
 if(/timeout|abort/i.test(input))return 'Upstream request timed out';
 if(/empty endpoint/i.test(input))return 'Upstream returned no endpoints';
 if(/api.key|not configured|required for operator/i.test(input))return 'Operator API credential unavailable';
 return 'Upstream collection failed';
}
export async function prunePriceHistory(env:Bindings,clock=now()):Promise<number>{
 const cutoff=clock-180*86400;
 const current=await env.DB.prepare('DELETE FROM price_observations WHERE rowid IN (SELECT rowid FROM price_observations WHERE observed_at<? LIMIT 250)').bind(cutoff).run();
 const legacy=await env.DB.prepare('DELETE FROM price_history WHERE rowid IN (SELECT rowid FROM price_history WHERE observed_at<? LIMIT 250)').bind(cutoff).run();
 return (current.meta.changes||0)+(legacy.meta.changes||0);
}
/** Backfill missing dimensions only when the scanner confirms current rates. No fake timestamps. */
export function missingHistoryStatements(env:Bindings,endpointId:string,modelId:string,provider:string,source:'model'|'provider',current:Prices,ts=now()):D1PreparedStatement[]{
 return observedPrices(current).map(p=>
  env.DB.prepare("INSERT OR IGNORE INTO price_observations(endpoint_id,model_id,provider,source,dimension,unit,price,observed_at) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM price_observations WHERE endpoint_id=? AND dimension=?)")
   .bind(endpointId,modelId,provider,source,p.dimension,p.unit,p.price,ts,endpointId,p.dimension));
}

import { now, type Bindings } from './types';
import type { Prices } from './pricing';

/** Sparse, observed-only history: baseline + actual price changes, not interpolated hourly samples. */
export function historyStatements(env:Bindings,endpointId:string,modelId:string,provider:string,source:'model'|'provider',current:Prices,previous:Prices|null,ts=now()):D1PreparedStatement[]{
 const dims=[['input',current.prompt,previous?.prompt],['output',current.completion,previous?.completion]] as const;
 return dims.filter(([,next,old])=>next!==null&&(previous===null||next!==old)).map(([dimension,price])=>
  env.DB.prepare('INSERT OR IGNORE INTO price_history(endpoint_id,model_id,provider,source,dimension,price,observed_at) VALUES(?,?,?,?,?,?,?)')
   .bind(endpointId,modelId,provider,source,dimension,price,ts));
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
 // Purge small batches; keep recent 180 days. Events remain immutable and are not removed.
 const cutoff=clock-180*86400;
 const result=await env.DB.prepare('DELETE FROM price_history WHERE rowid IN (SELECT rowid FROM price_history WHERE observed_at<? LIMIT 250)').bind(cutoff).run();
 return result.meta.changes||0;
}

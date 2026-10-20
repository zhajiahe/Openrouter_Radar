import Decimal from 'decimal.js';
import type { EventKind } from './types';

export type Prices={prompt:string|null;completion:string|null;raw:Record<string,unknown>};
const NUMERIC=/^(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export function normalizePrice(value:unknown):string|null{
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const s=String(value);
 if(!NUMERIC.test(s))return null;
 try {const v=new Decimal(s);return v.isFinite()&&v.gte(0)?v.toFixed():null;}catch{return null;}
}
export function parsePrices(raw:unknown):Prices{
 const obj=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 return {prompt:normalizePrice(obj.prompt),completion:normalizePrice(obj.completion),raw:obj};
}
export type PriceDelta={
 kind:Extract<EventKind,'price.increased'|'price.decreased'|'price.policy_changed'>;
 dimension:string;oldPrice:string|null;newPrice:string|null;percent:number|null;
};
export const PRICE_FIELDS:Record<string,{dimension:string;unit:string}> = {
 prompt:{dimension:'input',unit:'USD/token'},completion:{dimension:'output',unit:'USD/token'},
 input_cache_read:{dimension:'cache_read',unit:'USD/token'},
 input_cache_write:{dimension:'cache_write',unit:'USD/token'},
 input_cache_write_1h:{dimension:'cache_write_1h',unit:'USD/token'},
 internal_reasoning:{dimension:'internal_reasoning',unit:'USD/token'},
 image_token:{dimension:'image_token',unit:'USD/token'},
 input_audio_cache:{dimension:'input_audio_cache',unit:'USD/token'},
 image:{dimension:'image',unit:'USD/image'},
 image_output:{dimension:'image_output',unit:'USD/image'},
 audio:{dimension:'audio',unit:'USD/second'},
 audio_output:{dimension:'audio_output',unit:'USD/second'},
 request:{dimension:'request',unit:'USD/request'},
 web_search:{dimension:'web_search',unit:'USD/search'}
};
export function observedPrices(prices:Prices):{dimension:string;unit:string;price:string}[]{
 return Object.entries(PRICE_FIELDS).flatMap(([field,meta])=>{
  const price=field==='prompt'?prices.prompt:field==='completion'?prices.completion:normalizePrice(prices.raw[field]);
  return price===null?[]:[{...meta,price}];
 });
}
const DIMENSIONS:Record<string,string>={
 prompt:'input',completion:'output',input_cache_read:'cache_read',
 input_cache_write:'cache_write',input_cache_write_1h:'cache_write_1h',
 image:'image',audio:'audio',request:'request',web_search:'web_search',
 internal_reasoning:'internal_reasoning',image_token:'image_token',image_output:'image_output',
 audio_output:'audio_output',input_audio_cache:'input_audio_cache'
};
function stable(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object'){
  return Object.fromEntries(Object.entries(value as Record<string,unknown>)
   .sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
 }
 const decimal=normalizePrice(value);
 return decimal===null?value:decimal;
}
function policyText(value:unknown):string|null{
 return value===undefined?null:JSON.stringify(stable(value));
}
const MONETARY_DIMENSIONS=new Set(Object.keys(PRICE_FIELDS));
/** Only confirmed monetary dimensions may be labelled "price went up/down".
 * Metadata such as "discount" is a policy change, not the dollar cost of a request. */
export function findPriceChanges(previous:Prices,current:Prices):PriceDelta[]{
 const result:PriceDelta[]=[];
 const keys=new Set([...Object.keys(previous.raw),...Object.keys(current.raw),'prompt','completion']);
 for(const key of ['prompt','completion', ...[...keys].filter(key=>key!=='prompt'&&key!=='completion').sort()]){
  if(key==='overrides')continue;
  const dimension=DIMENSIONS[key]||key;
  const oldValue=key==='prompt'?previous.prompt:key==='completion'?previous.completion:normalizePrice(previous.raw[key]);
  const newValue=key==='prompt'?current.prompt:key==='completion'?current.completion:normalizePrice(current.raw[key]);
  if(!MONETARY_DIMENSIONS.has(key)){
   const oldPolicy=policyText(previous.raw[key]),newPolicy=policyText(current.raw[key]);
   if(oldPolicy!==newPolicy)result.push({kind:'price.policy_changed',dimension,
    oldPrice:oldValue??oldPolicy,newPrice:newValue??newPolicy,percent:null});
   continue;
  }
  if(oldValue===null&&newValue===null)continue;
  if(oldValue===null||newValue===null){
   // Unknown prompt/completion is missing data, not free or a definite change.
   if(key==='prompt'||key==='completion')continue;
   result.push({kind:'price.policy_changed',dimension,oldPrice:oldValue,newPrice:newValue,percent:null});
   continue;
  }
  const oldNumber=new Decimal(oldValue),newNumber=new Decimal(newValue);
  if(oldNumber.eq(newNumber))continue;
  result.push({
   kind:newNumber.gt(oldNumber)?'price.increased':'price.decreased',dimension,
   oldPrice:oldValue,newPrice:newValue,
   percent:oldNumber.isZero()?null:newNumber.minus(oldNumber).div(oldNumber).mul(100).toNumber()
  });
 }
 const oldOverride=policyText(previous.raw.overrides),newOverride=policyText(current.raw.overrides);
 if(oldOverride!==newOverride){
  result.push({kind:'price.policy_changed',dimension:'overrides',
   oldPrice:oldOverride,newPrice:newOverride,percent:null});
 }
 return result;
}
export async function endpointId(modelId:string,provider:string,tag:string,variant=''):Promise<string>{
 const data=new TextEncoder().encode(JSON.stringify([modelId,provider,tag,variant]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)))
  .map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function thresholdMatches(changePct:number|null,minPct:number):boolean{
 return changePct===null?minPct===0:Math.abs(changePct)>=minPct;
}

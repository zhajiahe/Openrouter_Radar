import Decimal from 'decimal.js';
import {normalizePrice} from './pricing';

/** Image generation has per-image, per-megapixel and per-token prices, not a USD/token scalar. */
export type ImageCharge={billable:string;unit:string;cost_usd:string;conditions:string};
export type ImageChange={kind:'image.price_increased'|'image.price_decreased'|'image.price_policy_changed';
 dimension:string;oldPrice:string|null;newPrice:string|null;percent:number|null};

function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(
  Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
   .map(([k,v])=>[k,canonical(v)]));
 return value;
}
export function imageCharges(raw:unknown):ImageCharge[]{
 if(!Array.isArray(raw))throw new Error('Image endpoint pricing must be an array');
 return raw.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid image price entry');
  const r=value as Record<string,unknown>;
  const cost=normalizePrice(r.cost_usd);
  if(typeof r.billable!=='string'||!r.billable||typeof r.unit!=='string'||!r.unit||cost===null)
   throw new Error('Invalid image billing unit or USD cost');
  const conditions=JSON.stringify(canonical(Object.fromEntries(Object.entries(r).filter(([k])=>!['billable','unit','cost_usd'].includes(k)))));
  return {billable:r.billable,unit:r.unit,cost_usd:cost,conditions};
 }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function imageRaw(charges:ImageCharge[]):Record<string,unknown>{return {image_pricing:charges};}
function key(c:ImageCharge){return JSON.stringify([c.billable,c.unit,c.conditions]);}
export function findImagePriceChanges(prev:ImageCharge[],next:ImageCharge[]):ImageChange[]{
 const before=new Map<string,ImageCharge>(),after=new Map<string,ImageCharge>();
 for(const c of prev)before.set(key(c),c);
 for(const c of next)after.set(key(c),c);
 // Duplicate charge keys cannot be unambiguously compared; preserve as policy event.
 if(before.size!==prev.length||after.size!==next.length)
  return JSON.stringify(prev)===JSON.stringify(next)?[]:
   [{kind:'image.price_policy_changed',dimension:'image_billing',oldPrice:JSON.stringify(prev),newPrice:JSON.stringify(next),percent:null}];
 const result:ImageChange[]=[];
 for(const k of new Set([...before.keys(),...after.keys()])){
  const old=before.get(k),current=after.get(k);
  const basis=current||old!;
  const dimension='image/'+basis.billable+'/'+basis.unit+(basis.conditions==='{}'?'':' '+basis.conditions);
  if(!old||!current){
   result.push({kind:'image.price_policy_changed',dimension,
    oldPrice:old?.cost_usd??null,newPrice:current?.cost_usd??null,percent:null});
   continue;
  }
  const a=new Decimal(old.cost_usd),b=new Decimal(current.cost_usd);
  if(a.eq(b))continue;
  result.push({kind:b.gt(a)?'image.price_increased':'image.price_decreased',dimension,
   oldPrice:a.toFixed(),newPrice:b.toFixed(),percent:a.isZero()?null:b.minus(a).div(a).mul(100).toNumber()});
 }
 return result;
}
export function storedImageCharges(json:string):ImageCharge[]{
 try{
  const value=JSON.parse(json) as {image_pricing?:ImageCharge[]};
  return Array.isArray(value.image_pricing)?value.image_pricing:[];
 }catch{return [];}
}

import Decimal from 'decimal.js';

export type ProviderEndpoint={
 id:string;provider:string;tag:string;last_success:number|null;
};
export type PriceObservation={
 endpoint_id:string;dimension:string;unit:string;price:string;observed_at:number;
};
export type ProviderPriceStability={
 provider:string;status:'ready'|'stale'|'insufficient';
 endpointCount:number;coveredEndpoints:number;freshEndpoints:number;
 changeCount:number;increaseCount:number;decreaseCount:number;
 changedEndpointDays:number;stableDayRate:number|null;
 maxIncreasePct:number|null;maxDecreasePct:number|null;
 lastChangeAt:number|null;lastScanAt:number|null;unit:string|null;
};
/**
 * This is a price-change-day ratio, NOT request success rate or an SLA.
 * One changed endpoint/calendar-day counts once, irrespective of the number of edits.
 * A full-window real baseline plus a recent successful model scan is required.
 */
export function summarizeProviderPriceStability(
 endpoints:ProviderEndpoint[],observations:PriceObservation[],days:7|30,at:number
):ProviderPriceStability[]{
 const start=at-days*86400;
 const byEndpoint=new Map<string,PriceObservation[]>();
 for(const row of observations){
  if(row.observed_at>at||row.observed_at<=0)continue;
  const list=byEndpoint.get(row.endpoint_id)||[];
  list.push(row);byEndpoint.set(row.endpoint_id,list);
 }
 const groups=new Map<string,ProviderPriceStability>();
 for(const endpoint of endpoints){
  const result:ProviderPriceStability=groups.get(endpoint.provider)||{
   provider:endpoint.provider,status:'ready' as const,endpointCount:0,coveredEndpoints:0,freshEndpoints:0,
   changeCount:0,increaseCount:0,decreaseCount:0,changedEndpointDays:0,
   stableDayRate:null,maxIncreasePct:null,maxDecreasePct:null,lastChangeAt:null,lastScanAt:null,unit:null
  };
  groups.set(endpoint.provider,result);
  result.endpointCount++;
  const scan=endpoint.last_success||0;
  if(scan>0)result.lastScanAt=Math.max(result.lastScanAt||0,scan);
  if(scan>=at-3*3600 && scan<=at)result.freshEndpoints++;
  const rows=(byEndpoint.get(endpoint.id)||[]).sort((a,b)=>a.observed_at-b.observed_at);
  const baseline=rows.filter(p=>p.observed_at<=start).at(-1);
  if(!baseline)continue;
  if(rows.some(p=>p.unit!==baseline.unit))continue; // Price units cannot be pooled.
  if(result.unit!==null&&result.unit!==baseline.unit)continue;
  result.unit=baseline.unit;
  result.coveredEndpoints++;
  let prior:Decimal;
  try{prior=new Decimal(baseline.price);if(!prior.isFinite()||prior.isNeg())continue;}
  catch{result.coveredEndpoints--;continue;}
  const changedDays=new Set<number>();
  for(const obs of rows.filter(p=>p.observed_at>start)){
   let next:Decimal;
   try{next=new Decimal(obs.price);if(!next.isFinite()||next.isNeg())continue;}catch{continue;}
   if(!next.eq(prior)){
    result.changeCount++;
    if(next.greaterThan(prior))result.increaseCount++;else result.decreaseCount++;
    changedDays.add(Math.floor(obs.observed_at/86400));
    result.lastChangeAt=Math.max(result.lastChangeAt||0,obs.observed_at);
    if(!prior.isZero()){
     const magnitude=next.minus(prior).div(prior).times(100).toNumber();
     if(Number.isFinite(magnitude)){
      if(magnitude>0)result.maxIncreasePct=Math.max(result.maxIncreasePct??0,magnitude);
      else result.maxDecreasePct=Math.max(result.maxDecreasePct??0,Math.abs(magnitude));
     }
    }
   }
   prior=next;
  }
  result.changedEndpointDays+=changedDays.size;
 }
 const metrics=[...groups.values()];
 for(const m of metrics){
  const complete=m.coveredEndpoints===m.endpointCount&&m.endpointCount>0;
  const fresh=m.freshEndpoints===m.endpointCount;
  m.status=!complete?'insufficient':!fresh?'stale':'ready';
  if(m.status==='ready')m.stableDayRate=Math.max(0,100*(1-m.changedEndpointDays/(m.endpointCount*days)));
 }
 return metrics.sort((a,b)=>{
  const order={ready:0,stale:1,insufficient:2};
  return order[a.status]-order[b.status]||
   (b.stableDayRate??-1)-(a.stableDayRate??-1)||
   a.provider.localeCompare(b.provider);
 });
}

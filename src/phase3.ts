import type { UpstreamModel } from './openrouter';
import type { EventKind } from './types';

export type ModelState={
 context_length:number|null;expiration_date:number|null;
 alias_target:string|null;capabilities_json:string;
};
export type ModelDelta={
 kind:Extract<EventKind,'model.context_changed'|'model.capability_changed'|'model.alias_changed'|'model.expiration_changed'>;
 dimension:string;oldValue:string|null;newValue:string|null;
};
function normalizeDate(input:unknown):number|null{
 if(typeof input==='number'&&Number.isSafeInteger(input)&&input>0)return input;
 if(typeof input==='string'&&input.trim()){
  if(/^\d+$/.test(input)){const n=Number(input);return Number.isSafeInteger(n)&&n>0?n:null;}
  const ms=Date.parse(input);return Number.isFinite(ms)?Math.floor(ms/1000):null;
 }
 return null;
}
function stableCapabilities(input:UpstreamModel):string|null{
 if(input.architecture===undefined&&input.supported_parameters===undefined)return null;
 const architecture=input.architecture&&typeof input.architecture==='object'?input.architecture:{};
 const entries=Object.entries(architecture).sort(([a],[b])=>a.localeCompare(b))
  .map(([key,value])=>[key,Array.isArray(value)?[...value].sort():value]);
 const supported=input.supported_parameters?[...new Set(input.supported_parameters)].sort():[];
 return JSON.stringify({architecture:Object.fromEntries(entries),supported_parameters:supported});
}
export function modelState(input:UpstreamModel,old?:ModelState):ModelState{
 // Missing fields in a partial upstream response do not erase last known values.
 return {
  context_length:input.context_length===undefined?old?.context_length??null:input.context_length??null,
  expiration_date:input.expiration_date===undefined?old?.expiration_date??null:normalizeDate(input.expiration_date),
  alias_target:input.alias_target===undefined?old?.alias_target??null:input.alias_target??null,
  capabilities_json:stableCapabilities(input)??old?.capabilities_json??'{}'
 };
}
export function modelDeltas(old:ModelState,current:ModelState):ModelDelta[]{
 const dims=[
  ['context_length','model.context_changed','context_length'],
  ['expiration_date','model.expiration_changed','expiration_date'],
  ['alias_target','model.alias_changed','alias_target'],
  ['capabilities_json','model.capability_changed','capabilities']
 ] as const;
 return dims.flatMap(([key,kind,dimension])=>{
  if(old[key]===current[key])return [];
  return [{kind,dimension,oldValue:old[key]===null?null:String(old[key]),newValue:current[key]===null?null:String(current[key])}];
 });
}
export function expiryWindow(expiration:number|null,clock:number):30|7|1|null{
 if(expiration===null||expiration<=clock)return null;
 const seconds=expiration-clock;
 if(seconds<=86400)return 1;
 if(seconds<=7*86400)return 7;
 if(seconds<=30*86400)return 30;
 return null;
}

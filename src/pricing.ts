import Decimal from 'decimal.js';
import type { EventKind } from './types';

export type Prices = { prompt: string | null; completion: string | null; raw: Record<string,unknown> };
const NUMERIC = /^(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export function normalizePrice(value: unknown): string | null {
 if (typeof value !== 'string' && typeof value !== 'number') return null;
 const valueString = String(value);
 if (!NUMERIC.test(valueString)) return null;
 try { const parsed = new Decimal(valueString); return parsed.isFinite() && parsed.gte(0) ? parsed.toFixed() : null; } catch { return null; }
}
export function parsePrices(raw: unknown): Prices {
 const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string,unknown> : {};
 return { prompt:normalizePrice(obj.prompt),completion:normalizePrice(obj.completion),raw:obj };
}
export type PriceDelta = { kind: Extract<EventKind,'price.increased'|'price.decreased'>; dimension:'input'|'output'; oldPrice:string; newPrice:string; percent:number|null };
export function findPriceChanges(previous: Prices, current: Prices): PriceDelta[] {
 const result: PriceDelta[] = [];
 for (const [dimension,key] of [['input','prompt'],['output','completion']] as const) {
  const oldPrice=previous[key], newPrice=current[key];
  if (oldPrice===null || newPrice===null) continue;
  const oldVal=new Decimal(oldPrice), newVal=new Decimal(newPrice);
  if (newVal.eq(oldVal)) continue;
  const percent=oldVal.isZero()?null:newVal.minus(oldVal).div(oldVal).mul(100).toNumber();
  result.push({kind:newVal.gt(oldVal)?'price.increased':'price.decreased',dimension,oldPrice,newPrice,percent});
 }
 return result;
}
export async function endpointId(modelId:string, provider:string, tag:string, variant=''):Promise<string>{
 const value=JSON.stringify([modelId,provider,tag,variant]);
 const data=new TextEncoder().encode(value);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function thresholdMatches(changePct:number|null, minPct:number):boolean {
 // Zero -> positive has no percentage meaning; alert only at a zero threshold.
 return changePct===null ? minPct===0 : Math.abs(changePct)>=minPct;
}

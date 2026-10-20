import React,{useEffect,useState} from 'react';

import {PriceHistory} from './price-history-chart';
export {PriceHistory};

type CompareData={model:{id:string;name:string;context_length:number|null};endpoints:{id:string;provider:string;source:string;status:string;input_price:string|null;output_price:string|null}[]};
const fmt=(n:number)=>Number.isFinite(n)?'$'+n.toLocaleString(undefined,{maximumFractionDigits:6}):'—';
export function CompareModels({ids,onRemove,onClose}:{ids:string[];onRemove:(id:string)=>void;onClose:()=>void}){
 const [models,setModels]=useState<CompareData[]>([]);
 const [error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;
  Promise.all(ids.map(id=>fetch('/api/model?id='+encodeURIComponent(id)).then(r=>{
   if(!r.ok)throw new Error('Cannot load model '+id);
   return r.json() as Promise<CompareData>;
  }))).then(data=>{if(!cancelled)setModels(data);}).catch(e=>{if(!cancelled)setError(String(e));});
  return ()=>{cancelled=true;};
 },[ids.join('|')]);
 const providers=[...new Set(models.flatMap(m=>m.endpoints.filter(e=>e.source==='provider').map(e=>e.provider)))].sort();
 return <section className="compare-panel" aria-label="模型对比"><div className="compare-header"><div><h3>Compare models</h3><p>同一 Provider 的公开基础 Token 报价；不是性能或质量排名。</p></div><button onClick={onClose} aria-label="关闭模型对比">关闭 ×</button></div>
  {error&&<p role="alert">{error}</p>}
  <div className="scroll-x"><table><thead><tr><th>Provider / Metric</th>{ids.map(id=><th key={id}><span>{models.find(m=>m.model.id===id)?.model.name||id}</span><button className="compare-remove" onClick={()=>onRemove(id)} aria-label={'移除 '+id}>×</button></th>)}</tr></thead>
   <tbody><tr><td>Context tokens</td>{ids.map(id=><td key={id}>{models.find(m=>m.model.id===id)?.model.context_length?.toLocaleString()||'—'}</td>)}</tr>
   {providers.map(p=><React.Fragment key={p}><tr><td>{p} / input</td>{ids.map(id=><td key={id}>{price(models.find(m=>m.model.id===id),p,'input_price')}</td>)}</tr>
    <tr><td>{p} / output</td>{ids.map(id=><td key={id}>{price(models.find(m=>m.model.id===id),p,'output_price')}</td>)}</tr></React.Fragment>)}</tbody>
  </table></div>
  <p className="history-caption">— = 未采集或该模型在此 Provider 无有效报价。多个端点取最低基础价；动态定价、折扣及非 Token 计费不参与比较。</p>
 </section>;
}
function price(model:CompareData|undefined,provider:string,dim:'input_price'|'output_price'){
 const nums=model?.endpoints.filter(e=>e.provider===provider&&e.source==='provider'&&e.status==='active'&&e[dim]!==null)
  .map(e=>Number(e[dim])*1e6).filter(n=>Number.isFinite(n));
 return nums?.length?fmt(Math.min(...nums)):'—';
}

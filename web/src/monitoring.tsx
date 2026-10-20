import React,{useEffect,useState} from 'react';

export type PricePoint={endpoint_id:string;model_id:string;provider:string;source:string;dimension:string;price:string;observed_at:number};
type CompareData={model:{id:string;name:string;context_length:number|null};endpoints:{id:string;provider:string;source:string;status:string;input_price:string|null;output_price:string|null}[]};
const fmt=(n:number)=>Number.isFinite(n)?'$'+n.toLocaleString(undefined,{maximumFractionDigits:6}):'—';
export function PriceHistory({modelId,providers}:{modelId:string;providers:string[]}){
 const [provider,setProvider]=useState('');
 const [dimension,setDimension]=useState<'input'|'output'>('input');
 const [points,setPoints]=useState<PricePoint[]>([]);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;
  setPending(true);setError('');
  const args=new URLSearchParams({model_id:modelId,provider,dimension});
  fetch('/api/price-history?'+args.toString()).then(async r=>{
   if(!r.ok)throw new Error('History unavailable');
   return r.json() as Promise<{data:PricePoint[]}>;
  }).then(data=>{if(!cancelled)setPoints(data.data);})
   .catch(e=>{if(!cancelled)setError((e as Error).message);})
   .finally(()=>{if(!cancelled)setPending(false);});
  return ()=>{cancelled=true;};
 },[modelId,provider,dimension]);
 const series=[...new Set(points.map(p=>p.endpoint_id))].slice(0,6).map(id=>points.filter(p=>p.endpoint_id===id));
 const flat=series.flat();
 const max=Math.max(...flat.map(p=>Number(p.price)*1e6),0);
 const min=Math.min(...flat.map(p=>Number(p.price)*1e6),0);
 const first=flat.length?Math.min(...flat.map(p=>p.observed_at)):0;
 const last=flat.length?Math.max(...flat.map(p=>p.observed_at)):0;
 const x=(t:number)=>50+(last===first?150:(t-first)/(last-first)*490);
 const y=(p:number)=>145-(max===min?0.5:(p-min)/(max-min))*116;
 const colors=['#7c61c6','#3b8f7e','#c08043','#cc6180','#617fc0','#8a8a9d'];
 return <section className="history-chart">
  <div className="monitor-head"><div><h3>Observed price history</h3><p>只连结实际观察到的报价变更点；不填充缺失的小时数据。</p></div></div>
  <div className="history-controls"><select aria-label="历史 Provider" value={provider} onChange={e=>setProvider(e.target.value)}><option value="">全部 Provider</option>{providers.map(p=><option key={p}>{p}</option>)}</select>
   <select aria-label="历史价格维度" value={dimension} onChange={e=>setDimension(e.target.value as 'input'|'output')}><option value="input">输入 Token</option><option value="output">输出 Token</option></select></div>
  {pending?<p role="status">加载已观察到的历史报价…</p>:error?<p role="alert">{error}</p>:!points.length?<p className="history-none">暂无历史采样。首次采集只建立基准，不代表此前价格没有变化。</p>:<>
   <svg className="price-chart" viewBox="0 0 590 190" role="img" aria-label="观察到的输入或输出 Token 单价变化；不同端点分别绘制">
    <line x1="50" x2="540" y1="145" y2="145" stroke="currentColor" strokeOpacity=".22"/>
    <line x1="50" x2="50" y1="15" y2="145" stroke="currentColor" strokeOpacity=".22"/>
    <text x="4" y="28" fontSize="12" fill="currentColor">{fmt(max)}</text>
    <text x="4" y="149" fontSize="12" fill="currentColor">{fmt(min)}</text>
    {series.map((line,i)=><g key={line[0]?.endpoint_id}>
     {line.length>1&&<polyline fill="none" stroke={colors[i%colors.length]} strokeWidth="2" points={line.map(p=>x(p.observed_at)+','+y(Number(p.price)*1e6)).join(' ')}/>}
     {line.map(p=><circle key={p.endpoint_id+'-'+p.observed_at} cx={x(p.observed_at)} cy={y(Number(p.price)*1e6)} r="3.7" fill={colors[i%colors.length]}/>)}
    </g>)}
    <text x="50" y="177" fontSize="11" fill="currentColor">{new Date(first*1000).toLocaleDateString()}</text>
    <text x="540" y="177" textAnchor="end" fontSize="11" fill="currentColor">{new Date(last*1000).toLocaleDateString()}</text>
   </svg>
   <p className="history-caption">{points.length} 条价格观察记录 · 最多展示 6 个端点 · USD / 1M tokens · 仅记录部署后的数据 · 保留 180 天</p>
  </>}
 </section>;
}

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

import React,{useEffect,useState} from 'react';
import {ActionIcon,Alert,Badge,Loader,Table} from '@mantine/core';
import {X} from 'lucide-react';
import {PriceHistory} from './price-history-chart';
export {PriceHistory};

type CompareData={
 model:{id:string;name:string;context_length:number|null;model_kind?:string};
 endpoints:{id:string;provider:string;source:string;status:string;pricing_json?:string;input_price:string|null;output_price:string|null}[];
};
const fmt=(n:number)=>Number.isFinite(n)?'$'+n.toLocaleString('zh-CN',{maximumFractionDigits:6}):'—';
export function CompareModels({ids,onRemove,onClose}:{ids:string[];onRemove:(id:string)=>void;onClose:()=>void}){
 const [models,setModels]=useState<CompareData[]>([]);
 const [error,setError]=useState('');
 const [pending,setPending]=useState(true);
 useEffect(()=>{
  let cancelled=false;
  setPending(true);setError('');
  Promise.all(ids.map(id=>fetch('/api/model?id='+encodeURIComponent(id)).then(r=>{
   if(!r.ok)throw new Error('无法加载模型 '+id);
   return r.json() as Promise<CompareData>;
  }))).then(data=>{if(!cancelled)setModels(data);}).catch(e=>{if(!cancelled)setError(String(e));})
   .finally(()=>{if(!cancelled)setPending(false);});
  return ()=>{cancelled=true;};
 },[ids.join('|')]);
 const providers=[...new Set(models.flatMap(m=>m.endpoints.filter(e=>e.source==='provider'&&e.status==='active').map(e=>e.provider)))].sort();
 return <section className="compare-panel" aria-label="模型对比">
  <div className="compare-header"><div><h3>模型报价对比</h3><p>相同 Provider 的公开基础 Token 报价（USD / 百万 Token），不代表性能或实付价格。</p></div><ActionIcon aria-label="关闭模型对比" variant="subtle" onClick={onClose}><X size={18}/></ActionIcon></div>
  {error&&<Alert color="red" role="alert">{error}</Alert>}
  {pending?<div className="chart-placeholder" role="status"><Loader size="sm"/>加载报价中…</div>:<div className="scroll-x">
   <Table className="radar-data-table compare-data-table" highlightOnHover horizontalSpacing="sm" verticalSpacing="xs"><thead><tr><th scope="col">Provider / 项目</th>{ids.map(id=><th scope="col" key={id}>
    <span>{models.find(m=>m.model.id===id)?.model.name||id}</span>
    <ActionIcon ml={6} size="xs" variant="subtle" color="gray" aria-label={'移除 '+id} onClick={()=>onRemove(id)}><X size={13}/></ActionIcon>
   </th>)}</tr></thead><tbody>
    <tr><td>上下文 Tokens</td>{ids.map(id=><td className="num" key={id}>{models.find(m=>m.model.id===id)?.model.context_length?.toLocaleString()||'—'}</td>)}</tr>
    {providers.map(provider=><React.Fragment key={provider}>
     <tr><td><Badge size="xs" color="gray" variant="light">{provider}</Badge> 输入</td>{ids.map(id=><td className="num" key={id}>{price(models.find(m=>m.model.id===id),provider,'input_price')}</td>)}</tr>
     <tr><td>{provider} 输出</td>{ids.map(id=><td className="num" key={id}>{price(models.find(m=>m.model.id===id),provider,'output_price')}</td>)}</tr>
     {(['input_cache_read','input_cache_write','input_cache_write_1h'] as const).map(field=>
      <tr key={field}><td>{provider} · {field==='input_cache_read'?'缓存读取':field==='input_cache_write'?'缓存写入':'缓存写入 1h'}</td>
       {ids.map(id=><td className="num" key={id}>{extra(models.find(m=>m.model.id===id),provider,field)}</td>)}</tr>)}
    </React.Fragment>)}
   </tbody></Table>
   {!providers.length&&<div className="empty">暂无可比较的有效 Provider 报价。</div>}
  </div>}
  <p className="chart-muted">— 表示未采集、无有效报价或图片模型等非 Token 单位。每个 Provider 只比较最低基础价，不包含折扣或动态计费。</p>
 </section>;
}
function price(model:CompareData|undefined,provider:string,dim:'input_price'|'output_price'){
 if(!model||model.model.model_kind==='image')return '—';
 const nums=model.endpoints.filter(e=>e.provider===provider&&e.source==='provider'&&e.status==='active'&&!e.pricing_json?.includes('image_pricing')&&e[dim]!==null)
  .map(e=>Number(e[dim])*1e6).filter(n=>Number.isFinite(n)&&n>=0);
 return nums.length?fmt(Math.min(...nums)):'—';
}

function extra(model:CompareData|undefined,provider:string,field:string){
 if(!model||model.model.model_kind==='image')return '—';
 const nums=model.endpoints.filter(e=>e.provider===provider&&e.source==='provider'&&e.status==='active'&&!e.pricing_json?.includes('image_pricing'))
  .flatMap(e=>{
   try{
    const raw=(JSON.parse(e.pricing_json||'{}') as Record<string,unknown>)[field];
    const n=Number(raw);
    return raw!==null&&raw!==undefined&&Number.isFinite(n)&&n>=0?[n*1e6]:[];
   }catch{return [];}
  });
 return nums.length?fmt(Math.min(...nums)):'—';
}

import React,{useEffect,useMemo,useState} from 'react';
import './price-history-chart.css';

export type ObservedPrice={
 endpoint_id:string;
 model_id:string;
 provider:string;
 tag?:string|null;
 dimension:string;
 price:string;
 observed_at:number;
};
type PriceResult={data:ObservedPrice[];method:string;unit:string;retention_days:number};
type PriceSeries={id:string;provider:string;tag:string;points:Array<ObservedPrice&{value:number}>};
type ActivePoint={id:string;provider:string;date:number;value:number;dimension:string};
const palette=['var(--chart-violet)','#24ad93','#f1a06c','#649cdb','#db8bc3','#a2a8c1'];
const money=(value:number)=>'$'+value.toLocaleString('zh-CN',{maximumFractionDigits:value<.01?6:4});
const shortDate=(time:number)=>new Date(time*1000).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});
const clockDate=(time:number)=>new Date(time*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});

function groupPrices(points:ObservedPrice[],multiplier:number):PriceSeries[]{
 const map=new Map<string,PriceSeries>();
 for(const p of points){
  const raw=Number(p.price),value=raw*multiplier;
  if(!Number.isFinite(raw)||raw<0||!Number.isFinite(p.observed_at)||!Number.isFinite(value))continue;
  let series=map.get(p.endpoint_id);
  if(!series){
   series={id:p.endpoint_id,provider:p.provider,tag:p.tag||'',points:[]};
   map.set(p.endpoint_id,series);
  }
  series.points.push({...p,value});
 }
 return [...map.values()].map(s=>({...s,points:s.points.sort((a,b)=>a.observed_at-b.observed_at)}))
  .sort((a,b)=>(b.points[b.points.length-1]?.observed_at||0)-(a.points[a.points.length-1]?.observed_at||0) || a.provider.localeCompare(b.provider));
}
export function PriceHistory({modelId,providers,image=false}:{modelId:string;providers:string[];image?:boolean}){
 const [provider,setProvider]=useState('');
 const [dimension,setDimension]=useState<'input'|'output'>('input');
 const [range,setRange]=useState<7|30|90|180>(90);
 const [metric,setMetric]=useState('');
 const [points,setPoints]=useState<ObservedPrice[]>([]);
 const [pending,setPending]=useState(true);
 const [error,setError]=useState('');
 const [active,setActive]=useState<ActivePoint|null>(null);
 const [loadedAt,setLoadedAt]=useState<number|null>(null);
 const availableProviders=useMemo(()=>[...new Set(providers)].sort((a,b)=>a.localeCompare(b)),[providers.join('|')]);
 useEffect(()=>{
  const controller=new AbortController();
  setPending(true);setError('');setActive(null);setPoints([]);
  const since=Math.floor(Date.now()/1000)-range*86400;
  const params=new URLSearchParams({model_id:modelId,provider,since:String(since)});
  if(image)params.set('mode','image');else params.set('dimension',dimension);
  fetch('/api/price-history?'+params,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('暂时无法获取价格历史');
   return response.json() as Promise<PriceResult>;
  }).then(result=>{
   if(!controller.signal.aborted){setPoints(result.data);setLoadedAt(Math.floor(Date.now()/1000));}
  }).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);})
   .finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return ()=>controller.abort();
 },[modelId,provider,dimension,range,image]);
 const dimensions=useMemo(()=>[...new Set(points.map(p=>p.dimension))].sort(),[points]);
 const selectedMetric=dimensions.includes(metric)?metric:(dimensions[0]||'');
 const visible=useMemo(()=>points.filter(p=>!image||p.dimension===selectedMetric),[points,image,selectedMetric]);
 const series=useMemo(()=>groupPrices(visible,image?1:1e6),[visible,image]);
 const shown=series.slice(0,6);
 const visiblePoints=shown.flatMap(s=>s.points);
 const windowEnd=loadedAt??Math.floor(Date.now()/1000);
 const windowStart=windowEnd-range*86400;
 const values=visiblePoints.map(p=>p.value);
 const low=Math.min(...values),high=Math.max(...values);
 const spread=Number.isFinite(high-low)?high-low:0;
 const padding=Math.max(spread*.12,(Number.isFinite(high)?high:0)*.015,.000001);
 const yMin=Math.max(0,(Number.isFinite(low)?low:0)-padding);
 const yMax=(Number.isFinite(high)?high:1)+padding;
 const WIDTH=760,HEIGHT=260,left=66,right=18,top=18,bottom=40;
 const plotW=WIDTH-left-right,plotH=HEIGHT-top-bottom;
 const x=(t:number)=>left+Math.max(0,Math.min(1,(t-windowStart)/(windowEnd-windowStart||1)))*plotW;
 const y=(v:number)=>top+(1-(v-yMin)/(yMax-yMin||1))*plotH;
 const axis=Array.from({length:4},(_,i)=>yMin+(yMax-yMin)*i/3);
 const statusText=image?'只有图片计费实际改变后才会出现历史点；不把不同单位连接起来。':'记录首次成功采集的基准和之后真实的报价变化，不伪造逐小时采样。';
 return <section className="historic-card" aria-labelledby="historic-title">
  <div className="historic-header"><div>
   <span className="historic-kicker">OBSERVED PRICING</span>
   <h3 id="historic-title">价格历史走势 <span className="historic-subtitle">真实观测</span></h3>
   <p>{statusText}</p>
  </div><span className="historic-window">{range} 天</span></div>
  <div className="historic-controls">
   <label>Provider
    <select aria-label="历史 Provider" value={provider} onChange={e=>setProvider(e.target.value)}>
     <option value="">全部 Provider</option>
     {availableProviders.map(p=><option key={p} value={p}>{p}</option>)}
    </select>
   </label>
   {image?<label>图片计费项
    <select aria-label="图片计费维度" value={selectedMetric} disabled={!dimensions.length} onChange={e=>{setMetric(e.target.value);setActive(null);}}>
     {dimensions.length?dimensions.map(d=><option key={d} value={d}>{d}</option>):<option value="">暂无可比较的计费项</option>}
    </select>
   </label>:<label>价格维度
    <select aria-label="历史价格维度" value={dimension} onChange={e=>setDimension(e.target.value as 'input'|'output')}>
     <option value="input">输入 Token</option><option value="output">输出 Token</option>
    </select>
   </label>}
   <div className="historic-range" role="group" aria-label="价格历史时间范围">
    {([7,30,90,180] as const).map(days=><button type="button" key={days} className={range===days?'selected':''} aria-pressed={range===days} onClick={()=>setRange(days)}>{days}天</button>)}
   </div>
  </div>
  {pending?<div className="historic-empty is-loading" role="status">正在获取真实价格观察点…</div>
   :error?<div className="historic-empty" role="alert">{error}<button onClick={()=>setRange(range===90?180:90)}>重新查询</button></div>
   :!visiblePoints.length?<div className="historic-empty">暂无该范围内的价格观察点。{image?'图片价格首次出现只建立计费基准，须观察到后续实际变化才能绘图。':'首次采集只记录当时基准，没有历史点不代表此前价格不变。'}</div>
   :<>
    <div className="historic-readout" aria-live="polite">
     <span className="historic-readout-indicator"/>
     <span>{active?active.provider+' · '+clockDate(active.date):'悬停或聚焦观察点查看准确报价'}</span>
     <strong>{active?money(active.value):'—'}</strong>
     <small>{image?selectedMetric:'USD / 百万 Token'}</small>
    </div>
    <svg className="historic-plot" viewBox={'0 0 '+WIDTH+' '+HEIGHT} role="img" aria-label={(image?'图片报价':'Token 单价')+'历史折线图，包含 '+visiblePoints.length+' 个真实观测点'}>
     {axis.map((v,i)=><g key={i}>
      <line x1={left} x2={WIDTH-right} y1={y(v)} y2={y(v)} className="historic-grid"/>
      <text x={left-10} y={y(v)+4} textAnchor="end" className="historic-axis">{money(v)}</text>
     </g>)}
     {Array.from({length:5},(_,i)=>{
      const t=windowStart+(windowEnd-windowStart)*i/4;
      return <text key={i} x={x(t)} y={HEIGHT-11} textAnchor={i===0?'start':i===4?'end':'middle'} className="historic-axis">{shortDate(t)}</text>;
     })}
     {active&&<line x1={x(active.date)} x2={x(active.date)} y1={top} y2={top+plotH} className="historic-crosshair"/>}
     {shown.map((s,i)=><g key={s.id}>
      {s.points.length>1&&<path className="historic-line" pathLength={1} d={s.points.map((p,j)=>(j===0?'M':'L')+x(p.observed_at).toFixed(2)+' '+y(p.value).toFixed(2)).join(' ')} stroke={palette[i%palette.length]}/>}
      {s.points.map((p,j)=><circle key={j} tabIndex={0} role="button" aria-label={s.provider+'，'+clockDate(p.observed_at)+'，'+money(p.value)} cx={x(p.observed_at)} cy={y(p.value)} r={active?.id===s.id&&active.date===p.observed_at?6:4.5} fill={palette[i%palette.length]} className="historic-marker"
       onFocus={()=>setActive({id:s.id,provider:s.provider,date:p.observed_at,value:p.value,dimension:p.dimension})}
       onMouseEnter={()=>setActive({id:s.id,provider:s.provider,date:p.observed_at,value:p.value,dimension:p.dimension})}
       onMouseLeave={()=>setActive(null)}
       onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setActive({id:s.id,provider:s.provider,date:p.observed_at,value:p.value,dimension:p.dimension});}}}>
       <title>{s.provider} · {clockDate(p.observed_at)} · {money(p.value)}</title>
      </circle>)}
     </g>)}
    </svg>
    <div className="historic-legend" aria-label="折线对应的 Provider 端点">{shown.map((s,i)=><span key={s.id} title={s.provider+' / '+s.tag+' / '+s.id}>
     <i style={{background:palette[i%palette.length]}}/>{s.provider}{s.tag?' · '+s.tag:''}{shown.filter(v=>v.provider===s.provider&&v.tag===s.tag).length>1?' #'+s.id.slice(-4):''}
    </span>)}</div>
    <div className="historic-footnote">
     <span>{visiblePoints.length} 个观测点{series.length>6?' · 仅显示最近更新的 6 个端点':''}</span>
     <span>{image?'USD / 所选计费项':'USD / 百万 Token'} · 最多保留 180 天</span>
    </div>
    {visiblePoints.length===1&&<p className="historic-one-point">当前只有一个真实观察点，暂不足以形成价格变化折线。</p>}
   </>}
 </section>;
}

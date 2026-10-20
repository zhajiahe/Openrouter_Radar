import {useEffect,useMemo,useState} from 'react';
import {LineChart} from '@mantine/charts';
import {Alert,Button,Group,Loader,SegmentedControl,Select} from '@mantine/core';
import {AlertCircle,History} from 'lucide-react';
import './data-visualization.css';

export type ObservedPrice={
 endpoint_id:string;model_id:string;provider:string;tag?:string|null;
 dimension:string;unit?:string;price:string;observed_at:number;
};
type PriceResult={data:ObservedPrice[];method:string;unit:string;retention_days:number;window_start?:number;dimensions?:{dimension:string;unit:string}[]};
type Series={id:string;name:string;points:{timestamp:number;price:number}[]};
const colors=['var(--chart-violet)','var(--chart-down)','var(--chart-up)','#649cdb','#db8bc3','#a2a8c1'];
const money=(value:number)=>'$'+value.toLocaleString('zh-CN',{maximumFractionDigits:value<0.001?10:6});
const dateLabel=(time:number)=>new Date(time*1000).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});
const clockDate=(time:number)=>new Date(time*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function PriceHistory({modelId,providers,image=false}:{modelId:string;providers:string[];image?:boolean}){
 const [provider,setProvider]=useState('');
 const [dimension,setDimension]=useState('input');
 const [source,setSource]=useState<'provider'|'model'>('provider');
 const [availableDimensions,setAvailableDimensions]=useState<{dimension:string;unit:string}[]>([]);
 const [windowStart,setWindowStart]=useState(0);
 const [range,setRange]=useState<7|30|90|180>(90);
 const [metric,setMetric]=useState('');
 const [points,setPoints]=useState<ObservedPrice[]>([]);
 const [unit,setUnit]=useState('USD/token');
 const [pending,setPending]=useState(true);
 const [error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 const availableProviders=useMemo(()=>[...new Set(providers)].sort((a,b)=>a.localeCompare(b)),[providers.join('|')]);
 useEffect(()=>{
  const controller=new AbortController();
  setPending(true);setError('');setPoints([]);
  const params=new URLSearchParams({model_id:modelId,provider:source==='model'?'':provider,source,since:String(Math.floor(Date.now()/1000)-range*86400)});
  if(image)params.set('mode','image');else params.set('dimension',dimension);
  fetch('/api/price-history?'+params,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('暂时无法获取价格历史');
   return response.json() as Promise<PriceResult>;
  }).then(result=>{if(!controller.signal.aborted){setPoints(result.data);setAvailableDimensions(result.dimensions||[]);setWindowStart(result.window_start||0);setUnit(result.unit);}})
   .catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);})
   .finally(()=>{if(!controller.signal.aborted)setPending(false);});
  return ()=>controller.abort();
 },[modelId,provider,source,dimension,range,image,retry]);
 const dimensions=useMemo(()=>[...new Set(points.map(p=>p.dimension))].sort(),[points]);
 const selectedMetric=dimensions.includes(metric)?metric:dimensions[0]||'';
 const series=useMemo(()=>{
  const map=new Map<string,Series>();
  for(const p of points){
   if(image&&p.dimension!==selectedMetric)continue;
   const raw=Number(p.price);
   if(!Number.isFinite(raw)||raw<0||!Number.isFinite(p.observed_at))continue;
   const selectedUnit=image?p.unit||'USD/image':unit;
   const value=raw*(selectedUnit==='USD/token'?1e6:1);
   if(!Number.isFinite(value))continue;
   let item=map.get(p.endpoint_id);
   if(!item){item={id:p.endpoint_id,name:source==='model'?'OpenRouter 聚合价':p.provider+(p.tag?' · '+p.tag:''),points:[]};map.set(p.endpoint_id,item);}
   item.points.push({timestamp:p.observed_at,price:value});
  }
  return [...map.values()].map(s=>({...s,points:s.points.sort((a,b)=>a.timestamp-b.timestamp)}))
   .sort((a,b)=>(b.points.at(-1)?.timestamp||0)-(a.points.at(-1)?.timestamp||0)||a.name.localeCompare(b.name));
 },[points,image,selectedMetric,unit,source]);
 const shown=series.slice(0,6);
 const plotted=useMemo(()=>{
  const merged=new Map<number,Record<string,number>>();
  shown.forEach((s,index)=>s.points.forEach(p=>{
   const row=merged.get(p.timestamp)||{timestamp:p.timestamp};
   row['series'+index]=p.price;merged.set(p.timestamp,row);
  }));
  return [...merged.values()].sort((a,b)=>a.timestamp-b.timestamp);
 },[series,image,selectedMetric]);
 const count=shown.reduce((sum,s)=>sum+s.points.length,0);
 return <section className="historic-card" aria-labelledby="historic-title">
  <div className="historic-header"><div><span className="eyebrow">OBSERVED PRICING</span><h3 id="historic-title"><History size={18} aria-hidden="true"/>价格历史</h3><p>{image?'仅比较同一种图片计费项目，不混用不同单位。':'真实观测到的基准与变价点，不插值生成逐小时快照。'}</p></div></div>
  <div className="historic-controls">
   {!image&&<Select size="xs" label="报价来源" value={source} data={[{value:'provider',label:'Provider'},{value:'model',label:'OpenRouter 聚合价'}]} onChange={v=>{setSource(v==='model'?'model':'provider');setProvider('');}}/>}
   {source==='provider'&&<Select size="xs" searchable clearable label="Provider" placeholder="所有 Provider" value={provider||null} data={availableProviders.map(p=>({label:p,value:p}))} onChange={value=>setProvider(value||'')}/>}
   {image?<Select size="xs" label="图片计费项" disabled={!dimensions.length} value={selectedMetric||null} data={dimensions.map(d=>({value:d,label:d}))} onChange={value=>setMetric(value||'')}/>:
   <Select size="xs" label="价格维度" value={dimension} data={(availableDimensions.length?availableDimensions:[{dimension:'input',unit:'USD/token'},{dimension:'output',unit:'USD/token'}]).map(d=>({value:d.dimension,label:({input:'输入 Token',output:'输出 Token',cache_read:'缓存读取',cache_write:'缓存写入',cache_write_1h:'缓存写入 1h',input_audio_cache:'音频缓存',internal_reasoning:'推理 Token'} as Record<string,string>)[d.dimension]||d.dimension}))} onChange={value=>{if(value)setDimension(value);}}/>}
   <SegmentedControl size="xs" aria-label="价格历史时间范围" value={String(range)} data={[7,30,90,180].map(d=>({value:String(d),label:d+' 天'}))} onChange={v=>setRange(Number(v) as 7|30|90|180)}/>
  </div>
  {pending?<div className="chart-placeholder" role="status"><Loader size="sm"/>正在获取观测点…</div>:
   error?<Alert icon={<AlertCircle size={16}/>} color="red" title="历史数据获取失败">{error}<Button size="xs" variant="light" onClick={()=>setRetry(n=>n+1)}>重新查询</Button></Alert>:
   !count?<div className="chart-placeholder">所选范围内暂无价格观察点。这不表示此前价格没有变化。</div>:
   <>
    <LineChart h={260} data={plotted} dataKey="timestamp" series={shown.map((s,i)=>({name:'series'+i,label:s.name,color:colors[i%colors.length]}))}
     curveType="stepAfter" connectNulls withDots withLegend withTooltip gridAxis="y" tickLine="none"
     xAxisProps={{type:'number',domain:['dataMin','dataMax'],tickFormatter:(value:number)=>dateLabel(value)}}
     tooltipProps={{labelFormatter:(value)=>clockDate(Number(value))}}
     valueFormatter={value=>money(value)}
    />
    <Group className="chart-footline" justify="space-between" gap="xs" wrap="wrap">
     <span>{count} 个实际观测点{points.some(p=>p.observed_at<windowStart)?' · 包含窗口前有效基准':''}{series.length>6?' · 仅显示最近的 6 个端点':''}</span>
     <span>{(image?points.find(p=>p.dimension===selectedMetric)?.unit:unit)==='USD/token'?'USD / 百万 Token':(image?points.find(p=>p.dimension===selectedMetric)?.unit:unit)||'USD / 计费项'} · 180 天留存</span>
    </Group>
    {count===1&&<p className="chart-muted">只有一个观测点，无法形成变价趋势。</p>}
   </>}
 </section>;
}

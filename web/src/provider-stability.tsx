import {useEffect,useState} from 'react';
import {Badge,Button,Loader,SegmentedControl,Select,Table} from '@mantine/core';
import {Activity,RefreshCw} from 'lucide-react';
import {priceDimensionLabel} from '../../src/event-labels';

type Dimension={dimension:string;unit:string;endpoints:number};
type Stability={
 provider:string;status:'ready'|'stale'|'insufficient';
 endpointCount:number;coveredEndpoints:number;freshEndpoints:number;
 changeCount:number;increaseCount:number;decreaseCount:number;changedEndpointDays:number;
 stableDayRate:number|null;maxIncreasePct:number|null;maxDecreasePct:number|null;
 lastChangeAt:number|null;lastScanAt:number|null;unit:string|null;
};
type Data={days:7|30;dimension:string;unit:string|null;dimensions:Dimension[];data:Stability[];from:number;to:number};
const percent=(n:number|null)=>n===null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:1})+'%';
const stamp=(ts:number|null)=>ts?new Date(ts*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
export function ProviderPriceStability({modelId}:{modelId:string}){
 const [days,setDays]=useState<7|30>(30);
 const [dimension,setDimension]=useState('');
 const [data,setData]=useState<Data|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  const abort=new AbortController();
  setLoading(true);setError('');setData(null);
  const params=new URLSearchParams({model_id:modelId,days:String(days)});
  if(dimension)params.set('dimension',dimension);
  fetch('/api/provider-stability?'+params,{signal:abort.signal,credentials:'same-origin'}).then(async response=>{
   const payload=await response.json() as Data&{error?:string};
   if(!response.ok)throw Error(payload.error||'无法读取 Provider 价格稳定性');
   return payload;
  }).then(result=>{if(!abort.signal.aborted)setData(result);})
   .catch(e=>{if(!abort.signal.aborted)setError((e as Error).message);})
   .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return ()=>abort.abort();
 },[modelId,days,dimension,retry]);
 const metric=data?.dimension||dimension;
 return <section className="provider-stability historic-card" aria-labelledby="provider-stability-title">
  <div className="historic-header">
   <div><span className="eyebrow">PROVIDER PRICE CONSISTENCY</span>
    <h3 id="provider-stability-title"><Activity size={18} aria-hidden="true"/>Provider 价格稳定性</h3>
    <p>只比较同一模型、同一计价维度。稳定率是没有观测到变价的端点日比例，不是 API 可用率、响应速度或推理质量。</p>
   </div>
  </div>
  <div className="historic-controls">
   <Select size="xs" searchable label="计价维度" value={metric||null}
    disabled={!data?.dimensions.length} data={(data?.dimensions||[]).map(item=>({
     value:item.dimension,label:priceDimensionLabel(item.dimension)+(item.unit?' · '+item.unit:'')
    }))} placeholder={loading?'正在获取…':'没有可比较的报价'}
    onChange={value=>{if(value)setDimension(value);}}/>
   <SegmentedControl size="xs" aria-label="Provider 价格稳定性统计周期" value={String(days)}
    data={[{value:'7',label:'7 天'},{value:'30',label:'30 天'}]}
    onChange={value=>setDays(value==='7'?7:30)}/>
   <Button size="xs" variant="subtle" color="gray" aria-label="重新计算稳定性" onClick={()=>setRetry(x=>x+1)}><RefreshCw size={14}/></Button>
  </div>
  {loading?<div className="chart-placeholder" role="status"><Loader size="sm"/>计算真实价格变化…</div>:
  error?<div className="chart-placeholder" role="alert">{error}<Button size="xs" variant="light" onClick={()=>setRetry(x=>x+1)}>重试</Button></div>:
  !data?.data.length?<div className="chart-placeholder">目前没有活跃 Provider 端点可供比较。</div>:
  <div className="scroll-x"><Table className="radar-data-table provider-stability-table" highlightOnHover verticalSpacing="xs" horizontalSpacing="sm">
   <thead><tr><th scope="col">Provider</th><th scope="col">稳定率</th><th scope="col">变价次数</th>
    <th scope="col">最大涨/降幅</th><th scope="col">历史覆盖</th><th scope="col">最近扫描</th></tr></thead>
   <tbody>{data.data.map(item=><tr key={item.provider}>
    <td><strong>{item.provider}</strong></td>
    <td>{item.status==='ready'?<strong>{percent(item.stableDayRate)}</strong>:
     <Badge size="sm" variant="light" color={item.status==='stale'?'yellow':'gray'}>
      {item.status==='stale'?'采集已过期':'历史不足'}</Badge>}</td>
    <td>{item.changeCount} 次 <span className="stability-muted">↑{item.increaseCount} / ↓{item.decreaseCount}</span></td>
    <td><span className="stability-up">{percent(item.maxIncreasePct)}</span> / <span className="stability-down">{percent(item.maxDecreasePct)}</span></td>
    <td>{item.coveredEndpoints}/{item.endpointCount} 个端点</td>
    <td className="time-cell">{stamp(item.lastScanAt)}</td>
   </tr>)}</tbody>
  </Table></div>}
  <p className="stability-note">统计窗口：最近 {days} 天。每个端点每天变价多次只计一个“变价端点日”；涨跌次数仍逐次记录。仅在所有活跃端点具有覆盖整个窗口的真实价格基准且最近 3 小时内模型采集成功时显示稳定率。最近扫描是模型元数据采集时间，并非 Provider 实际请求成功率。</p>
 </section>;
}

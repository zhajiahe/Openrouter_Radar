import {useEffect,useState} from 'react';
import {BarChart,DonutChart} from '@mantine/charts';
import {ActionIcon,Button,Group,Loader,Progress,SegmentedControl,Select,Text} from '@mantine/core';
import {Activity,ArrowUpRight,RefreshCw} from 'lucide-react';
import './data-visualization.css';
import {priceDimensionLabel} from '../../src/event-labels';

type DailyPoint={date:string;total:number;priceUp:number;priceDown:number;lifecycle:number;other:number};
type ModelKind={kind:string;count:number};
type ProviderRank={provider:string;models:number;endpoints:number};
type AnalyticsData={days:7|30;from:number;to:number;updatedAt:number;daily:DailyPoint[];modelKinds:ModelKind[];topProviders:ProviderRank[];priceDimensions?:{dimension:string;count:number}[]};
const SERIES=[
 {name:'priceUp',label:'价格上涨',color:'var(--chart-up)'},
 {name:'priceDown',label:'价格下降',color:'var(--chart-down)'},
 {name:'lifecycle',label:'模型 / 端点状态',color:'var(--chart-violet)'},
 {name:'other',label:'其他变化',color:'var(--chart-muted)'}
];
const dateLabel=(value:string)=>new Date(value+'T00:00:00Z').toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',timeZone:'UTC'});
const number=(value:number)=>value.toLocaleString('zh-CN');
const kindLabel=(kind:string)=>kind==='image'?'图片模型':kind==='standard'?'常规模型':kind==='other'?'其他模型':kind;

export function AnalyticsDashboard({onSelectDay,onSelectProvider}:{onSelectDay:(date:string)=>void;onSelectProvider:(provider:string)=>void}){
 const [days,setDays]=useState<7|30>(7);
 const [data,setData]=useState<AnalyticsData|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [refreshToken,setRefreshToken]=useState(0);
 useEffect(()=>{
  let cancelled=false;
  const load=async()=>{
   if(!cancelled)setLoading(true);
   try{
    const response=await fetch('/api/analytics?days='+days,{credentials:'same-origin'});
    const body=await response.json() as AnalyticsData|{error?:string};
    if(!response.ok)throw new Error(('error' in body&&body.error)||'暂时无法获取图表数据');
    if(!cancelled){setData(body as AnalyticsData);setError('');}
   }catch(e){if(!cancelled)setError((e as Error).message);}
   finally{if(!cancelled)setLoading(false);}
  };
  void load();
  const interval=window.setInterval(()=>void load(),60_000);
  return ()=>{cancelled=true;window.clearInterval(interval);};
 },[days,refreshToken]);
 const visibleData=data?.days===days?data:null;
 const totalEvents=visibleData?.daily.reduce((sum,d)=>sum+d.total,0)??0;
 const priceEvents=visibleData?.daily.reduce((sum,d)=>sum+d.priceUp+d.priceDown,0)??0;
 const activeModels=visibleData?.modelKinds.reduce((sum,k)=>sum+k.count,0)??0;
 const updated=visibleData?.updatedAt?new Date(visibleData.updatedAt*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'—';
 const modelKinds=visibleData?.modelKinds.filter(x=>x.count>0).map((x,i)=>({
  name:kindLabel(x.kind),value:x.count,color:['var(--chart-violet)','var(--chart-down)','var(--chart-up)','var(--chart-muted)'][i%4]
 }))??[];
 return <section className="analytics-shell" aria-labelledby="analytics-title">
  <div className="analytics-heading">
   <div><span className="eyebrow">MARKET TELEMETRY</span><h2 id="analytics-title">市场动态</h2><p>仅展示实际观察到的价格、生命周期与 Provider 变化。</p></div>
   <Group gap="xs" wrap="nowrap">
    <SegmentedControl size="xs" aria-label="市场趋势范围" value={String(days)} onChange={value=>setDays(value==='30'?30:7)} data={[{label:'7 天',value:'7'},{label:'30 天',value:'30'}]}/>
    <ActionIcon variant="default" size="lg" aria-label="刷新市场图表" title="刷新" disabled={loading} onClick={()=>setRefreshToken(v=>v+1)}><RefreshCw size={16}/></ActionIcon>
   </Group>
  </div>
  <div className="analytics-summary" aria-live="polite">
   <div><Activity size={16} aria-hidden="true"/><span>{days} 天内事件</span><strong>{visibleData?number(totalEvents):'—'}</strong></div>
   <div><ArrowUpRight size={16} aria-hidden="true"/><span>价格调整</span><strong>{visibleData?number(priceEvents):'—'}</strong></div>
   <div><span>活跃模型</span><strong>{visibleData?number(activeModels):'—'}</strong></div>
   <small>{loading?'同步中…':'最近更新 '+updated}</small>
  </div>
  {error&&<div className="chart-inline-error" role="alert">{error}<Button variant="light" size="xs" onClick={()=>setRefreshToken(v=>v+1)}>重试</Button></div>}
  {visibleData?.priceDimensions?.length?<div className="chart-dimensions" aria-label="价格调整维度">{visibleData.priceDimensions.map(item=><span key={item.dimension}>{priceDimensionLabel(item.dimension)} · {number(item.count)}</span>)}</div>:null}
  <div className="analytics-grid">
   <section className="chart-panel chart-panel-wide" aria-labelledby="activity-title">
    <div className="chart-heading"><div><h3 id="activity-title">每日变动趋势</h3><p>UTC 日期聚合，柱状图支持悬停和键盘查看</p></div><strong>{visibleData?number(totalEvents):'—'} 项</strong></div>
    {visibleData?<BarChart h={260} data={visibleData.daily} dataKey="date" series={SERIES} type="stacked" withLegend withTooltip gridAxis="y" tickLine="none" valueFormatter={value=>number(value)} xAxisProps={{tickFormatter:dateLabel,interval:days===30?5:0}} />:<ChartPlaceholder loading={loading}/>}
    {visibleData&&!visibleData.daily.some(d=>d.total>0)&&<p className="chart-muted">所选范围内没有真实变化事件。</p>}
    <div className="chart-actions">
     <Select size="xs" searchable clearable aria-label="选择一天查看变化事件" placeholder="选择有变化的日期查看事件" data={(visibleData?.daily??[]).filter(d=>d.total>0).map(d=>({value:d.date,label:dateLabel(d.date)+' · '+d.total+' 项'}))} onChange={value=>{if(value)onSelectDay(value);}}/>
    </div>
   </section>
   <section className="chart-panel chart-panel-mix" aria-labelledby="mix-title">
    <div className="chart-heading"><div><h3 id="mix-title">模型类型构成</h3><p>当前活跃目录，非历史累计</p></div></div>
    {visibleData?(modelKinds.length?<div className="donut-layout"><DonutChart size={180} thickness={22} paddingAngle={3} data={modelKinds} tooltipDataSource="segment" chartLabel={number(activeModels)}/><div className="donut-breakdown">{modelKinds.map(x=><div key={x.name}><span>{x.name}</span><strong>{number(x.value)}</strong></div>)}</div></div>:<p className="chart-muted">暂无活跃模型</p>):<ChartPlaceholder loading={loading}/>}
   </section>
   <section className="chart-panel chart-panel-providers" aria-labelledby="provider-title">
    <div className="chart-heading"><div><h3 id="provider-title">Provider 覆盖排行</h3><p>当前覆盖的模型数 · 点击查看相关变动</p></div></div>
    {visibleData?(visibleData.topProviders.length?<div className="provider-ranking">{visibleData.topProviders.map((item,index)=>{
     const max=Math.max(1,...visibleData.topProviders.map(v=>v.models));
     return <button key={item.provider} type="button" className="provider-rank-row" onClick={()=>onSelectProvider(item.provider)}>
      <div><span>{index+1}. {item.provider}</span><strong>{number(item.models)} 模型</strong></div>
      <Progress value={item.models/max*100} color="violet" size="sm" aria-label={item.provider+' 覆盖 '+item.models+' 个模型'}/>
      <small>{number(item.endpoints)} 个端点</small>
     </button>;
    })}</div>:<p className="chart-muted">暂无活跃 Provider</p>):<ChartPlaceholder loading={loading}/>}
   </section>
  </div>
  <Text c="dimmed" size="xs" mt="sm">数据源：实例中的模型目录与变化事件。每分钟刷新，首次采集不算变价。</Text>
 </section>;
}
function ChartPlaceholder({loading}:{loading:boolean}){
 return <div className="chart-placeholder" role="status">{loading?<><Loader size="sm"/>正在加载真实数据…</>:'暂无可用数据'}</div>;
}

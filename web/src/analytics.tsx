import React,{useEffect,useState} from 'react';
import './analytics.css';

type DailyPoint={date:string;total:number;priceUp:number;priceDown:number;lifecycle:number;other:number};
type ModelKind={kind:string;count:number};
type ProviderRank={provider:string;models:number;endpoints:number};
type AnalyticsData={days:7|30;from:number;to:number;updatedAt:number;daily:DailyPoint[];modelKinds:ModelKind[];topProviders:ProviderRank[]};
const SERIES=[
 {key:'priceUp',label:'价格上涨',color:'var(--chart-up)'},
 {key:'priceDown',label:'价格下降',color:'var(--chart-down)'},
 {key:'lifecycle',label:'模型 / 端点状态',color:'var(--chart-violet)'},
 {key:'other',label:'其他变化',color:'var(--chart-muted)'}
] as const;
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
  const timer=window.setInterval(()=>void load(),60_000);
  return ()=>{cancelled=true;window.clearInterval(timer);};
 },[days,refreshToken]);
 const totalEvents=data?.daily.reduce((sum,d)=>sum+d.total,0)??0;
 const priceEvents=data?.daily.reduce((sum,d)=>sum+d.priceUp+d.priceDown,0)??0;
 const activeModels=data?.modelKinds.reduce((sum,k)=>sum+k.count,0)??0;
 const updatedLabel=data?.updatedAt?new Date(data.updatedAt*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'—';
 return <section className="analytics-shell" aria-labelledby="analytics-title">
  <div className="analytics-heading">
   <div className="analytics-title-copy">
    <div className="eyebrow">MARKET TELEMETRY</div>
    <h2 id="analytics-title">市场动态</h2>
    <p>把真实的价格变化、模型生命周期与 Provider 覆盖，变成一眼能读懂的信号。</p>
   </div>
   <div className="analytics-toolbar">
    <div className="analytics-range" role="group" aria-label="图表时间范围">
     <button type="button" aria-pressed={days===7} className={days===7?'selected':''} onClick={()=>setDays(7)}>7 天</button>
     <button type="button" aria-pressed={days===30} className={days===30?'selected':''} onClick={()=>setDays(30)}>30 天</button>
    </div>
    <button type="button" className={'analytics-refresh '+(loading?'spinning':'')} onClick={()=>setRefreshToken(v=>v+1)} disabled={loading} aria-label="刷新图表数据" title="刷新数据">↻</button>
   </div>
  </div>
  <div className="analytics-summary" aria-live="polite">
   <div><span className="summary-pulse"/><span>{days} 天内真实事件</span><strong>{data?number(totalEvents):'—'}</strong></div>
   <span className="summary-separator"/>
   <div><span className="summary-mark price-mark">↗</span><span>价格调整</span><strong>{data?number(priceEvents):'—'}</strong></div>
   <span className="summary-separator"/>
   <div><span className="summary-mark model-mark">◈</span><span>当前活跃模型</span><strong>{data?number(activeModels):'—'}</strong></div>
   <span className="analytics-updated">{loading?'同步中…':'更新于 '+updatedLabel}</span>
  </div>
  {error&&<div className="analytics-error" role="status"><span>{error}</span><button type="button" onClick={()=>setRefreshToken(v=>v+1)}>重试</button></div>}
  <div className="analytics-grid">
   <section className="chart-panel chart-panel-wide" aria-labelledby="activity-title">
    <div className="chart-panel-heading">
     <div><span className="chart-kicker">SIGNAL FLOW</span><h3 id="activity-title">每日变动趋势</h3><p>按 UTC 日期统计的真实事件 · 点击柱条查看明细</p></div>
     <div className="chart-total"><strong>{data?number(totalEvents):'—'}</strong><span>事件</span></div>
    </div>
    {data?<ActivityChart points={data.daily} onSelectDay={onSelectDay}/>:<ChartPlaceholder loading={loading}/>}
    <div className="chart-legend">{SERIES.map(s=><span key={s.key}><i style={{background:s.color}}/>{s.label}</span>)}</div>
   </section>
   <section className="chart-panel chart-panel-mix" aria-labelledby="mix-title">
    <div className="chart-panel-heading"><div><span className="chart-kicker">MODEL LANDSCAPE</span><h3 id="mix-title">模型类型构成</h3><p>当前活跃目录的模型分布</p></div></div>
    {data?<ModelDonut data={data.modelKinds}/>:<ChartPlaceholder loading={loading}/>}
   </section>
   <section className="chart-panel chart-panel-providers" aria-labelledby="provider-title">
    <div className="chart-panel-heading"><div><span className="chart-kicker">PROVIDER COVERAGE</span><h3 id="provider-title">活跃 Provider 排名</h3><p>按当前覆盖模型数量排序 · 点击 Provider 查看事件</p></div><span className="ranking-icon">↗</span></div>
    {data?<ProviderBars data={data.topProviders} onSelectProvider={onSelectProvider}/>:<ChartPlaceholder loading={loading}/>}
   </section>
  </div>
  <div className="analytics-footnote"><span>◉</span> 数据来自 Radar 的生产目录与事件记录 · 每分钟自动刷新{data?.days?' · UTC 日期聚合':''}</div>
 </section>;
}

function ActivityChart({points,onSelectDay}:{points:DailyPoint[];onSelectDay:(date:string)=>void}){
 const [active,setActive]=useState<number|null>(null);
 const width=760,height=254,left=36,right=12,top=14,bottom=32;
 const plotWidth=width-left-right,plotHeight=height-top-bottom;
 const step=plotWidth/Math.max(points.length,1);
 const barWidth=Math.min(20,step*.58);
 const maxValue=Math.max(1,...points.map(p=>p.total));
 const ceiling=Math.max(4,Math.ceil(maxValue/4));
 const max=ceiling*4;
 const y=(value:number)=>top+plotHeight-(value/max)*plotHeight;
 const ticks=Array.from({length:5},(_,i)=>i*ceiling);
 const labelIndexes=[...new Set([0,Math.round((points.length-1)/3),Math.round((points.length-1)*2/3),points.length-1])];
 const hovered=active===null?null:points[active];
 return <div className="activity-chart">
  <div className="activity-hover-readout">
   <div><span className="readout-dot"/><span>{hovered?dateLabel(hovered.date):'悬停预览 · 点击日期查看事件'}</span></div>
   <strong>{hovered?number(hovered.total)+' 个事件':'—'}</strong>
   {hovered&&<small>涨价 {hovered.priceUp} · 降价 {hovered.priceDown} · 生命周期 {hovered.lifecycle} · 其他 {hovered.other}</small>}
  </div>
  <svg className="activity-svg" viewBox={'0 0 '+width+' '+height} role="img" aria-label={points.length+' 天每日事件堆叠柱状图'}>
   <defs><linearGradient id="activityFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--chart-violet)" stopOpacity=".12"/><stop offset="100%" stopColor="var(--chart-violet)" stopOpacity="0"/></linearGradient></defs>
   {ticks.map(t=><g key={t}><line x1={left} x2={width-right} y1={y(t)} y2={y(t)} className="chart-grid-line"/><text x={left-10} y={y(t)+4} className="chart-axis-label" textAnchor="end">{t}</text></g>)}
   {points.map((point,index)=>{
    const x=left+index*step+(step-barWidth)/2;
    let stack=0;
    const bars=SERIES.map(series=>{
     const value=point[series.key];
     const barY=y(stack+value),barH=(value/max)*plotHeight;
     stack+=value;
     return <rect key={series.key} x={x} y={barY} width={barWidth} height={Math.max(0,barH)} rx="2.5" fill={series.color} className="chart-stack-bar"/>;
    });
    const isActive=active===index;
    return <g key={point.date} tabIndex={0} role="button" aria-label={point.date+'，'+point.total+' 个事件，点击查看明细'} onClick={()=>onSelectDay(point.date)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelectDay(point.date);}}} onMouseEnter={()=>setActive(index)} onMouseLeave={()=>setActive(null)} onFocus={()=>setActive(index)} onBlur={()=>setActive(null)} className={isActive?'chart-column is-active':'chart-column'}>
     <rect x={left+index*step} y={top} width={step} height={plotHeight} fill={isActive?'var(--chart-hover)':'transparent'}/>
     {point.total>0&&<line x1={x+barWidth/2} x2={x+barWidth/2} y1={y(point.total)} y2={top+plotHeight} className="chart-bar-stem"/>}
     {bars}
     {labelIndexes.includes(index)&&<text x={left+index*step+step/2} y={height-10} textAnchor="middle" className="chart-axis-label">{dateLabel(point.date)}</text>}
    </g>;
   })}
  </svg>
  {!points.some(p=>p.total>0)&&<div className="chart-empty-overlay">{'该时间段内暂无已确认事件'}</div>}
 </div>;
}

function ModelDonut({data}:{data:ModelKind[]}){
 const colors=['var(--chart-violet)','var(--chart-down)','var(--chart-up)'];
 const normalized=data.map((item,index)=>({...item,label:kindLabel(item.kind),color:colors[index%colors.length]}));
 const total=normalized.reduce((sum,item)=>sum+item.count,0);
 const radius=66,circumference=2*Math.PI*radius;
 let offset=0;
 const segments=normalized.map(item=>{
  const length=total?item.count/total*circumference:0;
  const result={...item,length,offset};
  offset+=length;
  return result;
 });
 return <div className="donut-layout">
  <div className="donut-visual">
   <svg viewBox="0 0 180 180" role="img" aria-label={'活跃模型类型构成，共 '+total+' 个模型'}>
    <circle cx="90" cy="90" r={radius} className="donut-track" fill="none" strokeWidth="20"/>
    {segments.map(segment=><circle key={segment.kind} cx="90" cy="90" r={radius} fill="none" stroke={segment.color} strokeWidth="20" strokeLinecap="round" strokeDasharray={total?segment.length+' '+(circumference-segment.length):'0 '+circumference} strokeDashoffset={-segment.offset} transform="rotate(-90 90 90)" className="donut-segment"><title>{segment.label}: {number(segment.count)}</title></circle>)}
    <text x="90" y="86" textAnchor="middle" className="donut-center-value">{number(total)}</text>
    <text x="90" y="106" textAnchor="middle" className="donut-center-label">活跃模型</text>
   </svg>
  </div>
  <div className="donut-legend">{normalized.length?normalized.map(item=><div key={item.kind}><span className="donut-legend-label"><i style={{background:item.color}}/>{item.label}</span><strong>{number(item.count)}</strong><small>{total?Math.round(item.count/total*100):0}%</small></div>):<div className="chart-empty">暂无模型类型数据</div>}</div>
 </div>;
}

function ProviderBars({data,onSelectProvider}:{data:ProviderRank[];onSelectProvider:(provider:string)=>void}){
 const max=Math.max(1,...data.map(item=>item.models));
 return <div className="provider-bars">
  {data.length?data.map((item,index)=><button type="button" className="provider-bar-row" key={item.provider} onClick={()=>onSelectProvider(item.provider)} aria-label={'查看 '+item.provider+' 的相关监控事件'} title={'查看 '+item.provider+' 的监控事件'}>
   <div className="provider-bar-label"><span className="provider-rank">{String(index+1).padStart(2,'0')}</span><strong title={item.provider}>{item.provider}</strong><span>{number(item.models)} 模型</span></div>
   <div className="provider-bar-track" role="img" aria-label={item.provider+' 覆盖 '+item.models+' 个模型和 '+item.endpoints+' 个端点'}><div className="provider-bar-fill" style={{width:(item.models/max*100)+'%',animationDelay:(index*65)+'ms'}}/></div>
   <div className="provider-bar-meta"><span>{number(item.endpoints)} 个端点</span><span>{Math.round(item.models/max*100)}%</span></div>
  </button>):<div className="chart-empty">暂无活跃 Provider 数据</div>}
 </div>;
}

function ChartPlaceholder({loading}:{loading:boolean}){
 return <div className={loading?'chart-placeholder is-loading':'chart-placeholder'} aria-label={loading?'正在加载图表':'图表数据不可用'}><span/>{loading?'正在汇总真实数据…':'暂无可用数据'}</div>;
}

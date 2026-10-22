import React,{useEffect,useRef,useState} from 'react';
import {Alert,Badge,Button,Checkbox,Loader,MantineProvider,Modal,NumberInput,Pagination,Select,Table,TextInput} from '@mantine/core';
import {Activity,ArrowRight,Bell,Bookmark,Check,ChevronDown,ChevronLeft,ChevronRight,Copy,Download,ExternalLink,History,Layers,LayoutDashboard,Moon,Plus,Radar,RefreshCw,Rss,Search,SlidersHorizontal,Sun,UserRound,X} from 'lucide-react';
import {useDebouncedValue} from '@mantine/hooks';
import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import {createRoot} from 'react-dom/client';
import './style.css';
import './router-inspired.css';
import './monitoring.css';
import './preferences.css';
import './component-library.css';
import {PriceHistory,CompareModels} from './monitoring';
import {AnalyticsDashboard} from './analytics';
import {utcEventBounds} from './event-date';
import {ProviderPriceStability} from './provider-stability';
import {eventTitle,priceDimensionLabel} from '../../src/event-labels';

type Model={id:string;name:string;context_length:number|null;updated_at:number;expiration_date?:number|null;alias_target?:string|null;lowest_input?:number|null;provider_count?:number;model_kind?:string;lifecycle_status?:string};
type ProviderOption={provider:string;model_count:number};
type Endpoint={id:string;provider:string;tag:string;source:string;input_price:string|null;output_price:string|null;status:string;checked_at:number;pricing_json:string};
type Collection={status:string;last_attempt:number|null;last_success:number|null;last_error:string|null;age_seconds:number|null;active_endpoints:number;missing_endpoints:number};
type Watch={id:string;model_id:string;name:string;provider:string|null;price_dimension?:string|null;events_json:string;threshold_pct:number;frequency:string;paused:number;last_hit:number|null;last_sent:number|null;latest_status:string|null};
type Event={id:string;model_id:string;provider:string;kind:string;dimension:string|null;old_price:string|null;new_price:string|null;change_pct:number|null;created_at:number};
type Notice=Event&{id:string;status:string;read_at:number|null;sent_at:number|null;created_at:number};
const EVENTS=[
 ['price.decreased','所有维度的价格下降'],['price.increased','所有维度的价格上涨'],['image.price_decreased','图片价格下降（所有计费项）'],['image.price_increased','图片价格上涨（所有计费项）'],['image.price_policy_changed','图片计费规则变化'],['model.added','模型上架'],['model.removed','模型下架'],['model.restored','模型恢复'],['endpoint.added','新 Provider'],['endpoint.removed','端点下线'],['endpoint.restored','端点恢复'],['price.policy_changed','定价规则变化'],['model.context_changed','上下文变化'],['model.capability_changed','模型能力变化'],['model.alias_changed','别名目标变化'],['model.expiration_changed','到期日期变化'],['model.expiring','即将到期']
] as const;
const DIMENSION_OPTIONS=[{value:'input',label:'输入 Token'},{value:'output',label:'输出 Token'},{value:'cache_read',label:'缓存读取'},{value:'cache_write',label:'缓存写入'},{value:'cache_write_1h',label:'缓存写入 1h'},{value:'input_audio_cache',label:'音频缓存'},{value:'internal_reasoning',label:'推理 Token'},{value:'image_token',label:'图片 Token'},{value:'audio_output',label:'音频输出'}];
const label=(kind:string)=>EVENTS.find(e=>e[0]===kind)?.[1]||kind;
const time=(ts:number)=>new Date(ts*1000).toLocaleString();
const million=(price:string|null)=>price===null?'—':'$'+(Number(price)*1e6).toLocaleString(undefined,{maximumFractionDigits:5});
const endpointPrice=(price:string|null)=>million(price);
const extraPrice=(ep:Endpoint,field:string)=>{
 if(ep.pricing_json.includes('image_pricing'))return '—';
 try{
  const raw=(JSON.parse(ep.pricing_json) as Record<string,unknown>)[field];
  return (typeof raw==='string'||typeof raw==='number')&&Number.isFinite(Number(raw))&&Number(raw)>=0?million(String(raw)):'—';
 }catch{return '—';}
};
const formatEvent=(e:Event):string=>{
 if(e.kind==='model.expiring')return '上游预计到期：进入 '+(e.new_price||'?')+' 天提醒窗口（不等于下架）';
 if(e.kind.startsWith('image.price_'))return priceDimensionLabel(e.dimension)+'：'+(e.old_price??'未提供')+' → '+(e.new_price??'未提供')+' USD / 指定单位';
 if(e.kind==='model.added')return '模型首次出现在已建立基准的目录中';
 if(e.kind==='model.removed')return '连续两次成功目录采集未找到该模型';
 if(e.kind==='model.restored')return '曾确认下架的模型重新出现';
 if(e.kind==='price.policy_changed'){
  if(e.dimension?.startsWith('scheduled_'))return '分时生效价格切换（预定窗口，非临时涨跌）：'+(e.old_price||'未知')+' → '+(e.new_price||'未知');
  if(e.dimension==='discount')return '折扣规则变化（不能直接视作降价）：'+(e.old_price||'未知')+' → '+(e.new_price||'未知');
  return (e.dimension||'计价规则')+' 已发生变化';
 }
 if(e.kind.startsWith('model.'))return (e.dimension||'模型属性')+'：'+(e.old_price||'未知').slice(0,90)+' → '+(e.new_price||'未知').slice(0,90);
 if(e.old_price!==null&&e.new_price!==null){
   const token=['input','output','cache_read','cache_write','cache_write_1h'].includes(e.dimension||'');
   const f=(v:string)=>token?million(v):v;
   return priceDimensionLabel(e.dimension)+': '+f(e.old_price)+' → '+f(e.new_price)+(token?' / 百万 Token':' / 原始计费单位');
 }
 return 'Provider 端点状态变化';
};
async function api<T>(path:string,options?:RequestInit):Promise<T>{
 const r=await fetch('/api'+path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});
 const body=await r.json().catch(()=>({error:'Server unavailable'})) as {error?:string};
 if(!r.ok)throw new Error(body.error||'Request failed');
 return body as T;
}
function App(){
 const [view,setView]=useState('overview');
 const [theme,setTheme]=useState<'light'|'dark'>(()=>localStorage.getItem('radar-theme')==='dark'?'dark':'light');
 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('radar-theme',theme);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#15141a':'#ffffff');},[theme]);
 useEffect(()=>{document.documentElement.lang='zh-CN';},[]);
 const [user,setUser]=useState<{id:string;email:string}|null>(null);
 const [authMode,setAuthMode]=useState('login');
 const [email,setEmail]=useState('');
 const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [stats,setStats]=useState({models:0,providers:0,subscriptions:0,events24h:0});
 const [models,setModels]=useState<Model[]>([]);
 const [modelTotal,setModelTotal]=useState(0);
 const [modelLoading,setModelLoading]=useState(false);
 const [providers,setProviders]=useState<ProviderOption[]>([]);
 const [providerFilter,setProviderFilter]=useState('');
 const [sort,setSort]=useState('name');
 const [authorFilter,setAuthorFilter]=useState('');
 const [modalityFilter,setModalityFilter]=useState('');
 const [capabilityFilter,setCapabilityFilter]=useState('');
 const [minContext,setMinContext]=useState('');
 const [maxInput,setMaxInput]=useState('');
 const [compareIds,setCompareIds]=useState<string[]>([]);
 const catalogSearch=useRef<HTMLInputElement>(null);
 const navRef=useRef<HTMLElement>(null);
 const [navAtEnd,setNavAtEnd]=useState(false);
 const [filtersOpen,setFiltersOpen]=useState(false);
 const modelRequest=useRef(0);
 const eventRequest=useRef(0);
 const detailRef=useRef<HTMLDivElement>(null);
 const [deleteWatchId,setDeleteWatchId]=useState<string|null>(null);
 const [events,setEvents]=useState<Event[]>([]);
 const [recentEvents,setRecentEvents]=useState<Event[]>([]);
 const [modelEvents,setModelEvents]=useState<Event[]>([]);
 const [eventSearch,setEventSearch]=useState('');
 const [eventKind,setEventKind]=useState('');
 const [eventProvider,setEventProvider]=useState('');
 const [eventStart,setEventStart]=useState('');
 const [eventEnd,setEventEnd]=useState('');
 const [eventPage,setEventPage]=useState(1);
 const [eventTotal,setEventTotal]=useState(0);
 const [loadingEvents,setLoadingEvents]=useState(false);
 const [watches,setWatches]=useState<Watch[]>([]);
 const [editingWatch,setEditingWatch]=useState<string|null>(null);
 const [watchDraft,setWatchDraft]=useState<{provider:string;threshold_pct:number;frequency:string;price_dimension:string;events:string[]}>({provider:'',threshold_pct:0,frequency:'instant',price_dimension:'',events:[]});
 const [notices,setNotices]=useState<Notice[]>([]);
 const [search,setSearch]=useState('');
 const [debouncedSearch]=useDebouncedValue(search,250);
 const [debouncedEventSearch]=useDebouncedValue(eventSearch,250);
 const [page,setPage]=useState(1);
 const [selected,setSelected]=useState<Model|null>(null);
 const [endpoints,setEndpoints]=useState<Endpoint[]>([]);
 const [collection,setCollection]=useState<Collection|null>(null);
 const [watchProvider,setWatchProvider]=useState('');
 const [watchDimension,setWatchDimension]=useState('');
 const [threshold,setThreshold]=useState(0);
 const [frequency,setFrequency]=useState('instant');
 const [kinds,setKinds]=useState<string[]>(['price.decreased','price.increased','image.price_decreased','image.price_increased','model.added','model.removed','model.restored','endpoint.added','endpoint.removed','endpoint.restored']);
 const [status,setStatus]=useState<{status:string;catalog_last_success:number|null;provider_total?:number;provider_scanned?:number;provider_due?:number;provider_errors?:number;provider_recent?:number}>({status:'degraded',catalog_last_success:null});

 async function loadPublic(){
  const results=await Promise.allSettled([api<typeof stats>('/stats'),api<{data:Event[]}>('/events?limit=40'),fetch('/api/health',{credentials:'same-origin'}).then(r=>r.json() as Promise<typeof status>)]);
  if(results[0].status==='fulfilled')setStats(results[0].value);
  if(results[1].status==='fulfilled')setRecentEvents(results[1].value.data);
  if(results[2].status==='fulfilled')setStatus(results[2].value);
 }
 async function loadPrivate(){
  const results=await Promise.allSettled([api<{data:Watch[]}>('/subscriptions'),api<{data:Notice[]}>('/notifications')]);
  if(results[0].status==='fulfilled')setWatches(results[0].value.data);
  if(results[1].status==='fulfilled')setNotices(results[1].value.data);
 }
 async function loadModels(q:string,p:number,provider:string,order:string,author:string,modality:string,capability:string,context:string,maxPrice:string){
  const requestId=++modelRequest.current;
  setModelLoading(true);
  try{
   const params=new URLSearchParams({q,page:String(p),limit:'30',provider,sort:order,author,modality,capability,min_context:context});
   if(maxPrice.trim())params.set('max_input_price',maxPrice);
   const r=await api<{data:Model[];total:number}>('/models?'+params.toString());
   if(requestId===modelRequest.current){setModels(r.data);setModelTotal(r.total);}
  }catch(e){if(requestId===modelRequest.current)setError((e as Error).message);}finally{if(requestId===modelRequest.current)setModelLoading(false);}
 }
 function openEventDrilldown(filter:{day?:string;provider?:string}){
  setEventSearch('');setEventKind('');setEventPage(1);
  setEventStart(filter.day||'');setEventEnd(filter.day||'');
  setEventProvider(filter.provider||'');
  setView('events');
  window.scrollTo({top:0,behavior:'auto'});
 }
 async function loadEvents(q:string,kind:string,p:number,provider:string,start:string,end:string){
  const requestId=++eventRequest.current;
  setLoadingEvents(true);
  try{
   const params=new URLSearchParams({q,kind,page:String(p),limit:'30',provider});
   if(start){const bounds=utcEventBounds(start);if(bounds)params.set('start',String(bounds.start));}
   if(end){const bounds=utcEventBounds(end);if(bounds)params.set('end',String(bounds.end));}
   const r=await api<{data:Event[];total:number}>('/events?'+params.toString());
   if(requestId===eventRequest.current){setEvents(r.data);setEventTotal(r.total);}
  }catch(e){if(requestId===eventRequest.current)setError((e as Error).message);}finally{if(requestId===eventRequest.current)setLoadingEvents(false);}
 }
 async function inspect(model:Model){
  setSelected(model);setView('catalog');setWatchProvider('');setWatchDimension('');setThreshold(0);setFrequency('instant');
  if(window.matchMedia('(max-width: 990px)').matches)requestAnimationFrame(()=>detailRef.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
  setEndpoints([]);setModelEvents([]);setCollection(null);
  history.replaceState(null,'','#model='+encodeURIComponent(model.id));
  try{
   const [details,changes]=await Promise.all([
    api<{model:Model;endpoints:Endpoint[];collection:Collection}>('/model?id='+encodeURIComponent(model.id)),
    api<{data:Event[]}>('/events?model_id='+encodeURIComponent(model.id)+'&limit=8')
   ]);
   setSelected(details.model);setEndpoints(details.endpoints);setCollection(details.collection);setModelEvents(changes.data);
  }catch(e){setError((e as Error).message);}
 }
 useEffect(()=>{
  const params=new URLSearchParams(location.search);
  if(params.has('verified'))setMessage('邮箱验证成功，请登录。');
  if(params.has('reset'))setAuthMode('reset');
  api<{user:{id:string;email:string}}>('/auth/me').then(r=>{setUser(r.user);}).catch(()=>{});
  api<{data:ProviderOption[]}>('/providers').then(r=>setProviders(r.data)).catch(()=>{});
  const modelId=new URLSearchParams(location.hash.slice(1)).get('model')||'';
  if(modelId){
   void api<{model:Model}>('/model?id='+encodeURIComponent(modelId)).then(r=>void inspect(r.model)).catch(()=>{});
  }
  void loadPublic();
 },[]);
 useEffect(()=>{if(user)void loadPrivate();},[user]);
 useEffect(()=>{void loadModels(debouncedSearch,page,providerFilter,sort,authorFilter,modalityFilter,capabilityFilter,minContext,maxInput);},[debouncedSearch,page,providerFilter,sort,authorFilter,modalityFilter,capabilityFilter,minContext,maxInput]);
 useEffect(()=>{void loadEvents(debouncedEventSearch,eventKind,eventPage,eventProvider,eventStart,eventEnd);},[debouncedEventSearch,eventKind,eventPage,eventProvider,eventStart,eventEnd]);
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   const el=event.target as HTMLElement;
   if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(el.tagName)&&!el.isContentEditable){
    event.preventDefault();setView('catalog');requestAnimationFrame(()=>catalogSearch.current?.focus());
   }
   if(event.key==='Escape'&&document.activeElement===catalogSearch.current)catalogSearch.current?.blur();
  };
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[]);
 async function submitAuth(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError('');setMessage('');
  try{
   const resetToken=new URLSearchParams(location.search).get('reset');
   if(authMode==='reset'){
    await api('/auth/reset-password',{method:'POST',body:JSON.stringify({token:resetToken,password})});
    history.replaceState(null,'','/');setAuthMode('login');setMessage('密码已重置，请登录。');
   }else if(authMode==='forgot'){
    await api('/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});
    setMessage('如果该邮箱已注册，重置邮件会发送至收件箱。');
   }else{
    const path=authMode==='register'?'/auth/register':'/auth/login';
    const result=await api<{message?:string}>(path,{method:'POST',body:JSON.stringify({email,password})});
    if(authMode==='register'){setMessage(result.message||'请检查验证邮件');setAuthMode('login');}
    else {const me=await api<{user:{id:string;email:string}}>('/auth/me');setUser(me.user);setMessage('欢迎回来！');}
   }
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function addWatch(){
  if(!user){setView('account');setMessage('登录后即可订阅监控');return;}
  if(!selected||!kinds.length){setError('请至少选择一种通知事件');return;}
  setBusy(true);setError('');
  try{
   await api('/subscriptions',{method:'POST',body:JSON.stringify({model_id:selected.id,provider:watchProvider||null,price_dimension:watchDimension||null,events:kinds,threshold_pct:Number(threshold),frequency})});
   setMessage('订阅创建成功，后续符合条件的变化将通知你。');await loadPrivate();setView('watches');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function startEditWatch(w:Watch){
  setEditingWatch(w.id);
  setWatchDraft({provider:w.provider||'',frequency:w.frequency,threshold_pct:w.threshold_pct,price_dimension:w.price_dimension||'',events:JSON.parse(w.events_json) as string[]});
 }
 async function saveWatch(id:string){
  if(!watchDraft.events.length){setError('至少选择一个提醒事件');return;}
  setBusy(true);
  try{
   await api('/subscriptions/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({
    provider:watchDraft.provider||null,frequency:watchDraft.frequency,threshold_pct:watchDraft.threshold_pct,price_dimension:watchDraft.price_dimension||null,events:watchDraft.events
   })});
   await loadPrivate();setEditingWatch(null);setMessage('订阅已更新');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function togglePaused(w:Watch){
  try{
   await api('/subscriptions/'+encodeURIComponent(w.id),{method:'PATCH',body:JSON.stringify({paused:!w.paused})});
   await loadPrivate();setMessage(w.paused?'已恢复订阅':'已暂停订阅，未发送的提醒已取消');
  }catch(e){setError((e as Error).message);}
 }
 function toggleCompare(id:string){
  setCompareIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):prev.length<3?[...prev,id]:prev);
  if(compareIds.length===3&&!compareIds.includes(id))setMessage('最多比较 3 个模型');
 }
 function exportUrl(format:'csv'|'json'){
  const params=new URLSearchParams({format,q:eventSearch,kind:eventKind,provider:eventProvider});
  if(eventStart)params.set('start',String(Math.floor(new Date(eventStart+'T00:00:00').getTime()/1000)));
  if(eventEnd)params.set('end',String(Math.floor(new Date(eventEnd+'T23:59:59').getTime()/1000)));
  return '/api/events/export?'+params.toString();
 }
 async function removeWatch(id:string){
  setBusy(true);
  try{await api('/subscriptions/'+encodeURIComponent(id),{method:'DELETE'});await loadPrivate();setMessage('已删除订阅规则');return true;}
  catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}
 }
 async function readNotice(id:string){
  try{await api('/notifications/'+encodeURIComponent(id)+'/read',{method:'PATCH'});await loadPrivate();}
  catch(e){setError((e as Error).message);}
 }
 async function copyModelLink(modelId:string){
  const link=location.origin+location.pathname+'#model='+encodeURIComponent(modelId);
  try{
   if(!navigator.clipboard?.writeText)throw new Error('Clipboard not available');
   await navigator.clipboard.writeText(link);setMessage('模型链接已复制');
  }catch{setError('复制失败，请从地址栏复制当前模型链接');}
 }
 async function logout(){await api('/auth/logout',{method:'POST'});setUser(null);setWatches([]);setNotices([]);setView('overview');}
 const unread=notices.filter(n=>!n.read_at).length;
 const navItems=[{id:'overview',name:'概览',icon:LayoutDashboard},{id:'catalog',name:'Models',icon:Layers},{id:'events',name:'Changes',icon:History},{id:'watches',name:'Watchlist',icon:Bookmark},{id:'notices',name:'通知',icon:Bell}];
 const titles:Record<string,string>={overview:'Overview',catalog:'Models',events:'Changes',watches:'Watchlist',notices:'Notifications',account:'Account'};
 const scanned=status.provider_scanned??0;
 const total=status.provider_total??stats.models;
 const progress=total>0?Math.min(100,Math.round(scanned/total*100)):0;
 const activeFilterCount=[providerFilter,authorFilter,modalityFilter,capabilityFilter,minContext,maxInput].filter(Boolean).length;
 const providerEndpoints=endpoints.filter(ep=>ep.source==='provider').sort((a,b)=>Number(b.status==='active')-Number(a.status==='active')||a.provider.localeCompare(b.provider));
 const observedInput=providerEndpoints.filter(ep=>ep.status==='active'&&!ep.pricing_json.includes('image_pricing')).map(ep=>ep.input_price===null?NaN:Number(ep.input_price)).filter(value=>Number.isFinite(value)&&value>=0);
 const lowestInput=observedInput.length?Math.min(...observedInput):null;
 return <MantineProvider forceColorScheme={theme} theme={{primaryColor:"violet",defaultRadius:"md",fontFamily:"Inter, PingFang SC, Noto Sans SC, system-ui, sans-serif",respectReducedMotion:true}}><div className="layout">
  <aside className="sidebar">
   <div className="brand"><span className="brand-icon" aria-hidden="true"><Radar size={21}/></span><span>OpenRouter <b>Radar</b></span></div>
   <div className="side-caption">MODEL MONITORING</div>
   <nav aria-label="主要导航" ref={navRef} onScroll={e=>{const el=e.currentTarget;setNavAtEnd(el.scrollLeft+el.clientWidth>=el.scrollWidth-3);}}>{navItems.map(({id,name,icon:Icon})=>
    <button key={id} aria-current={view===id?'page':undefined} className={'nav-link '+(view===id?'active':'')} onClick={()=>{setView(id);setError('');if(id!=='catalog')history.replaceState(null,'',location.pathname+location.search);}}>
     <Icon className="nav-icon" size={17} aria-hidden="true"/>{name}{id==='notices'&&unread>0?<span className="counter">{unread}</span>:null}
    </button>)}</nav>
   <button type="button" className="nav-more" aria-label={navAtEnd?'向左滚动导航':'向右滚动导航'} onClick={()=>navRef.current?.scrollBy({left:navAtEnd?-180:180,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}>{navAtEnd?<ChevronLeft size={17}/>:<ChevronRight size={17}/>}</button>
   <div className="side-footer"><span className="sidebar-status"><span className="online-dot"/> OPEN SOURCE RADAR</span><p>不需要个人 API Key。<br/>持续收集，按需订阅。</p><a href="https://github.com/zhajiahe/Openrouter_Radar" target="_blank" rel="noreferrer">在 GitHub 查看项目 ↗</a></div>
  </aside>
  <main className="main">
   <header className="topbar">
    <div className="breadcrumb"><span>Radar</span><span className="breadcrumb-separator">/</span><b>{titles[view]}</b></div>
    <div className="topbar-actions">
     <span className={'live-indicator '+(status.status==='ok'?'':'muted-status')} role="status"><span className="online-dot"/>{status.status==='ok'?"同步正常":"同步状态待确认"}</span>
     <div className="preference-controls"><button onClick={()=>setTheme(v=>v==='light'?'dark':'light')} aria-label="切换深色/浅色主题" title="外观">{theme==='light'?<Moon size={16}/>:<Sun size={16}/>}</button></div>
     <button className="account-button" onClick={()=>setView('account')}><UserRound size={15} aria-hidden="true"/>{user?user.email:"登录 / 注册"}</button>
    </div>
   </header>
   <div className="content">
    {error&&<Alert className="radar-alert" color="red" title="操作失败" role="alert">{error}<button type="button" className="alert-close" aria-label="关闭错误提示" onClick={()=>setError('')}><X size={17}/></button></Alert>}
    {message&&<Alert className="radar-alert" color="green" title="操作成功" role="status">{message}<button type="button" className="alert-close" aria-label="关闭成功提示" onClick={()=>setMessage('')}><X size={17}/></button></Alert>}
    {view==='overview'&&<>
     <div className="metrics">
      {[{value:stats.models,label:'模型总数',icon:Layers,note:'目录内公开模型'},{value:stats.providers,label:'活跃 Provider',icon:Activity,note:'已发现的服务商'},{value:scanned,label:'已采集模型',icon:Radar,note:'Provider 快照覆盖量'},{value:stats.events24h,label:'24 小时事件',icon:History,note:'过去一天的真实变化'}].map(({value,label,icon:Icon,note})=>
       <div className="metric" key={label}><div className="metric-label"><Icon size={17} aria-hidden="true"/>{label}</div><strong>{Number(value).toLocaleString()}</strong><span className="metric-note">{note}</span></div>)}
     </div>
     <AnalyticsDashboard onSelectDay={day=>openEventDrilldown({day})} onSelectProvider={provider=>openEventDrilldown({provider})}/>
     <div className="section-head"><div><h2>Recent changes</h2><p className="section-heading-sub">{"仅展示实际发现的变化，不生成模拟数据"}</p></div><button className="text-action" onClick={()=>setView('events')}>{"全部事件"} <ArrowRight size={14}/></button></div>
     <div className="overview-grid">
      <EventsTable data={recentEvents.slice(0,8)}/>
      <div className="panel scanner-panel">
       <div className="scanner-head"><strong>{"全量采集进度"}</strong><Radar className="scanner-icon" size={19} aria-hidden="true"/></div>
       <div className="scanner-stat"><strong>{scanned.toLocaleString()}</strong><span>/ {total.toLocaleString()} 个模型</span></div>
       <div className="scanner-track" role="progressbar" aria-label="Provider 已扫描模型比例" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="scanner-bar" style={{width:progress+'%'}}/></div>
       <div className="scanner-meta"><span>{"Provider 快照覆盖"}</span><strong>{progress}%</strong></div>
       <div className="scanner-divider"/>
       <div className="scanner-row"><span>目录同步状态</span><strong className={status.status==='ok'?'good':'warning'}>{status.status==='ok'?'正常':'待确认'}</strong></div>
       <div className="scanner-row"><span>{"最近一小时成功扫描"}</span><strong>{(status.provider_recent??0).toLocaleString()} 个</strong></div>
       <div className="scanner-row"><span>{"等待扫描"}</span><strong>{(status.provider_due??0).toLocaleString()} 个</strong></div>
       <div className="scanner-row"><span>{"上次目录同步"}</span><strong>{status.catalog_last_success?time(status.catalog_last_success):'暂无'}</strong></div>
       <p className="scanner-footnote">{"每小时全量同步，按批次抓取 Provider。订阅只影响提醒，不影响采集。"}</p>
      </div>
     </div>
    </>}
    {view==='catalog'&&<>
     <div className="page-heading"><div><div className="eyebrow">EXPLORE MODELS</div><h1>Models <span className="model-count">{modelTotal.toLocaleString()}</span></h1><p>{"按模型、Provider、价格探索 OpenRouter 市场。仅显示实际采集的数据。"}</p></div></div>
     <div className="search-row">
      <div className="search-field"><Search className="search-glyph" size={18} aria-hidden="true"/><TextInput ref={catalogSearch} className="radar-search" aria-label="搜索模型名称或 ID" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(null);}} placeholder="搜索 claude、gpt、deepseek…" /><kbd>/</kbd></div>
      <label className="sort-field"><span>排序</span><Select aria-label="模型排序" value={sort} onChange={value=>{setSort(value||"name");setPage(1);}} data={[{value:"name",label:"名称 A–Z"},{value:"newest",label:"最近更新"},{value:"context",label:"上下文长度"},{value:"price",label:"最低输入价"}]}/></label>
     </div>
     <div className="catalog-grid">
      <aside className="panel filter-panel" aria-label="模型筛选">
       <h3 className="filter-desktop-heading">Filters</h3>
       <button type="button" className="filter-toggle" aria-controls="catalog-filter-contents" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)}><span><SlidersHorizontal size={17} aria-hidden="true"/> 筛选条件 {activeFilterCount>0?<Badge size="sm" variant="light" color="violet">{activeFilterCount}</Badge>:null}</span><ChevronDown size={16} aria-hidden="true" className={filtersOpen?'open':''}/></button>
       <div id="catalog-filter-contents" className={'filter-contents '+(filtersOpen?'is-open':'')}>
       <label htmlFor="provider-filter">Provider</label>
       <Select id="provider-filter" searchable clearable nothingFoundMessage="未找到 Provider" placeholder="所有 Provider" value={providerFilter||null} onChange={v=>{setProviderFilter(v||"");setPage(1);setSelected(null);}} data={providers.map(p=>({value:p.provider,label:p.provider+" · "+p.model_count}))}/>
       <label htmlFor="author-filter">{"模型作者"}</label><TextInput id="author-filter" placeholder="例如 openai" value={authorFilter} onChange={e=>{setAuthorFilter(e.target.value);setPage(1);}}/>
       <label htmlFor="modality-filter">{"输入模态"}</label><Select id="modality-filter" clearable placeholder="全部模态" value={modalityFilter||null} onChange={v=>{setModalityFilter(v||"");setPage(1);}} data={["text","image","audio","video"].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))}/>
       <label htmlFor="capability-filter">{"能力参数"}</label><Select id="capability-filter" clearable placeholder="全部能力" value={capabilityFilter||null} onChange={v=>{setCapabilityFilter(v||"");setPage(1);}} data={[{value:"tools",label:"Tools"},{value:"reasoning",label:"Reasoning"},{value:"response_format",label:"JSON / Structured"}]}/>
       <label htmlFor="min-context">{"最小上下文 Tokens"}</label><NumberInput id="min-context" min={0} step={1024} thousandSeparator="," placeholder="不限" value={minContext} onChange={v=>{setMinContext(String(v));setPage(1);}}/>
       <label htmlFor="max-price">{"最高输入价 USD / 1M Tokens"}</label><NumberInput id="max-price" min={0} step={0.001} decimalScale={6} placeholder="不限" value={maxInput} onChange={v=>{setMaxInput(String(v));setPage(1);}}/>
       <button className="clear-filters" disabled={!providerFilter&&!search&&!authorFilter&&!modalityFilter&&!capabilityFilter&&!minContext&&!maxInput&&sort==='name'} onClick={()=>{setProviderFilter('');setSearch('');setPage(1);setSort('name');setAuthorFilter('');setModalityFilter('');setCapabilityFilter('');setMinContext('');setMaxInput('');}}><RefreshCw size={14} aria-hidden="true"/> 清除筛选</button>
       <div className="filter-divider"/>
       <div className="filter-note"><strong>DATA SOURCE</strong><p>官方元数据 API + 每小时滚动扫描。报价是公开标价，并非实际账单。</p><a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">查看 OpenRouter 原站 <ExternalLink size={12} aria-hidden="true"/></a></div>
       </div>
      </aside>
      <div className="panel models-panel">
       <div className="panel-title"><span>All models <span className="muted">({modelTotal.toLocaleString()})</span></span><span className="muted">USD / 1M tokens</span></div>
       <div className="model-list" aria-busy={modelLoading}>{models.map(m=><div key={m.id} className={'model-item '+(selected?.id===m.id?'chosen':'')}>
        <button className="model-main" aria-pressed={selected?.id===m.id} onClick={()=>void inspect(m)}>
         <span className="model-avatar" aria-hidden="true">{m.id.split('/')[0].slice(0,2).toUpperCase()}</span>
         <span className="model-copy"><strong>{m.name}</strong><small>{m.id}</small><span className="model-extra">{m.context_length?Math.round(m.context_length/1024)+'K ctx':'无上下文限制'} · {m.model_kind==='image'?'图片模型 · ':''}{m.lifecycle_status==='removed'?'已下架 · ':''}{m.provider_count||0} providers</span></span>
         <span className="model-price">{m.lowest_input!==null&&m.lowest_input!==undefined?million(String(m.lowest_input)):'—'}<small>input / M</small></span>
        </button>
        <button className={'compare-add '+(compareIds.includes(m.id)?'selected':'')} onClick={()=>toggleCompare(m.id)} aria-pressed={compareIds.includes(m.id)} aria-label={compareIds.includes(m.id)?'从对比移除 '+m.name:'加入模型对比 '+m.name}>{compareIds.includes(m.id)?<Check size={16}/>:<Plus size={16}/>}</button>
       </div>)}
       {modelLoading&&<div className="empty loading-state" role="status"><Loader size="sm" /> 正在加载模型…</div>}
       {!modelLoading&&!models.length&&<div className="empty">{"没有匹配的模型。清除筛选，或等待下一次采集。"}</div>}</div>
       {compareIds.length>0&&<div className="compare-toolbar"><span>已选 {compareIds.length}/3 个模型</span><button onClick={()=>setCompareIds([])}>清空</button></div>}
       <div className="pager"><Pagination size="sm" withEdges siblings={1} boundaries={1} total={Math.max(1,Math.ceil(modelTotal/30))} value={page} onChange={setPage}/></div>
      </div>
      <div className="panel detail-panel" ref={detailRef}>{selected?<>
       <div className="panel-title"><span>模型详情</span><button className="text-action" onClick={()=>void copyModelLink(selected.id)}><Copy size={14} aria-hidden="true"/> 复制链接</button></div>
       <div className="detail-model-head"><span className="model-avatar">{selected.id.split('/')[0].slice(0,2).toUpperCase()}</span><div><h2>{selected.name}</h2><code className="code-id">{selected.id}</code>{selected.lifecycle_status==='removed'&&<span className="event-tag">已确认下架 · 等待恢复</span>}{selected.model_kind==='image'&&<span className="event-tag">图片生成模型</span>}</div></div>
       <div className="detail-quick-stats">
        <div className="detail-quick-price"><span>{selected.model_kind==='image'?'图片计费':'最低公开输入价'}</span><strong>{selected.model_kind==='image'?'按计费项':lowestInput===null?'—':million(String(lowestInput))}</strong><small>{selected.model_kind==='image'?'单位请参阅报价明细':'USD / 1M tokens · 活跃端点'}</small></div>
        <div><span>Context</span><strong>{selected.context_length?.toLocaleString()||'—'}</strong><small>Tokens</small></div>
        <div><span>Provider 端点</span><strong>{collection?.active_endpoints??'—'}</strong><small>当前活跃</small></div>
       </div>
       <div className={'detail-health '+(collection?.status||'never')} role="status">
        <Badge variant="light" size="sm" color={collection?.status==='fresh'?'teal':collection?.status==='error'?'red':collection?.status==='stale'?'yellow':'gray'}>{collection?.status==='fresh'?'近期采集成功':collection?.status==='error'?'采集失败':collection?.status==='stale'?'可能过期':'尚未成功采集'}</Badge>
        <span>成功于 {collection?.last_success?time(collection.last_success):'暂无'}</span>
        <span>最近尝试 {collection?.last_attempt?time(collection.last_attempt):'暂无'}</span>
        {collection?.last_error&&<p>{collection.last_error} · 已保留有效历史报价</p>}
        {!!collection?.missing_endpoints&&<p>{collection.missing_endpoints} 个历史端点已下线</p>}
       </div>
       {selected.alias_target&&<p className="detail-meta">别名目标：{selected.alias_target}</p>}
       {selected.expiration_date&&<p className="detail-meta">预计到期：{new Date(selected.expiration_date*1000).toLocaleDateString()}</p>}
       <div className="detail-section-head"><h3>Provider 报价</h3><small>{selected.model_kind==='image'?'图片计费单位各异，详见原始规则':'USD / 百万 Token · 最新成功采集'}</small></div>
       <div className="mobile-table-hint">向左滑动查看完整报价与检查时间 <ArrowRight size={14} aria-hidden="true"/></div><div className="scroll-x"><Table className="radar-data-table radar-provider-table" highlightOnHover verticalSpacing="xs" horizontalSpacing="sm"><thead><tr><th scope="col">Provider / 端点</th><th scope="col" className="num">Input</th><th scope="col" className="num">Output</th><th scope="col" className="num">Cache Read</th><th scope="col" className="num">Cache Write</th><th scope="col" className="num">Write 1h</th><th scope="col">检查时间</th></tr></thead><tbody>
        {providerEndpoints.map(ep=><tr key={ep.id}><td><span className="provider-name">{ep.provider}</span><div className="provider-cell-meta"><Badge size="xs" variant="light" color={ep.status==='active'?'teal':'gray'}>{ep.status==='missing'?'已下线':ep.status==='superseded'?'旧端点':'可用'}</Badge><span>{ep.tag||'default'}</span></div></td><td className="num">{ep.pricing_json.includes('image_pricing')?'图片计费':endpointPrice(ep.input_price)}</td><td className="num">{ep.pricing_json.includes('image_pricing')?'参阅规则':endpointPrice(ep.output_price)}</td><td className="num">{extraPrice(ep,'input_cache_read')}</td><td className="num">{extraPrice(ep,'input_cache_write')}</td><td className="num">{extraPrice(ep,'input_cache_write_1h')}</td><td className="time-cell">{ep.checked_at?time(ep.checked_at):'待采集'}</td></tr>)}
       </tbody></Table>{!providerEndpoints.length&&<div className="empty">Provider 数据还在采集队列中，当前暂无有效报价。</div>}</div>
       {endpoints.filter(e=>e.source==='provider').some(e=>e.pricing_json)&&<details className="raw-pricing"><summary>{"查看非 Token 计价、缓存和动态覆盖规则"}</summary>{endpoints.filter(e=>e.source==='provider').map(e=><div key={e.id}><strong>{e.provider} · {e.tag||'default'}</strong><pre>{JSON.stringify(JSON.parse(e.pricing_json||'{}'),null,2)}</pre></div>)}</details>}
       <ProviderPriceStability key={'stability-'+selected.id} modelId={selected.id}/>
       <PriceHistory key={selected.id} modelId={selected.id} image={selected.model_kind==='image'} providers={[...new Set(endpoints.filter(e=>e.source==='provider'&&e.status!=='superseded').map(e=>e.provider))]}/>
       <div className="detail-section-head"><h3>最近变化</h3><small>仅记录基准建立后的实际变化</small></div>
       <div className="model-history">{modelEvents.length?modelEvents.map(ev=><div key={ev.id} className="history-item"><div><span className={'event-tag '+(ev.kind==='price.decreased'?'down':ev.kind==='price.increased'?'up':'neutral')}>{eventTitle(ev.kind,ev.dimension)}</span><strong>{ev.provider}</strong></div><p>{formatEvent(ev)}</p><small>发现于 {time(ev.created_at)}</small></div>):<div className="empty">暂无变化记录。这不表示价格从未变化。</div>}</div>
       <div className="subscribe-box"><div className="subscribe-head"><div><h3>Watch this model</h3><p>只有命中规则时才通知，不影响全站采集。</p></div><span className="light-tag">自定义提醒</span></div>
        <label htmlFor="watch-provider">Provider</label>
        <Select id="watch-provider" searchable clearable placeholder="所有 Provider" value={watchProvider||null} onChange={v=>setWatchProvider(v||"")} data={[...new Set(endpoints.filter(e=>e.source==='provider').map(e=>e.provider))].map(p=>({value:p,label:p}))}/>
        <Select size="xs" searchable clearable label="价格维度（可选）" placeholder="所有价格维度" value={watchDimension||null} onChange={v=>setWatchDimension(v||'')} data={DIMENSION_OPTIONS}/>
        <div className="subscribe-inline"><div><label htmlFor="watch-threshold">最小价格变化 (%)</label><NumberInput id="watch-threshold" min={0} max={1000} decimalScale={2} value={threshold} onChange={v=>setThreshold(Number(v)||0)}/></div>
         <div><label htmlFor="watch-frequency">通知频率</label><Select id="watch-frequency" value={frequency} onChange={v=>setFrequency(v||"instant")} data={[{value:"instant",label:"尽快通知"},{value:"daily",label:"每日摘要 (UTC)"}]}/></div></div>
        <details className="advanced-watch"><summary>提醒事件 · 已选 {kinds.length} 种 <span>修改 <ChevronDown size={13} aria-hidden="true"/></span></summary><div className="checks">{EVENTS.map(([id,text])=><Checkbox key={id} size="xs" label={text} checked={kinds.includes(id)} onChange={e=>{const checked=e.currentTarget.checked;setKinds(a=>checked?[...a,id]:a.filter(k=>k!==id));}}/>)}</div></details>
        <Button className="radar-cta" fullWidth loading={busy} onClick={()=>void addWatch()}>{user?'创建价格监控':'登录后订阅'} <ArrowRight size={15}/></Button>
       </div>
      </>:<div className="selection-empty"><span><Layers size={26}/></span><h3>{"选择一个模型"}</h3><p>{"对比 Provider 报价、查看真实变化、创建监控。"}</p><small>点击左侧模型查看详情</small></div>}</div>
     </div>
     {compareIds.length>=2&&<CompareModels ids={compareIds} onRemove={id=>toggleCompare(id)} onClose={()=>setCompareIds([])}/>}
    </>}
    {view==='events'&&<>
     <div className="page-heading"><div><div className="eyebrow">CHANGELOG</div><h1>Changes <span className="model-count">{eventTotal.toLocaleString()}</span></h1><p>所有变化来自实际快照对比。无模拟行情，发现时间可能晚于变价时间。</p></div><a className="outline-button" href="/feed.xml"><Rss size={16}/> RSS</a></div>
     <div className="events-filters"><div className="search-field"><Search className="search-glyph" size={18} aria-hidden="true"/><TextInput className="radar-search" aria-label="筛选模型或 Provider" placeholder="搜索模型 ID / Provider…" value={eventSearch} onChange={e=>{setEventSearch(e.target.value);setEventPage(1);}}/></div>
      <Select aria-label="事件类型" searchable clearable placeholder="全部事件" value={eventKind||null} onChange={v=>{setEventKind(v||"");setEventPage(1);}} data={EVENTS.map(([value,label])=>({value,label}))}/>
      <Select aria-label="Provider 筛选" searchable clearable placeholder="所有 Provider" value={eventProvider||null} onChange={v=>{setEventProvider(v||"");setEventPage(1);}} data={providers.map(p=>({value:p.provider,label:p.provider}))}/>
     </div>
     <div className="event-export-bar"><label>从 <input aria-label="开始日期" type="date" value={eventStart} onChange={e=>{setEventStart(e.target.value);setEventPage(1);}}/></label>
      <label>到 <input aria-label="结束日期" type="date" value={eventEnd} onChange={e=>{setEventEnd(e.target.value);setEventPage(1);}}/></label>
      <a href={exportUrl('csv')}><Download size={13}/> CSV</a><a href={exportUrl('json')}><Download size={13}/> JSON</a><small>每次导出最多 1,000 条事件</small></div>
     <div aria-busy={loadingEvents}><EventsTable data={events}/></div>
     <div className="pager events-pager"><Pagination size="sm" withEdges siblings={1} boundaries={1} total={Math.max(1,Math.ceil(eventTotal/30))} value={eventPage} onChange={setEventPage}/></div>
    </>}
    {view==='watches'&&<><div className="page-heading"><div><div className="eyebrow">MY WATCHLIST</div><h1>{"我的订阅"}</h1><p>每个账号最多创建 50 条规则，所有用户共享同一份上游采集结果。</p></div><Button className="radar-cta" onClick={()=>setView('catalog')}><Plus size={16}/> 新建订阅</Button></div>
     {!user?<Gate onLogin={()=>setView('account')}/>:<div className="panel">
      {watches.length?<div className="watch-grid">{watches.map(w=><div className={'watch-card '+(w.paused?'is-paused':'')} key={w.id}><div>
       <div className="watch-topline"><span className="light-tag">{w.provider||'所有 Provider'}</span><span className={w.paused?'tag':'light-tag'}>{w.paused?'已暂停':'监控中'}</span></div>
       <h3>{w.name}</h3><code>{w.model_id}</code><p>{JSON.parse(w.events_json).map(label).join(' · ')}</p>
       <small>{w.price_dimension?'维度 '+priceDimensionLabel(w.price_dimension)+' · ':''}阈值 {w.threshold_pct}% · {w.frequency==='daily'?'每日摘要（UTC 08:00）':'尽快通知'}</small>
       <div className="watch-delivery"><span>最近命中：{w.last_hit?time(w.last_hit):'尚无'}</span><span>最近邮件：{w.last_sent?time(w.last_sent):'尚无'}</span>
        <span>发送状态：{w.latest_status||'无通知'}{w.frequency==='daily'&&!w.paused?' · 下一摘要窗口 UTC 08:00':''}</span></div>
       {editingWatch===w.id&&<div className="watch-editor">
        <TextInput label="Provider" value={watchDraft.provider} placeholder="留空表示所有 Provider" onChange={e=>setWatchDraft(v=>({...v,provider:e.target.value}))}/>
        <Select size="xs" searchable clearable label="价格维度（可选）" placeholder="所有价格维度" value={watchDraft.price_dimension||null} data={DIMENSION_OPTIONS} onChange={v=>setWatchDraft(d=>({...d,price_dimension:v||''}))}/>
        <NumberInput label="最小变化百分比" min={0} max={1000} value={watchDraft.threshold_pct} onChange={value=>setWatchDraft(v=>({...v,threshold_pct:Number(value)||0}))}/>
        <Select label="通知节奏" value={watchDraft.frequency} onChange={value=>setWatchDraft(v=>({...v,frequency:value||"instant"}))} data={[{value:"instant",label:"尽快通知"},{value:"daily",label:"每日汇总（UTC）"}]}/>
        <details><summary>提醒事件 · {watchDraft.events.length} 项</summary><div className="checks">{EVENTS.map(([kind,name])=><Checkbox key={kind} size="xs" label={name} checked={watchDraft.events.includes(kind)} onChange={e=>{const checked=e.currentTarget.checked;setWatchDraft(v=>({...v,events:checked?[...v.events,kind]:v.events.filter(k=>k!==kind)}));}}/>)}</div></details>
        <div className="watch-actions"><Button className="radar-cta" loading={busy} onClick={()=>void saveWatch(w.id)}>保存</Button><button onClick={()=>setEditingWatch(null)}>取消</button></div>
       </div>}
      </div><div className="watch-actions">
       <button onClick={()=>editingWatch===w.id?setEditingWatch(null):startEditWatch(w)}>{editingWatch===w.id?'收起编辑':'编辑规则'}</button>
       <button onClick={()=>void togglePaused(w)}>{w.paused?'恢复提醒':'暂停提醒'}</button>
       <button className="delete" onClick={()=>setDeleteWatchId(w.id)}>删除</button>
      </div></div>)}</div>:<div className="empty roomy">还没有任何订阅。进入模型目录，选择你想关注的模型。</div>}</div>}
    </>}
    {view==='notices'&&<><div className="page-heading"><div><div className="eyebrow">YOUR ALERTS</div><h1>{"通知中心"}</h1><p>站内记录每次命中订阅规则的事件，邮件发送状态同步展示。</p></div></div>
     {!user?<Gate onLogin={()=>setView('account')}/>:<div className="panel">{notices.length?notices.map(n=><div className={'notice '+(!n.read_at?'unread':'')} key={n.id}>
      <div><div className="notice-title">{eventTitle(n.kind,n.dimension)} <span className="tag">{n.status==='sent'?'邮件已发':n.status==='failed'?'发送失败':'待发送'}</span></div><strong>{n.model_id}</strong><p>{n.provider} · {formatEvent(n)}</p><small>{time(n.created_at)}</small></div>
      {!n.read_at&&<button className="text-action" onClick={()=>void readNotice(n.id)}>标为已读</button>}
     </div>):<div className="empty roomy">暂时没有通知，模型价格有变化时这里会出现记录。</div>}</div>}
    </>}
    {view==='account'&&<><div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>{"账号与登录"}</h1><p>订阅者只需邮箱和密码，无需填写任何模型 API Key。</p></div></div>
     {user?<><div className="panel auth-panel"><div className="avatar"><UserRound size={30}/></div><h2>{user.email}</h2><p>已登录 · 可以创建价格监控和接收通知</p><button className="outline-button" onClick={()=>void logout()}>{"退出登录"}</button></div></>:
     <div className="panel auth-panel"><h2>{authMode==='register'?'创建免费账号':authMode==='reset'?'设置新密码':authMode==='forgot'?'找回密码':'欢迎回来'}</h2>
     <p>价格数据公开。注册后可订阅变动提醒。</p>
     <form onSubmit={e=>void submitAuth(e)}>
      {authMode!=='reset'&&<><TextInput required label="电子邮箱" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></>}
      {authMode!=='forgot'&&<><TextInput required label="密码（至少 12 个字符）" minLength={12} type="password" autoComplete={authMode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></>}
      <Button className="radar-cta" fullWidth loading={busy} type="submit">{authMode==='register'?'注册并发送验证邮件':authMode==='forgot'?'发送重置邮件':authMode==='reset'?'重置密码':'登录'}</Button>
     </form><div className="auth-actions">
      <button onClick={()=>{setAuthMode(authMode==='register'?'login':'register');setError('');}}> {authMode==='register'?'已有账号？登录':'没有账号？注册'}</button>
      <button onClick={()=>{setAuthMode('forgot');setError('');}}>忘记密码？</button>
      {authMode==='forgot'&&<button onClick={()=>setAuthMode('login')}>返回登录</button>}
     </div></div>}
    </>}
   </div>
  </main>
  <footer className="site-footer" aria-label="网站页脚">
    <div className="site-footer-inner">
     <div className="site-footer-copy">
      <h2>Model prices, <span>under your radar.</span></h2>
      <p>模型和 Provider 的价格、能力与端点变化，全部集中在一个地方。浏览公开数据，订阅你在意的变动。</p>
     </div>
     <a href="https://github.com/zhajiahe/Openrouter_Radar" target="_blank" rel="noreferrer">GitHub <ExternalLink size={13} aria-hidden="true"/></a>
    </div>
  </footer>
 </div>
 <Modal opened={deleteWatchId!==null} onClose={()=>setDeleteWatchId(null)} title="删除订阅规则" centered size="sm">
  <p className="modal-description">删除后将停止匹配和发送这条规则的提醒，此操作不可撤销。</p>
  <div className="modal-actions"><Button variant="default" onClick={()=>setDeleteWatchId(null)}>取消</Button><Button color="red" loading={busy} onClick={()=>{if(deleteWatchId){void removeWatch(deleteWatchId).then(success=>{if(success)setDeleteWatchId(null);});}}}>确认删除</Button></div>
 </Modal>
 </MantineProvider>;
}
function Gate({onLogin}:{onLogin:()=>void}){return <div className="panel empty roomy"><h3>登录后解锁个性化监控</h3><p>新用户能否注册由实例运营者设置。我们不会要求你的 OpenRouter API Key。</p><Button className="radar-cta" onClick={onLogin}>注册 / 登录 →</Button></div>}
function EventsTable({data}:{data:Event[]}){
 return <div className="panel table-panel"><div className="mobile-table-hint">向左滑动查看变动明细与发现时间 <ArrowRight size={14} aria-hidden="true"/></div><div className="scroll-x"><Table className="radar-data-table events-table" highlightOnHover verticalSpacing="xs" horizontalSpacing="sm"><thead><tr><th scope="col">模型 / Provider</th><th scope="col">变化类型</th><th scope="col">变动明细</th><th scope="col">发现时间</th></tr></thead><tbody>
 {data.map(e=><tr key={e.id}><td><strong title={e.model_id}>{e.model_id}</strong><span className="cell-small">{e.provider}</span></td><td><Badge size="sm" variant="light" color={e.kind==='price.decreased'||e.kind==='image.price_decreased'?'teal':e.kind==='price.increased'||e.kind==='image.price_increased'?'red':'gray'}>{eventTitle(e.kind,e.dimension)}</Badge></td><td className="table-description">{formatEvent(e)}</td><td className="time-cell">{time(e.created_at)}</td></tr>)}
 </tbody></Table>{!data.length&&<div className="empty roomy">还没有实际变化事件。首次采集只建立基准。</div>}</div></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

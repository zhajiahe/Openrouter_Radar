import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import './router-inspired.css';
import './monitoring.css';
import {PriceHistory,CompareModels} from './monitoring';

type Model={id:string;name:string;context_length:number|null;updated_at:number;expiration_date?:number|null;alias_target?:string|null;lowest_input?:number|null;provider_count?:number};
type ProviderOption={provider:string;model_count:number};
type Endpoint={id:string;provider:string;tag:string;source:string;input_price:string|null;output_price:string|null;status:string;checked_at:number;pricing_json:string};
type Collection={status:string;last_attempt:number|null;last_success:number|null;last_error:string|null;age_seconds:number|null;active_endpoints:number;missing_endpoints:number};
type Watch={id:string;model_id:string;name:string;provider:string|null;events_json:string;threshold_pct:number;frequency:string;paused:number;last_hit:number|null;last_sent:number|null;latest_status:string|null};
type Event={id:string;model_id:string;provider:string;kind:string;dimension:string|null;old_price:string|null;new_price:string|null;change_pct:number|null;created_at:number};
type Notice=Event&{id:string;status:string;read_at:number|null;sent_at:number|null;created_at:number};
const EVENTS=[
 ['price.decreased','价格下降'],['price.increased','价格上涨'],['endpoint.added','新 Provider'],['endpoint.removed','端点下线'],['endpoint.restored','端点恢复'],['price.policy_changed','定价规则变化'],['model.context_changed','上下文变化'],['model.capability_changed','模型能力变化'],['model.alias_changed','别名目标变化'],['model.expiration_changed','到期日期变化'],['model.expiring','即将到期']
] as const;
const label=(kind:string)=>EVENTS.find(e=>e[0]===kind)?.[1]||kind;
const time=(ts:number)=>new Date(ts*1000).toLocaleString();
const million=(price:string|null)=>price===null?'—':'$'+(Number(price)*1e6).toLocaleString(undefined,{maximumFractionDigits:5});
const endpointPrice=(price:string|null)=>million(price);
const formatEvent=(e:Event):string=>{
 if(e.kind==='model.expiring')return '距离到期最多 '+(e.new_price||'?')+' 天';
 if(e.kind==='price.policy_changed')return (e.dimension||'计价规则')+' 已发生变化';
 if(e.kind.startsWith('model.'))return (e.dimension||'模型属性')+'：'+(e.old_price||'未知').slice(0,90)+' → '+(e.new_price||'未知').slice(0,90);
 if(e.old_price!==null&&e.new_price!==null){
   const token=['input','output','cache_read','cache_write','cache_write_1h'].includes(e.dimension||'');
   const f=(v:string)=>token?million(v):v;
   return (e.dimension||'价格')+': '+f(e.old_price)+' → '+f(e.new_price)+(token?' / 百万 Token':' / 原始计费单位');
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
 const [watchDraft,setWatchDraft]=useState<{provider:string;threshold_pct:number;frequency:string;events:string[]}>({provider:'',threshold_pct:0,frequency:'instant',events:[]});
 const [notices,setNotices]=useState<Notice[]>([]);
 const [search,setSearch]=useState('');
 const [page,setPage]=useState(1);
 const [selected,setSelected]=useState<Model|null>(null);
 const [endpoints,setEndpoints]=useState<Endpoint[]>([]);
 const [collection,setCollection]=useState<Collection|null>(null);
 const [watchProvider,setWatchProvider]=useState('');
 const [threshold,setThreshold]=useState(0);
 const [frequency,setFrequency]=useState('instant');
 const [kinds,setKinds]=useState<string[]>(['price.decreased','price.increased','endpoint.added','endpoint.removed','endpoint.restored']);
 const [status,setStatus]=useState<{status:string;catalog_last_success:number|null;provider_total?:number;provider_scanned?:number;provider_due?:number;provider_errors?:number}>({status:'degraded',catalog_last_success:null});

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
  setModelLoading(true);
  try{
   const params=new URLSearchParams({q,page:String(p),limit:'30',provider,sort:order,author,modality,capability,min_context:context});
   if(maxPrice.trim())params.set('max_input_price',maxPrice);
   const r=await api<{data:Model[];total:number}>('/models?'+params.toString());
   setModels(r.data);setModelTotal(r.total);
  }catch(e){setError((e as Error).message);}finally{setModelLoading(false);}
 }
 async function loadEvents(q:string,kind:string,p:number,provider:string,start:string,end:string){
  setLoadingEvents(true);
  try{
   const params=new URLSearchParams({q,kind,page:String(p),limit:'30',provider});
   if(start)params.set('start',String(Math.floor(new Date(start+'T00:00:00').getTime()/1000)));
   if(end)params.set('end',String(Math.floor(new Date(end+'T23:59:59').getTime()/1000)));
   const r=await api<{data:Event[];total:number}>('/events?'+params.toString());
   setEvents(r.data);setEventTotal(r.total);
  }catch(e){setError((e as Error).message);}finally{setLoadingEvents(false);}
 }
 async function inspect(model:Model){
  setSelected(model);setView('catalog');setWatchProvider('');setThreshold(0);setFrequency('instant');
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
 useEffect(()=>{void loadModels(search,page,providerFilter,sort,authorFilter,modalityFilter,capabilityFilter,minContext,maxInput);},[search,page,providerFilter,sort,authorFilter,modalityFilter,capabilityFilter,minContext,maxInput]);
 useEffect(()=>{void loadEvents(eventSearch,eventKind,eventPage,eventProvider,eventStart,eventEnd);},[eventSearch,eventKind,eventPage,eventProvider,eventStart,eventEnd]);
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
   await api('/subscriptions',{method:'POST',body:JSON.stringify({model_id:selected.id,provider:watchProvider||null,events:kinds,threshold_pct:Number(threshold),frequency})});
   setMessage('订阅创建成功，后续符合条件的变化将通知你。');await loadPrivate();setView('watches');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function startEditWatch(w:Watch){
  setEditingWatch(w.id);
  setWatchDraft({provider:w.provider||'',frequency:w.frequency,threshold_pct:w.threshold_pct,events:JSON.parse(w.events_json) as string[]});
 }
 async function saveWatch(id:string){
  if(!watchDraft.events.length){setError('至少选择一个提醒事件');return;}
  setBusy(true);
  try{
   await api('/subscriptions/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({
    provider:watchDraft.provider||null,frequency:watchDraft.frequency,threshold_pct:watchDraft.threshold_pct,events:watchDraft.events
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
  if(!confirm('确定取消这条监控订阅吗？'))return;
  try{await api('/subscriptions/'+encodeURIComponent(id),{method:'DELETE'});await loadPrivate();}
  catch(e){setError((e as Error).message);}
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
 const titles:Record<string,string>={overview:'Overview',catalog:'Models',events:'Changes',watches:'Watchlist',notices:'Notifications',account:'Account'};
 const scanned=status.provider_scanned??0;
 const total=status.provider_total??stats.models;
 const progress=total>0?Math.min(100,Math.round(scanned/total*100)):0;
 return <div className="layout">
  <aside className="sidebar">
   <div className="brand"><span className="brand-icon" aria-hidden="true">◈</span><span>OpenRouter <b>Radar</b></span></div>
   <div className="side-caption">MODEL MONITORING</div>
   <nav aria-label="主要导航">{[['overview','⌂','概览'],['catalog','▦','Models'],['events','↗','Changes'],['watches','☆','Watchlist'],['notices','◌','通知']] .map(([id,ico,name])=>
    <button key={id} aria-current={view===id?'page':undefined} className={'nav-link '+(view===id?'active':'')} onClick={()=>{setView(id);setError('');if(id!=='catalog')history.replaceState(null,'',location.pathname+location.search);}}>
     <span className="nav-icon">{ico}</span>{name}{id==='notices'&&unread>0?<span className="counter">{unread}</span>:null}
    </button>)}</nav>
   <div className="side-footer"><span className="sidebar-status"><span className="online-dot"/> OPEN SOURCE RADAR</span><p>不需要个人 API Key。<br/>持续收集，按需订阅。</p><a href="https://github.com/zhajiahe/Openrouter_Radar" target="_blank" rel="noreferrer">在 GitHub 查看项目 ↗</a></div>
  </aside>
  <main className="main">
   <header className="topbar">
    <div className="breadcrumb"><span>Radar</span><span className="breadcrumb-separator">/</span><b>{titles[view]}</b></div>
    <div className="topbar-actions">
     <span className={'live-indicator '+(status.status==='ok'?'':'muted-status')} role="status"><span className="online-dot"/>{status.status==='ok'?'同步正常':'同步状态待确认'}</span>
     <button className="account-button" onClick={()=>setView('account')}>{user?user.email:'登录 / 注册'} <span aria-hidden="true">↗</span></button>
    </div>
   </header>
   <div className="content">
    {error&&<div className="toast error" role="alert">{error}<button type="button" aria-label="关闭错误提示" onClick={()=>setError('')}>×</button></div>}
    {message&&<div className="toast success" role="status">{message}<button type="button" aria-label="关闭成功提示" onClick={()=>setMessage('')}>×</button></div>}
    {view==='overview'&&<>
     <div className="hero">
      <div className="hero-copy">
       <div className="eyebrow">OPEN SOURCE · OPENROUTER DATA</div>
       <h1>Model prices,<br/><span className="accent">under your radar.</span></h1>
       <p>模型和 Provider 的价格、能力与端点变化，全部集中在一个地方。浏览公开数据，订阅你在意的变动。</p>
       <div className="hero-actions">
        <button className="primary" onClick={()=>setView('catalog')}>探索模型目录 <span aria-hidden="true">↗</span></button>
        <span className="hero-secondary">每小时采集 · 无需访客 API Key</span>
       </div>
      </div>
      <div className="radar-visual" aria-hidden="true">
       <i className="radar-ring"/><i className="radar-ring"/><i className="radar-ring"/>
       <i className="radar-sweep"/><i className="radar-ping one"/><i className="radar-ping two"/><i className="radar-ping three"/>
       <span className="radar-core">◉</span>
       <span className="hero-radar-label">SIGNAL DETECTION · ACTIVE</span>
      </div>
     </div>
     <div className="metrics">
      {[[stats.models,'模型总数','▦','目录内的公开模型'],[stats.providers,'活跃 Provider','◇','已发现的服务商'],[scanned,'已采集模型','◉','Provider 快照覆盖量'],[stats.events24h,'24小时事件','↗','过去一天的真实变化']].map(([value,labelText,icon,note])=>
       <div className="metric" key={String(labelText)}><div className="metric-label"><span aria-hidden="true">{icon}</span>{labelText}</div><strong>{Number(value).toLocaleString()}</strong><span className="metric-note">{note}</span></div>)}
     </div>
     <div className="section-head"><div><h2>Recent changes</h2><p className="section-heading-sub">仅展示实际发现的变化，不生成模拟数据</p></div><button className="text-action" onClick={()=>setView('events')}>全部事件 ↗</button></div>
     <div className="overview-grid">
      <EventsTable data={recentEvents.slice(0,8)}/>
      <div className="panel scanner-panel">
       <div className="scanner-head"><strong>全量采集进度</strong><span className="scanner-icon" aria-hidden="true">◎</span></div>
       <div className="scanner-stat"><strong>{scanned.toLocaleString()}</strong><span>/ {total.toLocaleString()} 个模型</span></div>
       <div className="scanner-track" role="progressbar" aria-label="Provider 已扫描模型比例" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="scanner-bar" style={{width:progress+'%'}}/></div>
       <div className="scanner-meta"><span>Provider 快照覆盖</span><strong>{progress}%</strong></div>
       <div className="scanner-divider"/>
       <div className="scanner-row"><span>目录同步状态</span><strong className={status.status==='ok'?'good':'warning'}>{status.status==='ok'?'正常':'待确认'}</strong></div>
       <div className="scanner-row"><span>等待扫描</span><strong>{(status.provider_due??0).toLocaleString()} 个</strong></div>
       <div className="scanner-row"><span>上次目录同步</span><strong>{status.catalog_last_success?time(status.catalog_last_success):'暂无'}</strong></div>
       <p className="scanner-footnote">每小时全量同步，按批次抓取 Provider。订阅只影响提醒，不影响采集。</p>
      </div>
     </div>
    </>}
    {view==='catalog'&&<>
     <div className="page-heading"><div><div className="eyebrow">EXPLORE MODELS</div><h1>Models <span className="model-count">{modelTotal.toLocaleString()}</span></h1><p>按模型、Provider、价格探索 OpenRouter 市场。仅显示实际采集的数据。</p></div></div>
     <div className="search-row">
      <div className="search-field"><span aria-hidden="true">⌕</span><input ref={catalogSearch} aria-label="搜索模型名称或 ID" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(null);}} placeholder="Search models, e.g. claude, gpt, deepseek..." /><kbd>/</kbd></div>
      <label className="sort-field"><span>排序</span><select aria-label="模型排序" value={sort} onChange={e=>{setSort(e.target.value);setPage(1);}}><option value="name">名称 A–Z</option><option value="newest">最近更新</option><option value="context">上下文长度</option><option value="price">最低输入价</option></select></label>
     </div>
     <div className="catalog-grid">
      <aside className="panel filter-panel" aria-label="模型筛选">
       <h3>Filters</h3>
       <label htmlFor="provider-filter">Provider</label>
       <select id="provider-filter" value={providerFilter} onChange={e=>{setProviderFilter(e.target.value);setPage(1);setSelected(null);}}>
        <option value="">All providers</option>
        {providers.map(p=><option key={p.provider} value={p.provider}>{p.provider} · {p.model_count}</option>)}
       </select>
       <label htmlFor="author-filter">模型作者</label><input id="author-filter" placeholder="e.g. openai" value={authorFilter} onChange={e=>{setAuthorFilter(e.target.value);setPage(1);}}/>
       <label htmlFor="modality-filter">输入模态</label><select id="modality-filter" value={modalityFilter} onChange={e=>{setModalityFilter(e.target.value);setPage(1);}}><option value="">全部模态</option><option value="text">Text</option><option value="image">Image</option><option value="audio">Audio</option><option value="video">Video</option></select>
       <label htmlFor="capability-filter">能力参数</label><select id="capability-filter" value={capabilityFilter} onChange={e=>{setCapabilityFilter(e.target.value);setPage(1);}}><option value="">全部能力</option><option value="tools">Tools</option><option value="reasoning">Reasoning</option><option value="response_format">JSON / Structured</option></select>
       <label htmlFor="min-context">最小上下文 Tokens</label><input id="min-context" type="number" min="0" step="1024" placeholder="不限" value={minContext} onChange={e=>{setMinContext(e.target.value);setPage(1);}}/>
       <label htmlFor="max-price">最高输入价 USD / 1M Tokens</label><input id="max-price" type="number" min="0" step=".001" placeholder="不限" value={maxInput} onChange={e=>{setMaxInput(e.target.value);setPage(1);}}/>
       <button className="clear-filters" disabled={!providerFilter&&!search&&!authorFilter&&!modalityFilter&&!capabilityFilter&&!minContext&&!maxInput&&sort==='name'} onClick={()=>{setProviderFilter('');setSearch('');setPage(1);setSort('name');setAuthorFilter('');setModalityFilter('');setCapabilityFilter('');setMinContext('');setMaxInput('');}}>清除筛选 ↺</button>
       <div className="filter-divider"/>
       <div className="filter-note"><strong>DATA SOURCE</strong><p>官方元数据 API + 每小时滚动扫描。报价是公开标价，并非实际账单。</p><a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">查看 OpenRouter 原站 ↗</a></div>
      </aside>
      <div className="panel models-panel">
       <div className="panel-title"><span>All models <span className="muted">({modelTotal.toLocaleString()})</span></span><span className="muted">USD / 1M tokens</span></div>
       <div className="model-list" aria-busy={modelLoading}>{models.map(m=><div key={m.id} className={'model-item '+(selected?.id===m.id?'chosen':'')}>
        <button className="model-main" aria-pressed={selected?.id===m.id} onClick={()=>void inspect(m)}>
         <span className="model-avatar" aria-hidden="true">{m.id.split('/')[0].slice(0,2).toUpperCase()}</span>
         <span className="model-copy"><strong>{m.name}</strong><small>{m.id}</small><span className="model-extra">{m.context_length?Math.round(m.context_length/1024)+'K ctx':'Context unknown'} · {m.provider_count||0} providers</span></span>
         <span className="model-price">{m.lowest_input!==null&&m.lowest_input!==undefined?million(String(m.lowest_input)):'—'}<small>input / M</small></span>
        </button>
        <button className={'compare-add '+(compareIds.includes(m.id)?'selected':'')} onClick={()=>toggleCompare(m.id)} aria-pressed={compareIds.includes(m.id)} aria-label={compareIds.includes(m.id)?'从对比移除 '+m.name:'加入模型对比 '+m.name}>{compareIds.includes(m.id)?'✓':'+'}</button>
       </div>)}
       {modelLoading&&<div className="empty" role="status">正在加载模型…</div>}
       {!modelLoading&&!models.length&&<div className="empty">没有匹配的模型。清除筛选，或等待下一次采集。</div>}</div>
       {compareIds.length>0&&<div className="compare-toolbar"><span>已选 {compareIds.length}/3 个模型</span><button onClick={()=>setCompareIds([])}>清空</button></div>}
       <div className="pager"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>← Previous</button><span>{page} / {Math.max(1,Math.ceil(modelTotal/30))}</span><button disabled={page*30>=modelTotal} onClick={()=>setPage(p=>p+1)}>Next →</button></div>
      </div>
      <div className="panel detail-panel">{selected?<>
       <div className="panel-title"><span>MODEL DETAILS</span><button className="text-action" onClick={()=>void copyModelLink(selected.id)}>复制链接 ↗</button></div>
       <div className="detail-model-head"><span className="model-avatar">{selected.id.split('/')[0].slice(0,2).toUpperCase()}</span><div><h2>{selected.name}</h2><code className="code-id">{selected.id}</code></div></div>
       <div className="detail-facts"><span><strong>{selected.context_length?.toLocaleString()||'—'}</strong> Context tokens</span><span><strong>{collection?.active_endpoints??0}</strong> Active endpoints</span></div>
       <div className={'collection-summary '+(collection?.status||'never')} role="status">
        <strong>采集状态：{collection?.status==='fresh'?'近期成功':collection?.status==='error'?'采集失败':collection?.status==='stale'?'数据可能过期':'尚未成功采集'}</strong>
        <span>上次成功：{collection?.last_success?time(collection.last_success):'无'} · 上次尝试：{collection?.last_attempt?time(collection.last_attempt):'无'}</span>
        {collection?.last_error&&<small>{collection.last_error} · 已保留上次有效报价</small>}
        {!!collection?.missing_endpoints&&<small>{collection.missing_endpoints} 个历史端点已标记下线</small>}
       </div>
       {selected.alias_target&&<p className="detail-meta">别名目标：{selected.alias_target}</p>}
       {selected.expiration_date&&<p className="detail-meta">预计到期：{new Date(selected.expiration_date*1000).toLocaleDateString()}</p>}
       <div className="detail-section-head"><h3>Provider pricing</h3><small>USD / 1M tokens · 来自最近一次采集</small></div>
       <div className="scroll-x"><table><thead><tr><th>Provider</th><th>Input</th><th>Output</th><th>检查时间</th></tr></thead><tbody>
        {endpoints.filter(ep=>ep.source==='provider').map(ep=><tr key={ep.id}><td><span className="provider-name">{ep.provider}</span><small className="cell-small">{ep.status==='missing'?'已下线':ep.tag||'Active'}</small></td><td className="num">{endpointPrice(ep.input_price)}</td><td className="num">{endpointPrice(ep.output_price)}</td><td><small>{ep.checked_at?time(ep.checked_at):'待采集'}</small></td></tr>)}
       </tbody></table>{!endpoints.length&&<div className="empty">Provider 数据还在采集队列中，当前暂无有效报价。</div>}</div>
       {endpoints.filter(e=>e.source==='provider').some(e=>e.pricing_json)&&<details className="raw-pricing"><summary>查看非 Token 计价、缓存和动态覆盖规则</summary>{endpoints.filter(e=>e.source==='provider').map(e=><div key={e.id}><strong>{e.provider} · {e.tag||'default'}</strong><pre>{JSON.stringify(JSON.parse(e.pricing_json||'{}'),null,2)}</pre></div>)}</details>}
       <PriceHistory modelId={selected.id} providers={[...new Set(endpoints.filter(e=>e.source==='provider').map(e=>e.provider))]}/>
       <div className="detail-section-head"><h3>Recent changes</h3><small>仅记录首次快照后的实际变化</small></div>
       <div className="model-history">{modelEvents.length?modelEvents.map(ev=><div key={ev.id} className="history-item"><div><span className={'event-tag '+(ev.kind==='price.decreased'?'down':ev.kind==='price.increased'?'up':'neutral')}>{label(ev.kind)}</span><strong>{ev.provider}</strong></div><p>{formatEvent(ev)}</p><small>发现于 {time(ev.created_at)}</small></div>):<div className="empty">暂无变化记录。这不表示价格从未变化。</div>}</div>
       <div className="subscribe-box"><div className="subscribe-head"><div><h3>Watch this model</h3><p>只有命中规则时才通知，不影响全站采集。</p></div><span className="light-tag">自定义提醒</span></div>
        <label htmlFor="watch-provider">Provider</label>
        <select id="watch-provider" value={watchProvider} onChange={e=>setWatchProvider(e.target.value)}><option value="">所有 Provider</option>{[...new Set(endpoints.filter(e=>e.source==='provider').map(e=>e.provider))].map(p=><option key={p} value={p}>{p}</option>)}</select>
        <div className="subscribe-inline"><div><label htmlFor="watch-threshold">最小价格变化 (%)</label><input id="watch-threshold" type="number" min="0" max="1000" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/></div>
         <div><label htmlFor="watch-frequency">通知频率</label><select id="watch-frequency" value={frequency} onChange={e=>setFrequency(e.target.value)}><option value="instant">尽快通知</option><option value="daily">每日摘要 (UTC)</option></select></div></div>
        <details className="advanced-watch"><summary>提醒事件 · 已选 {kinds.length} 种 <span>修改 ↘</span></summary><div className="checks">{EVENTS.map(([id,text])=><label key={id}><input type="checkbox" checked={kinds.includes(id)} onChange={e=>setKinds(a=>e.target.checked?[...a,id]:a.filter(k=>k!==id))}/>{text}</label>)}</div></details>
        <button className="primary full" disabled={busy} onClick={()=>void addWatch()}>{user?'创建价格监控':'登录后订阅'} →</button>
       </div>
      </>:<div className="selection-empty"><span>▧</span><h3>选择一个模型</h3><p>对比 Provider 报价、查看真实变化、创建监控。</p><small>点击左侧模型查看详情</small></div>}</div>
     </div>
     {compareIds.length>=2&&<CompareModels ids={compareIds} onRemove={id=>toggleCompare(id)} onClose={()=>setCompareIds([])}/>}
    </>}
    {view==='events'&&<>
     <div className="page-heading"><div><div className="eyebrow">CHANGELOG</div><h1>Changes <span className="model-count">{eventTotal.toLocaleString()}</span></h1><p>所有变化来自实际快照对比。无模拟行情，发现时间可能晚于变价时间。</p></div><a className="outline-button" href="/feed.xml">RSS ↗</a></div>
     <div className="events-filters"><div className="search-field"><span aria-hidden="true">⌕</span><input aria-label="筛选模型或 Provider" placeholder="搜索模型 ID / Provider…" value={eventSearch} onChange={e=>{setEventSearch(e.target.value);setEventPage(1);}}/></div>
      <select aria-label="事件类型" value={eventKind} onChange={e=>{setEventKind(e.target.value);setEventPage(1);}}><option value="">全部事件</option>{EVENTS.map(([id,text])=><option key={id} value={id}>{text}</option>)}</select>
      <select aria-label="Provider 筛选" value={eventProvider} onChange={e=>{setEventProvider(e.target.value);setEventPage(1);}}><option value="">所有 Provider</option>{providers.map(p=><option key={p.provider} value={p.provider}>{p.provider}</option>)}</select>
     </div>
     <div className="event-export-bar"><label>从 <input aria-label="开始日期" type="date" value={eventStart} onChange={e=>{setEventStart(e.target.value);setEventPage(1);}}/></label>
      <label>到 <input aria-label="结束日期" type="date" value={eventEnd} onChange={e=>{setEventEnd(e.target.value);setEventPage(1);}}/></label>
      <a href={exportUrl('csv')}>CSV ↧</a><a href={exportUrl('json')}>JSON ↧</a><small>每次导出最多 1,000 条事件</small></div>
     <div aria-busy={loadingEvents}><EventsTable data={events}/></div>
     <div className="pager events-pager"><button disabled={eventPage<=1} onClick={()=>setEventPage(p=>p-1)}>← Previous</button><span>{eventPage} / {Math.max(1,Math.ceil(eventTotal/30))}</span><button disabled={eventPage*30>=eventTotal} onClick={()=>setEventPage(p=>p+1)}>Next →</button></div>
    </>}
    {view==='watches'&&<><div className="page-heading"><div><div className="eyebrow">MY WATCHLIST</div><h1>我的订阅</h1><p>每个账号最多创建 50 条规则，所有用户共享同一份上游采集结果。</p></div><button className="primary" onClick={()=>setView('catalog')}>+ 新建订阅</button></div>
     {!user?<Gate onLogin={()=>setView('account')}/>:<div className="panel">
      {watches.length?<div className="watch-grid">{watches.map(w=><div className="watch-card" key={w.id}><div><span className="light-tag">{w.provider||'所有 Provider'}</span><h3>{w.name}</h3><code>{w.model_id}</code><p>{JSON.parse(w.events_json).map(label).join(' · ')}</p><small>阈值 {w.threshold_pct}% · {w.frequency==='daily'?'每日摘要':'即时通知'}</small></div><button className="delete" onClick={()=>void removeWatch(w.id)}>取消订阅</button></div>)}</div>:<div className="empty roomy">还没有任何订阅。进入模型目录，选择你想关注的模型。</div>}</div>}
    </>}
    {view==='notices'&&<><div className="page-heading"><div><div className="eyebrow">YOUR ALERTS</div><h1>通知中心</h1><p>站内记录每次命中订阅规则的事件，邮件发送状态同步展示。</p></div></div>
     {!user?<Gate onLogin={()=>setView('account')}/>:<div className="panel">{notices.length?notices.map(n=><div className={'notice '+(!n.read_at?'unread':'')} key={n.id}>
      <div><div className="notice-title">{label(n.kind)} <span className="tag">{n.status==='sent'?'邮件已发':n.status==='failed'?'发送失败':'待发送'}</span></div><strong>{n.model_id}</strong><p>{n.provider} · {formatEvent(n)}</p><small>{time(n.created_at)}</small></div>
      {!n.read_at&&<button className="text-action" onClick={()=>void readNotice(n.id)}>标为已读</button>}
     </div>):<div className="empty roomy">暂时没有通知，模型价格有变化时这里会出现记录。</div>}</div>}
    </>}
    {view==='account'&&<><div className="page-heading"><div><div className="eyebrow">YOUR ACCOUNT</div><h1>账号与登录</h1><p>订阅者只需邮箱和密码，无需填写任何模型 API Key。</p></div></div>
     {user?<div className="panel auth-panel"><div className="avatar">◎</div><h2>{user.email}</h2><p>已登录 · 可以创建价格监控和接收通知</p><button className="outline-button" onClick={()=>void logout()}>退出登录</button></div>:
     <div className="panel auth-panel"><h2>{authMode==='register'?'创建免费账号':authMode==='reset'?'设置新密码':authMode==='forgot'?'找回密码':'欢迎回来'}</h2>
     <p>价格数据公开。注册后可订阅变动提醒。</p>
     <form onSubmit={e=>void submitAuth(e)}>
      {authMode!=='reset'&&<><label>电子邮箱</label><input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></>}
      {authMode!=='forgot'&&<><label>密码（至少 12 个字符）</label><input required minLength={12} type="password" autoComplete={authMode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></>}
      <button disabled={busy} className="primary full" type="submit">{busy?'处理中…':authMode==='register'?'注册并发送验证邮件':authMode==='forgot'?'发送重置邮件':authMode==='reset'?'重置密码':'登录'}</button>
     </form><div className="auth-actions">
      <button onClick={()=>{setAuthMode(authMode==='register'?'login':'register');setError('');}}> {authMode==='register'?'已有账号？登录':'没有账号？注册'}</button>
      <button onClick={()=>{setAuthMode('forgot');setError('');}}>忘记密码？</button>
      {authMode==='forgot'&&<button onClick={()=>setAuthMode('login')}>返回登录</button>}
     </div></div>}
    </>}
   </div>
  </main>
 </div>;
}
function Gate({onLogin}:{onLogin:()=>void}){return <div className="panel empty roomy"><h3>登录后解锁个性化监控</h3><p>新用户能否注册由实例运营者设置。我们不会要求你的 OpenRouter API Key。</p><button className="primary" onClick={onLogin}>注册 / 登录 →</button></div>}
function EventsTable({data}:{data:Event[]}){
 return <div className="panel table-panel"><div className="scroll-x"><table className="events-table"><thead><tr><th>模型 / Provider</th><th>事件</th><th>变化</th><th>发现时间</th></tr></thead><tbody>
 {data.map(e=><tr key={e.id}><td><strong>{e.model_id}</strong><small className="cell-small">{e.provider}</small></td><td><span className={'event-tag '+(e.kind==='price.decreased'?'down':e.kind==='price.increased'?'up':'neutral')}>{label(e.kind)}</span></td><td><span>{formatEvent(e)}</span></td><td><small>{time(e.created_at)}</small></td></tr>)}
 </tbody></table>{!data.length&&<div className="empty roomy">还没有价格变化事件。完成首次采集后，系统只记录后续真实变化。</div>}</div></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

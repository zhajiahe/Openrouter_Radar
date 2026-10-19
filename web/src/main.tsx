import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

type Model={id:string;name:string;context_length:number|null;updated_at:number;expiration_date?:number|null;alias_target?:string|null};
type Endpoint={id:string;provider:string;tag:string;source:string;input_price:string|null;output_price:string|null;status:string;checked_at:number};
type Watch={id:string;model_id:string;name:string;provider:string|null;events_json:string;threshold_pct:number;frequency:string};
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
 const [events,setEvents]=useState<Event[]>([]);
 const [watches,setWatches]=useState<Watch[]>([]);
 const [notices,setNotices]=useState<Notice[]>([]);
 const [search,setSearch]=useState('');
 const [page,setPage]=useState(1);
 const [selected,setSelected]=useState<Model|null>(null);
 const [endpoints,setEndpoints]=useState<Endpoint[]>([]);
 const [watchProvider,setWatchProvider]=useState('');
 const [threshold,setThreshold]=useState(0);
 const [frequency,setFrequency]=useState('instant');
 const [kinds,setKinds]=useState<string[]>(['price.decreased','price.increased','endpoint.added','endpoint.removed','endpoint.restored']);
 const [status,setStatus]=useState<{status:string;catalog_last_success:number|null}>({status:'degraded',catalog_last_success:null});

 async function loadPublic(){
  const results=await Promise.allSettled([api<typeof stats>('/stats'),api<{data:Event[]}>('/events?limit=40'),api<typeof status>('/health')]);
  if(results[0].status==='fulfilled')setStats(results[0].value);
  if(results[1].status==='fulfilled')setEvents(results[1].value.data);
  if(results[2].status==='fulfilled')setStatus(results[2].value);
 }
 async function loadPrivate(){
  const results=await Promise.allSettled([api<{data:Watch[]}>('/subscriptions'),api<{data:Notice[]}>('/notifications')]);
  if(results[0].status==='fulfilled')setWatches(results[0].value.data);
  if(results[1].status==='fulfilled')setNotices(results[1].value.data);
 }
 async function loadModels(q:string,p:number){
  try{const r=await api<{data:Model[]}>('/models?q='+encodeURIComponent(q)+'&page='+p+'&limit=30');setModels(r.data);}
  catch(e){setError(String(e));}
 }
 async function inspect(model:Model){
  setSelected(model);setView('catalog');setWatchProvider('');setThreshold(0);setFrequency('instant');
  try{const r=await api<{endpoints:Endpoint[]}>('/model?id='+encodeURIComponent(model.id));setEndpoints(r.endpoints);}catch(e){setError(String(e));}
 }
 useEffect(()=>{
  const params=new URLSearchParams(location.search);
  if(params.has('verified'))setMessage('邮箱验证成功，请登录。');
  if(params.has('reset'))setAuthMode('reset');
  api<{user:{id:string;email:string}}>('/auth/me').then(r=>{setUser(r.user);}).catch(()=>{});
  void loadPublic();
 },[]);
 useEffect(()=>{if(user)void loadPrivate();},[user]);
 useEffect(()=>{void loadModels(search,page);},[search,page]);
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
   setMessage('订阅创建成功，后续采集将自动通知变价事件。');await loadPrivate();setView('watches');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
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
 async function logout(){await api('/auth/logout',{method:'POST'});setUser(null);setWatches([]);setNotices([]);setView('overview');}
 const unread=notices.filter(n=>!n.read_at).length;
 const titles:Record<string,string>={overview:'市场总览',catalog:'模型目录',events:'价格动态',watches:'我的订阅',notices:'通知中心',account:'账号'};
 return <div className="layout">
  <aside className="sidebar">
   <div className="brand"><span className="brand-icon">◎</span><span>OR <b>Radar</b></span></div>
   <div className="side-caption">MARKET INTELLIGENCE</div>
   <nav aria-label="主要导航">{[['overview','◫','市场总览'],['catalog','▦','模型目录'],['events','↗','价格动态'],['watches','◉','我的订阅'],['notices','♧','通知中心']] .map(([id,ico,name])=>
    <button key={id} aria-current={view===id?'page':undefined} className={'nav-link '+(view===id?'active':'')} onClick={()=>{setView(id);setSelected(null);setError('');}}>
     <span className="nav-icon">{ico}</span>{name}{id==='notices'&&unread>0?<span className="counter">{unread}</span>:null}
    </button>)}</nav>
   <div className="side-footer"><span className="online-dot"/> Powered by Cloudflare Workers <a href="https://github.com/zhajiahe/Openrouter_Radar" target="_blank" rel="noreferrer">GitHub ↗</a></div>
  </aside>
  <main className="main">
   <header className="topbar"><div className="breadcrumb"><span>OpenRouter Radar</span><span className="muted">/</span><b>{titles[view]}</b></div>
    <button className="account-button" onClick={()=>setView('account')}>{user?user.email:'注册 / 登录'}</button>
   </header>
   <div className="content">
    {error&&<div className="toast error" role="alert">{error}<button type="button" aria-label="关闭错误提示" onClick={()=>setError('')}>×</button></div>}
    {message&&<div className="toast success" role="status">{message}<button type="button" aria-label="关闭成功提示" onClick={()=>setMessage('')}>×</button></div>}
    {view==='overview'&&<>
     <div className="hero"><div className="eyebrow">YOUR MODEL MARKET WATCHTOWER</div><h1>洞察每一次模型价格变化<span className="accent">.</span></h1><p>追踪 OpenRouter 模型与 Provider 端点价格，订阅变化，收到邮件和站内通知。无需用户 API Key。</p><button className="primary" onClick={()=>setView('catalog')}>开始监控 <span>→</span></button></div>
     <div className="metrics">
      {[[stats.models,'模型总数','▦'],[stats.providers,'已采集 Provider','◈'],[stats.subscriptions,'全站订阅','◉'],[stats.events24h,'24小时事件','↗']].map(([value,labelText,icon])=>
       <div className="metric" key={String(labelText)}><div className="metric-label"><span>{icon}</span>{labelText}</div><strong>{Number(value).toLocaleString()}</strong></div>)}
     </div>
     <div className="section-head"><h2>最近价格动态</h2><button className="text-action" onClick={()=>setView('events')}>查看全部 →</button></div>
     <EventsTable data={events.slice(0,8)}/>
     <div className="hint" role="status">数据状态：<span className={status.status==='ok'?'good':'warning'}>{status.status==='ok'?'运行正常':'等待首次同步 / 数据过期'}</span> · 最近目录同步 {status.catalog_last_success?time(status.catalog_last_success):'尚未执行'}</div>
    </>}
    {view==='catalog'&&<>
     <div className="page-heading"><div><div className="eyebrow">MODEL CATALOG</div><h1>模型目录</h1><p>选择模型，查看不同 Provider 的当前报价，并创建通知订阅。</p></div></div>
     <div className="search-row"><input aria-label="搜索模型名称或 ID" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(null);}} placeholder="搜索模型名称或 ID，例如 deepseek..." /><button onClick={()=>{void loadModels(search,page);}}>搜索</button></div>
     <div className="catalog-grid">
      <div className="panel models-panel">
       <div className="panel-title">模型 <span className="muted">({models.length} / 页)</span></div>
       <div className="model-list">{models.map(m=><button key={m.id} className={'model-item '+(selected?.id===m.id?'chosen':'')} onClick={()=>void inspect(m)}>
        <strong>{m.name}</strong><small>{m.id}</small></button>)}
       {!models.length&&<div className="empty">还没有模型数据。首次部署后等待 Cron 完成目录同步。</div>}</div>
       <div className="pager"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>← 上一页</button><span>第 {page} 页</span><button disabled={models.length<30} onClick={()=>setPage(p=>p+1)}>下一页 →</button></div>
      </div>
      <div className="panel detail-panel">{selected?<>
       <div className="panel-title"><span>模型详情</span><span className="light-tag">实时采集快照</span></div>
       <h2>{selected.name}</h2><code className="code-id">{selected.id}</code>
       <p className="muted">上下文 {selected.context_length?.toLocaleString()||'未知'} tokens{selected.alias_target?' · 别名指向 '+selected.alias_target:''}{selected.expiration_date?' · 到期 '+new Date(selected.expiration_date*1000).toLocaleDateString():''}</p>
       <h3>Provider Endpoint</h3>
       <div className="scroll-x"><table><thead><tr><th>Provider</th><th>输入 $/M</th><th>输出 $/M</th><th>采集时间</th></tr></thead><tbody>
        {endpoints.map(ep=><tr key={ep.id}><td><span className="provider-name">{ep.provider}</span><small className="cell-small">{ep.status==='missing'?'已下线':ep.tag}</small></td><td>{endpointPrice(ep.input_price)}</td><td>{endpointPrice(ep.output_price)}</td><td><small>{time(ep.checked_at)}</small></td></tr>)}
       </tbody></table>{!endpoints.length&&<div className="empty">还没有端点快照。创建订阅后下一次采集将更新。</div>}</div>
       <div className="subscribe-box"><h3>创建监控订阅</h3><label>Provider 范围</label>
        <select value={watchProvider} onChange={e=>setWatchProvider(e.target.value)}><option value="">所有 Provider</option>{[...new Set(endpoints.filter(e=>e.source==='provider').map(e=>e.provider))].map(p=><option key={p} value={p}>{p}</option>)}</select>
        <label>提醒事件</label><div className="checks">{EVENTS.map(([id,text])=><label key={id}><input type="checkbox" checked={kinds.includes(id)} onChange={e=>setKinds(a=>e.target.checked?[...a,id]:a.filter(k=>k!==id))}/>{text}</label>)}</div>
        <label>价格变化阈值（%）</label><input type="number" min="0" max="1000" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/>
        <label>通知节奏</label><select value={frequency} onChange={e=>setFrequency(e.target.value)}><option value="instant">变化后尽快发送</option><option value="daily">每日 08:00 UTC 汇总</option></select>
        <button className="primary full" disabled={busy} onClick={()=>void addWatch()}>{user?'创建订阅':'登录后创建订阅'} →</button>
        <small className="muted">首次抓取建立基准，不将初始价格误报为降价。</small>
       </div>
      </>:<div className="selection-empty"><span>◎</span><h3>选中一个模型</h3><p>查看报价、端点及监控选项</p></div>}</div>
     </div>
    </>}
    {view==='events'&&<><div className="page-heading"><div><div className="eyebrow">LIVE EVENT HISTORY</div><h1>价格动态</h1><p>记录实际采集发现的变化，不虚构历史。对外支持 RSS 订阅。</p></div><a className="outline-button" href="/feed.xml">RSS 订阅 ↗</a></div><EventsTable data={events}/></>}
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
 return <div className="panel"><div className="scroll-x"><table className="events-table"><thead><tr><th>模型 / Provider</th><th>事件</th><th>变化</th><th>发现时间</th></tr></thead><tbody>
 {data.map(e=><tr key={e.id}><td><strong>{e.model_id}</strong><small className="cell-small">{e.provider}</small></td><td><span className={'event-tag '+(e.kind==='price.decreased'?'down':e.kind==='price.increased'?'up':'neutral')}>{label(e.kind)}</span></td><td><span>{formatEvent(e)}</span></td><td><small>{time(e.created_at)}</small></td></tr>)}
 </tbody></table>{!data.length&&<div className="empty roomy">还没有价格变化事件。完成首次采集后，系统只记录后续真实变化。</div>}</div></div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

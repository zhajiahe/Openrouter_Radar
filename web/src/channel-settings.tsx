import React,{useEffect,useState} from 'react';
type Channels={
 available:{telegram:boolean;webhook:boolean};
 telegram:{enabled:boolean;chat_id:string|null;awaiting_confirmation:boolean};
 webhook:{enabled:boolean;host:string|null};
};
export function ChannelSettings(){
 const [settings,setSettings]=useState<Channels|null>(null);
 const [chatId,setChatId]=useState('');
 const [code,setCode]=useState('');
 const [url,setUrl]=useState('');
 const [secret,setSecret]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 async function load(){
  const r=await fetch('/api/channels/',{credentials:'same-origin'});
  if(!r.ok)throw new Error('Unable to load channels');
  setSettings(await r.json() as Channels);
 }
 useEffect(()=>{void load().catch(e=>setError(String(e)));},[]);
 async function mutate(route:string,method:'POST'|'DELETE',payload?:Record<string,string>){
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/channels/'+route,{method,credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});
   const json=await response.json() as {error?:string;secret?:string;verification_sent?:boolean;enabled?:boolean};
   if(!response.ok)throw new Error(json.error||'Request failed');
   if(json.secret)setSecret(json.secret);else setSecret('');
   setNotice(json.verification_sent?'验证码已通过 Telegram 发送，有效期 10 分钟。':json.enabled===false?'渠道已关闭':'保存成功');
   await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="panel channel-settings" aria-label="通知渠道设置">
  <h2>通知渠道 / Notification channels</h2>
  <p>邮件与站内提醒继续有效。以下渠道是可选项，只有部署者启用后才能设置。</p>
  {error&&<p role="alert" className="channel-error">{error}</p>}
  {notice&&<p role="status" className="channel-success">{notice}</p>}
  <div className="channel-section">
   <div className="channel-heading"><h3>Telegram</h3><span>{settings?.telegram.enabled?'已验证':settings?.available.telegram?'未启用':'部署者未配置'}</span></div>
   <p>先与部署者的 Radar Telegram Bot 开始聊天，获取 Chat ID，然后通过机器人收到的验证码绑定。</p>
   {settings?.telegram.enabled?<div className="channel-actions"><span>已连接 Chat ID：{settings.telegram.chat_id}</span><button disabled={busy} onClick={()=>void mutate('telegram','DELETE')}>解除绑定</button></div>:settings?.available.telegram&&<>
    <label>Chat ID <input inputMode="numeric" placeholder="例如 123456789" value={chatId} onChange={e=>setChatId(e.target.value)} /></label>
    <button disabled={busy||!chatId.trim()} onClick={()=>void mutate('telegram/start','POST',{chat_id:chatId.trim()})}>发送验证消息</button>
    {settings.telegram.awaiting_confirmation&&<div className="channel-verification"><label>Telegram 验证码 <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></label>
     <button disabled={busy||code.length!==6} onClick={()=>void mutate('telegram/confirm','POST',{code})}>确认绑定</button></div>}
   </>}
  </div>
  <div className="channel-section">
   <div className="channel-heading"><h3>Signed Webhook</h3><span>{settings?.webhook.enabled?'已启用':settings?.available.webhook?'未启用':'部署者未设置域名白名单'}</span></div>
   <p>仅支持运营者允许的 HTTPS 主机。Webhook 按订阅规则命中时发送，并携带 X-Radar-Delivery 与 HMAC-SHA256 签名。接收端须用 Delivery ID 去重。</p>
   {settings?.webhook.enabled&&<p>当前主机：{settings.webhook.host}（完整 URL 不再回显）</p>}
   {settings?.available.webhook&&<><label>Webhook HTTPS URL <input type="url" placeholder="https://allowed.example.com/radar" value={url} onChange={e=>setUrl(e.target.value)}/></label>
    <div className="channel-actions"><button disabled={busy||!url} onClick={()=>void mutate('webhook','POST',{url})}>{settings.webhook.enabled?'更新 URL 并轮换签名密钥':'启用 Webhook'}</button>
     {settings.webhook.enabled&&<button disabled={busy} onClick={()=>void mutate('webhook','DELETE')}>关闭 Webhook</button>}</div></>}
   {secret&&<div className="channel-secret" role="status"><strong>签名密钥（仅显示一次）</strong><code>{secret}</code><button onClick={()=>void navigator.clipboard?.writeText(secret)}>复制密钥</button></div>}
  </div>
 </section>;
}

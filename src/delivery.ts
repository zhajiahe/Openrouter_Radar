import { sendEmail } from './email';
import { now, type Bindings } from './types';
import {eventTitle,priceDimensionLabel} from './event-labels';

type Pending={id:string;user_id:string;email:string;frequency:string;subscription_id:string;endpoint_id:string;snapshot_id:string|null;model_id:string;provider:string;kind:string;dimension:string|null;old_price:string|null;new_price:string|null;change_pct:number|null;created_at:number;event_id:string};
export function deliveryGroupKey(item:Pending):string{
 return item.frequency==='daily'?item.user_id+':daily':
  [item.user_id,'instant',item.subscription_id,item.endpoint_id,item.snapshot_id??item.id].join(':');
}
export function notificationText(rows:Pending[],origin:string):string{
 const lines=['OpenRouter Radar · 模型与 Provider 监控通知','',
  ...rows.map(r=>{
   const isPrice=['price.increased','price.decreased','image.price_increased','image.price_decreased'].includes(r.kind);
   const detail=isPrice&&r.old_price!==null&&r.new_price!==null
    ? ' · '+priceDimensionLabel(r.dimension)+': '+r.old_price+' → '+r.new_price+'（请以对应计费维度的原始单位核对报价）'
    :r.kind==='model.expiring'?' · 上游标注预计在 '+(r.new_price||'?')+' 天窗口内到期'
    :r.dimension?' · '+r.dimension+': '+(r.old_price||'未知').slice(0,100)+' → '+(r.new_price||'未知').slice(0,100):'';
   return '• '+r.model_id+' / '+r.provider+' — '+eventTitle(r.kind,r.dimension)+detail;
  }), '', '查看或管理订阅：'+new URL('/',origin).toString(),
  '你收到此邮件是因为订阅了 Radar 的模型监控事件。'];
 return lines.join('\n');
}
export async function deliverPending(env:Bindings):Promise<number>{
 if(!env.RESEND_API_KEY || !env.MAIL_FROM)return 0;
 const clock=now();
 // Recover jobs whose previous worker invocation crashed while delivering.
 const pending=await env.DB.prepare("SELECT n.id,n.user_id,u.email,s.frequency,n.subscription_id,e.endpoint_id,e.snapshot_id,e.model_id,e.provider,e.kind,e.dimension,e.old_price,e.new_price,e.change_pct,e.created_at,e.id AS event_id FROM notifications n JOIN users u ON u.id=n.user_id JOIN price_events e ON e.id=n.event_id JOIN subscriptions s ON s.id=n.subscription_id WHERE n.status IN ('pending','sending') AND n.next_attempt_at<=? AND n.attempts<5 AND u.email_verified=1 AND s.paused=0 ORDER BY n.created_at LIMIT 100").bind(clock).all<Pending>();
 const claimed:Pending[]=[];
 for(const item of pending.results){
  const update=await env.DB.prepare("UPDATE notifications SET status='sending',next_attempt_at=? WHERE id=? AND status IN ('pending','sending') AND next_attempt_at<=?").bind(clock+180,item.id,clock).run();
  if(update.meta.changes)claimed.push(item);
 }
 const groups=new Map<string,Pending[]>();
 for(const item of claimed){
  const key=deliveryGroupKey(item);
  groups.set(key,[...(groups.get(key)||[]),item]);
 }
 let count=0;
 for(const rows of [...groups.values()].slice(0,20)){
  const subject=rows.length===1?'[Radar] '+rows[0].model_id+'：'+eventTitle(rows[0].kind,rows[0].dimension):'[Radar] '+rows[0].model_id+' 等 '+rows.length+' 项监控变化';
  // Stable across the same send attempt even when a worker retries.
  const ids=rows.map(x=>x.id).sort().join(',');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ids));
  const key='radar-'+Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,'0')).join('');
  try{
   await sendEmail(env,rows[0].email,subject,notificationText(rows,env.APP_ORIGIN),key);
   for(const item of rows){
    await env.DB.prepare("UPDATE notifications SET status='sent',sent_at=?,last_error=NULL WHERE id=? AND status='sending'").bind(now(),item.id).run();
   }
   count+=rows.length;
  }catch(error){
   const info=String(error).match(/Resend HTTP \d{3}/)?.[0]||'Delivery failed';
   for(const item of rows){
    const attempts=await env.DB.prepare('SELECT attempts FROM notifications WHERE id=?').bind(item.id).first<{attempts:number}>();
    const next=(attempts?.attempts||0)+1;
    await env.DB.prepare("UPDATE notifications SET attempts=?,next_attempt_at=?,status=?,last_error=? WHERE id=? AND status='sending'")
     .bind(next,now()+Math.min(3600,60*2**next),next>=5?'failed':'pending',info,item.id).run();
   }
  }
 }
 // Release claimed notifications not sent because of per-alarm group cap.
 const sentIds=new Set([...groups.values()].slice(0,20).flatMap(group=>group.map(item=>item.id)));
 for(const item of claimed)if(!sentIds.has(item.id)){
  await env.DB.prepare("UPDATE notifications SET status='pending',next_attempt_at=? WHERE id=? AND status='sending'").bind(now(),item.id).run();
 }
 return count;
}

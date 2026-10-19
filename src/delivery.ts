import { sendEmail } from './email';
import { now, type Bindings } from './types';

type Pending={id:string;user_id:string;email:string;frequency:string;model_id:string;provider:string;kind:string;dimension:string|null;old_price:string|null;new_price:string|null;change_pct:number|null;created_at:number;event_id:string};
export function notificationText(rows:Pending[],origin:string):string{
 const lines=['OpenRouter Radar · price and endpoint updates','',...rows.map(r=>{
  const change=r.old_price!==null&&r.new_price!==null
   ? ` · ${r.dimension}: ${r.old_price} → ${r.new_price} USD/token` : '';
  return `• ${r.model_id} / ${r.provider} — ${r.kind}${change}`;
 }), '', 'Manage alerts: '+new URL('/',origin).toString(),'You receive this email because you subscribed to Radar monitoring.'];
 return lines.join('\n');
}
export async function deliverPending(env:Bindings):Promise<number>{
 if(!env.RESEND_API_KEY || !env.MAIL_FROM)return 0;
 const pending=await env.DB.prepare(`SELECT n.id,n.user_id,u.email,s.frequency,e.model_id,e.provider,
  e.kind,e.dimension,e.old_price,e.new_price,e.change_pct,e.created_at,e.id AS event_id
  FROM notifications n JOIN users u ON u.id=n.user_id JOIN price_events e ON e.id=n.event_id
  JOIN subscriptions s ON s.id=n.subscription_id
  WHERE n.status='pending' AND n.next_attempt_at<=? AND n.attempts<5 AND u.email_verified=1
  ORDER BY n.created_at LIMIT 100`).bind(now()).all<Pending>();
 const groups=new Map<string,Pending[]>();
 for(const item of pending.results) {
  const key=item.user_id+':'+(item.frequency==='daily'?'daily':item.id);
  groups.set(key,[...(groups.get(key)||[]),item]);
 }
 let count=0;
 for(const rows of [...groups.values()].slice(0,20)){
  const subject=rows.length===1 ? `[Radar] ${rows[0].model_id}: ${rows[0].kind}` : `[Radar] ${rows.length} new monitoring events`;
  try{
   await sendEmail(env,rows[0].email,subject,notificationText(rows,env.APP_ORIGIN));
   for(const item of rows)await env.DB.prepare("UPDATE notifications SET status='sent',sent_at=? WHERE id=? AND status='pending'").bind(now(),item.id).run();
   count+=rows.length;
  }catch{
   for(const item of rows){
    const current=await env.DB.prepare('SELECT attempts FROM notifications WHERE id=?').bind(item.id).first<{attempts:number}>();
    const attempts=(current?.attempts||0)+1;
    await env.DB.prepare('UPDATE notifications SET attempts=?,next_attempt_at=?,status=? WHERE id=?')
     .bind(attempts,now()+Math.min(3600,60*2**attempts),attempts>=5?'failed':'pending',item.id).run();
   }
  }
 }
 return count;
}

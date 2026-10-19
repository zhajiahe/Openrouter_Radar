import type { Bindings } from './types';
export async function sendEmail(env:Bindings, to:string, subject:string, text:string):Promise<void>{
 if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('Mail delivery unavailable: configure RESEND_API_KEY and MAIL_FROM');
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,text}),
  signal:AbortSignal.timeout(12_000)
 });
 if(!response.ok) throw new Error('Resend HTTP '+response.status);
}

export function token():string {
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function sha256(data:string):Promise<string>{
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function hashPassword(password:string):Promise<string>{
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},key,256);
 return 'pbkdf2_sha256$150000$'+toHex(salt)+'$'+toHex(new Uint8Array(bits));
}
function toHex(bytes:Uint8Array):string{return Array.from(bytes).map(x=>x.toString(16).padStart(2,'0')).join('');}
function fromHex(hex:string):Uint8Array{return new Uint8Array(hex.match(/../g)?.map(x=>parseInt(x,16))||[]);}
export async function verifyPassword(password:string, stored:string):Promise<boolean>{
 const parts=stored.split('$');
 if(parts.length!==4 || parts[0]!=='pbkdf2_sha256'||parts[1]!=='150000'||!/^[0-9a-f]{32}$/.test(parts[2])||!/^[0-9a-f]{64}$/.test(parts[3])) return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new Uint8Array(fromHex(parts[2])),iterations:150000,hash:'SHA-256'},key,256));
 const expected=fromHex(parts[3]);let diff=0;for(let i=0;i<32;i++)diff|=bits[i]^expected[i];return diff===0;
}

import type {Page,Route} from '@playwright/test';

const now=Math.floor(Date.parse('2026-10-20T12:00:00Z')/1000);
export const MODEL_ID='openai/gpt-5.6-extra-long-model-identifier-for-responsive-layout-verification';
export const IMAGE_ID='studio/image-generation-model';
const models=[
 {id:MODEL_ID,name:'GPT 5.6 Extended Context Benchmark Model',context_length:262144,updated_at:now,expiration_date:null,lowest_input:0.0000015,provider_count:2,model_kind:'standard',lifecycle_status:'active'},
 {id:'anthropic/claude-sonnet-4.5',name:'Claude Sonnet 4.5',context_length:200000,updated_at:now-3600,lowest_input:0.000002,provider_count:1,model_kind:'standard',lifecycle_status:'active'},
 {id:IMAGE_ID,name:'Studio Image Generator',context_length:8192,updated_at:now-7200,lowest_input:null,provider_count:1,model_kind:'image',lifecycle_status:'active'},
];
const endpoints=[
 {id:'endpoint-a',provider:'Provider With A Long Name',tag:'default',source:'provider',input_price:'0.0000015',output_price:'0.000004',status:'active',checked_at:now-1800,pricing_json:'{"input_cache_read":"0.00000015","input_cache_write":"0.000002","input_cache_write_1h":"0.000003"}'},
 {id:'endpoint-b',provider:'Fast Provider',tag:'low-latency',source:'provider',input_price:'0.0000018',output_price:'0.000003',status:'active',checked_at:now-2400,pricing_json:'{"input_cache_read":"0.00000018","input_cache_write":"0.0000025"}'},
];
const sampleEvents=[
 {id:'evt-1',model_id:MODEL_ID,provider:'Provider With A Long Name',kind:'price.decreased',dimension:'input',old_price:'0.000002',new_price:'0.0000015',change_pct:-25,created_at:now-3600},
 {id:'evt-2',model_id:'anthropic/claude-sonnet-4.5',provider:'Fast Provider',kind:'endpoint.added',dimension:null,old_price:null,new_price:null,change_pct:null,created_at:now-7200},
 {id:'evt-3',model_id:MODEL_ID,provider:'Fast Provider',kind:'price.increased',dimension:'output',old_price:'0.000003',new_price:'0.000004',change_pct:33,created_at:now-10800},
];
function filterModels(url:URL){
 const q=(url.searchParams.get('q')||'').toLowerCase();
 const provider=url.searchParams.get('provider')||'';
 const author=(url.searchParams.get('author')||'').toLowerCase();
 const kind=url.searchParams.get('modality')||'';
 let rows=models.filter(m=>(!q||(m.id+' '+m.name).toLowerCase().includes(q))&&(!author||m.id.startsWith(author+'/'))&&(!kind||(kind==='image'?m.model_kind==='image':kind==='text'))&&(!provider||provider==='Fast Provider'||m.id===MODEL_ID));
 const sort=url.searchParams.get('sort');
 if(sort==='context')rows=[...rows].sort((a,b)=>(b.context_length||0)-(a.context_length||0));
 return {data:rows,page:1,limit:30,total:rows.length};
}
function dataFor(url:URL):object{
 const path=url.pathname;
 if(path==='/api/auth/me')return {error:'Not authenticated'};
 if(path==='/api/stats')return {models:1429,providers:68,subscriptions:32,events24h:13};
 if(path==='/api/health')return {status:'ok',catalog_last_success:now-3600,provider_total:1429,provider_scanned:1320,provider_due:109,provider_errors:4};
 if(path==='/api/providers')return {data:[{provider:'Fast Provider',model_count:44},{provider:'Provider With A Long Name',model_count:76}]};
 if(path==='/api/models')return filterModels(url);
 if(path==='/api/model'){
  const id=url.searchParams.get('id')||MODEL_ID;
  const model=models.find(m=>m.id===id)||models[0];
  const image=model.model_kind==='image';
  return {model,endpoints:image?[{...endpoints[0],id:'img-a',provider:'Image Provider',input_price:null,output_price:null,pricing_json:'{"image_pricing":[{"billable":"output_image","unit":"image","cost_usd":"0.03","conditions":"{}"}]}'}]:endpoints,
   collection:{status:'fresh',last_attempt:now-1100,last_success:now-1200,last_error:null,age_seconds:1200,active_endpoints:image?1:2,missing_endpoints:0}};
 }
 if(path==='/api/price-history'){
  const image=url.searchParams.get('mode')==='image';
  const id=url.searchParams.get('model_id')||MODEL_ID;
  const points=image?[
   {endpoint_id:'img-a',provider:'Image Provider',model_id:id,dimension:'image/output_image/image',unit:'USD/image',price:'0.03',observed_at:now-7*86400},
   {endpoint_id:'img-a',provider:'Image Provider',model_id:id,dimension:'image/output_image/image',unit:'USD/image',price:'0.02',observed_at:now-2*86400},
  ]:[
   {endpoint_id:'endpoint-a',provider:'Provider With A Long Name',model_id:id,dimension:'input',unit:'USD/token',price:'0.000002',observed_at:now-7*86400},
   {endpoint_id:'endpoint-a',provider:'Provider With A Long Name',model_id:id,dimension:'input',unit:'USD/token',price:'0.0000015',observed_at:now-2*86400},
   {endpoint_id:'endpoint-b',provider:'Fast Provider',model_id:id,dimension:'input',unit:'USD/token',price:'0.0000018',observed_at:now-5*86400},
  ];
  const dim=url.searchParams.get('dimension')||'input';
  const selected=image?points:dim==='input'?points:dim==='cache_read'?[{endpoint_id:'endpoint-a',provider:'Provider With A Long Name',model_id:id,dimension:'cache_read',unit:'USD/token',price:'0.00000015',observed_at:now-7*86400}]:[];
  return {data:selected,unit:image?'mixed':'USD/token',method:'observed_baseline_and_change_points',retention_days:180,window_start:now-90*86400,
   dimensions:image?[]:[{dimension:'input',unit:'USD/token'},{dimension:'output',unit:'USD/token'},{dimension:'cache_read',unit:'USD/token'},{dimension:'cache_write',unit:'USD/token'},{dimension:'cache_write_1h',unit:'USD/token'}]};
 }
 if(path==='/api/provider-stability'){
  const days=url.searchParams.get('days')==='7'?7:30;
  const dimension=url.searchParams.get('dimension')||'input';
  const id=url.searchParams.get('model_id')||MODEL_ID;
  const rows=[
   {provider:'Provider With A Long Name',status:'ready',endpointCount:1,coveredEndpoints:1,freshEndpoints:1,changeCount:1,increaseCount:0,decreaseCount:1,changedEndpointDays:1,stableDayRate:100-100/days,maxIncreasePct:null,maxDecreasePct:25,lastChangeAt:now-2*86400,lastScanAt:now-1800,unit:'USD/token'},
   {provider:'Fast Provider',status:'insufficient',endpointCount:1,coveredEndpoints:0,freshEndpoints:1,changeCount:0,increaseCount:0,decreaseCount:0,changedEndpointDays:0,stableDayRate:null,maxIncreasePct:null,maxDecreasePct:null,lastChangeAt:null,lastScanAt:now-1600,unit:null}
  ];
  return {model_id:id,days,from:now-days*86400,to:now,dimension,unit:'USD/token',
   dimensions:[{dimension:'input',unit:'USD/token',endpoints:2},{dimension:'output',unit:'USD/token',endpoints:2},{dimension:'cache_read',unit:'USD/token',endpoints:2}],
   data:rows,metric:'unchanged_endpoint_days_pct'};
 }
 if(path==='/api/events'){
  const model=url.searchParams.get('model_id')||'';
  const provider=url.searchParams.get('provider')||'';
  const kind=url.searchParams.get('kind')||'';
  const q=(url.searchParams.get('q')||'').toLowerCase();
  const filtered=sampleEvents.filter(e=>(!model||e.model_id===model)&&(!provider||e.provider===provider)&&(!kind||e.kind===kind)&&(!q||(e.model_id+' '+e.provider).toLowerCase().includes(q)));
  return {data:filtered,total:filtered.length,page:1,limit:30};
 }
 if(path==='/api/analytics'){
  const days=url.searchParams.get('days')==='30'?30:7;
  const base=new Date('2026-10-20T00:00:00Z');
  const daily=Array.from({length:days},(_,i)=>{
   const date=new Date(base.getTime()-(days-1-i)*86400000).toISOString().slice(0,10);
   const priceUp=i%3===0?3:0,priceDown=i%2===0?2:0,lifecycle=i%4===0?1:0,other=i%5===0?1:0;
   return {date,total:priceUp+priceDown+lifecycle+other,priceUp,priceDown,lifecycle,other};
  });
  return {days,from:now-days*86400,to:now,updatedAt:now,daily,modelKinds:[{kind:'standard',count:1320},{kind:'image',count:109}],topProviders:[{provider:'Provider With A Long Name',models:704,endpoints:706},{provider:'Fast Provider',models:433,endpoints:460}],priceDimensions:[{dimension:'cache_read',count:3},{dimension:'input',count:2}]};
 }
 if(path==='/api/subscriptions'||path==='/api/notifications')return {data:[]};
 if(path==='/api/my-stats')return {subscriptions:0,unread:0};
 return {error:'Missing mock route: '+path};
}
export async function installApiMocks(page:Page){
 await page.route('**/api/**',async(route:Route)=>{
  const url=new URL(route.request().url());
  const code=url.pathname==='/api/auth/me'?401:url.pathname.startsWith('/api/')?200:404;
  await route.fulfill({status:code,contentType:'application/json; charset=utf-8',headers:{'Cache-Control':'no-store'},body:JSON.stringify(dataFor(url))});
 });
}

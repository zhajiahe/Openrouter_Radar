import { z } from 'zod';
export const modelSchema=z.object({
 id:z.string().min(3),name:z.string().min(1),
 description:z.string().nullish(),
 context_length:z.number().nullish(),
 pricing:z.record(z.string(),z.unknown()).optional()
}).passthrough();
export const endpointSchema=z.object({
 name:z.string().optional(),
 provider_name:z.string().min(1),
 tag:z.string().optional(),
 quantization:z.string().nullish(),
 pricing:z.record(z.string(),z.unknown())
}).passthrough();
export type UpstreamModel=z.infer<typeof modelSchema>;
export type UpstreamEndpoint=z.infer<typeof endpointSchema>;
const ORIGIN='https://openrouter.ai';
async function request(url:string):Promise<unknown>{
 const response=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'OpenRouterRadar/0.1 (+https://github.com/zhajiahe/Openrouter_Radar)'},redirect:'manual',signal:AbortSignal.timeout(12_000)});
 if (!response.ok) { const error=new Error('OpenRouter HTTP '+response.status); (error as Error&{status?:number}).status=response.status; throw error; }
 return response.json();
}
export async function listModels():Promise<UpstreamModel[]>{
 const parsed=z.object({data:z.array(modelSchema)}).parse(await request(ORIGIN+'/api/v1/models'));
 return parsed.data;
}
export async function listEndpoints(modelId:string):Promise<UpstreamEndpoint[]>{
 const [author,...rest]=modelId.split('/');
 if (!author || !rest.length || rest.some(x=>!x)) throw new Error('invalid model id');
 const path=[author,...rest].map(encodeURIComponent).join('/');
 const result=z.object({data:z.object({endpoints:z.array(endpointSchema)})}).parse(await request(ORIGIN+'/api/v1/models/'+path+'/endpoints'));
 return result.data.endpoints;
}

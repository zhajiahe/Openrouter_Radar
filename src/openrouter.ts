import { z } from 'zod';

export const modelSchema=z.object({
 id:z.string().min(3),name:z.string().min(1),
 description:z.string().nullish(),
 context_length:z.number().nullish(),
 expiration_date:z.union([z.number(),z.string()]).nullish(),
 // OpenRouter returns alias_target as {slug,name} for alias models.
 alias_target:z.unknown().nullish(),
 architecture:z.record(z.string(),z.unknown()).nullish(),
 supported_parameters:z.array(z.string()).nullish(),
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
async function request(path:string,apiKey:string):Promise<unknown>{
 if(!apiKey?.trim())throw new Error('OPENROUTER_API_KEY is required for operator-side collection');
 const response=await fetch(ORIGIN+path,{
  headers:{
   'Accept':'application/json',
   'Authorization':'Bearer '+apiKey.trim(),
   'User-Agent':'OpenRouterRadar/0.3 (+https://github.com/zhajiahe/Openrouter_Radar)'
  },
  // Workers disallow RequestRedirect='error'; manual prevents unsafe redirect following.
  redirect:'manual',signal:AbortSignal.timeout(12_000)
 });
 if(!response.ok) {
  const error=new Error('OpenRouter API HTTP '+response.status);
  (error as Error&{status?:number}).status=response.status;
  throw error;
 }
 return response.json();
}
export async function listModels(apiKey:string):Promise<UpstreamModel[]>{
 return z.object({data:z.array(modelSchema)}).parse(await request('/api/v1/models',apiKey)).data;
}
export async function listEndpoints(modelId:string,apiKey:string):Promise<UpstreamEndpoint[]>{
 const [author,...rest]=modelId.split('/');
 if(!author||!rest.length||rest.some(x=>!x))throw new Error('invalid model id');
 const path=[author,...rest].map(encodeURIComponent).join('/');
 const result=z.object({data:z.object({endpoints:z.array(endpointSchema)})})
  .parse(await request('/api/v1/models/'+path+'/endpoints',apiKey));
 return result.data.endpoints;
}

/** Dedicated image-generation catalogue and endpoint APIs have a different shape. */
export const imageModelSchema=z.object({
 id:z.string().min(3),name:z.string().min(1),
 description:z.string().nullish(),
 architecture:z.record(z.string(),z.unknown()).nullish()
}).passthrough();
export const imageEndpointSchema=z.object({
 provider_name:z.string().min(1),
 provider_slug:z.string().optional(),
 provider_tag:z.string().optional(),
 pricing:z.array(z.record(z.string(),z.unknown()))
}).passthrough();
export type UpstreamImageEndpoint=z.infer<typeof imageEndpointSchema>;
export async function listImageModels(apiKey:string):Promise<UpstreamModel[]>{
 const data=z.object({data:z.array(imageModelSchema)}).parse(await request('/api/v1/images/models',apiKey)).data;
 return data.map(m=>({id:m.id,name:m.name,description:m.description,architecture:m.architecture,
  // Image-specific supported_parameters is a complex object, not the text API's string[].
  supported_parameters:null,pricing:{}}));
}
export async function listImageEndpoints(modelId:string,apiKey:string):Promise<UpstreamImageEndpoint[]>{
 const [author,...rest]=modelId.split('/');
 if(!author||!rest.length||rest.some(x=>!x))throw new Error('Invalid image model ID');
 const path=[author,...rest].map(encodeURIComponent).join('/');
 const data=z.object({endpoints:z.array(imageEndpointSchema)})
  .parse(await request('/api/v1/images/models/'+path+'/endpoints',apiKey));
 return data.endpoints;
}

export type ModelBillingInfo={
 model_kind?:string;
 capabilities_json?:string|null;
 context_length?:number|null;
};

export function outputModalities(model:ModelBillingInfo):string[]{
 try{
  const metadata=JSON.parse(model.capabilities_json||'{}') as {architecture?:{output_modalities?:unknown}};
  const values=metadata.architecture?.output_modalities;
  return Array.isArray(values)?values.filter((value):value is string=>typeof value==='string').map(value=>value.toLowerCase()):[];
 }catch{return [];}
}

/** A zero prompt/completion price does not establish that media generation is free. */
export function nonTokenModel(model:ModelBillingInfo):boolean{
 return model.model_kind==='image'||outputModalities(model).some(value=>['video','image','audio'].includes(value));
}

export function contextDisplay(model:ModelBillingInfo):string{
 return typeof model.context_length==='number'&&model.context_length>0
  ?model.context_length.toLocaleString('zh-CN'):'未采集 / 不适用';
}

export function contextBrief(model:ModelBillingInfo):string{
 return typeof model.context_length==='number'&&model.context_length>0
  ?Math.round(model.context_length/1024)+'K ctx':'上下文未采集 / 不适用';
}

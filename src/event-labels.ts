/** Human-facing event copy shared by the UI, RSS and email.
 * Keep stored event kind/dimension untouched for existing subscriber rules and feeds. */
const PRICE_DIMENSION_NAMES:Record<string,string>={
 input:'输入',output:'输出',cache_read:'缓存读取',cache_write:'缓存写入',
 cache_write_1h:'缓存写入（1h）',internal_reasoning:'内部推理',
 image_token:'图片 Token',input_audio_cache:'音频缓存读取',
 image:'图片',image_output:'图片输出',audio:'音频输入',
 audio_output:'音频输出',request:'按次请求',web_search:'网页搜索'
};
const IMAGE_BILLABLE:Record<string,string>={
 output_image:'图片输出',input_image:'图片输入',image:'图片',
 output:'图片输出',input:'图片输入'
};
const IMAGE_UNIT:Record<string,string>={
 image:'按张',megapixel:'按百万像素',token:'按 Token',pixel:'按像素',
 second:'按秒',minute:'按分钟',request:'按次'
};
export function priceDimensionLabel(dimension:string|null|undefined):string{
 if(!dimension)return '价格';
 if(dimension.startsWith('image/')){
  const [_,billable,rawUnit]=dimension.split('/');
  const unit=rawUnit?.split(' ')[0]||'';
  const bill=IMAGE_BILLABLE[billable]||'图片计费';
  const description=IMAGE_UNIT[unit];
  return bill+(description?'（'+description+'）':'')+'价格';
 }
 const name=PRICE_DIMENSION_NAMES[dimension];
 return name?name+'价格':'其他计价价格';
}
const SIMPLE_EVENT_NAMES:Record<string,string>={
 'model.added':'模型上架','model.removed':'模型下架','model.restored':'模型恢复',
 'endpoint.added':'新增 Provider','endpoint.removed':'端点下线',
 'endpoint.restored':'端点恢复','model.context_changed':'上下文变化',
 'model.capability_changed':'模型能力变化','model.alias_changed':'别名目标变化',
 'model.expiration_changed':'到期日期变化','model.expiring':'即将到期'
};
/** Titles are dimension-specific only for a concrete event, not for an event-kind filter. */
export function eventTitle(kind:string,dimension?:string|null):string{
 if(kind==='price.increased'||kind==='image.price_increased')
  return '【'+priceDimensionLabel(dimension||(kind.startsWith('image.')?'image':null))+'】上涨';
 if(kind==='price.decreased'||kind==='image.price_decreased')
  return '【'+priceDimensionLabel(dimension||(kind.startsWith('image.')?'image':null))+'】下降';
 if(kind==='image.price_policy_changed')return '【图片计费规则】变更';
 if(kind==='price.policy_changed')return '【定价规则】变更';
 return SIMPLE_EVENT_NAMES[kind]||kind;
}

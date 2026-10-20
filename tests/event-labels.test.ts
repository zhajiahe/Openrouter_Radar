import test from 'node:test';
import assert from 'node:assert/strict';
import {eventTitle,priceDimensionLabel} from '../src/event-labels';

test('concrete price events always identify the billed dimension',()=>{
 assert.equal(eventTitle('price.increased','input'),'【输入价格】上涨');
 assert.equal(eventTitle('price.decreased','output'),'【输出价格】下降');
 assert.equal(eventTitle('price.increased','cache_read'),'【缓存读取价格】上涨');
 assert.equal(eventTitle('price.decreased','cache_write_1h'),'【缓存写入（1h）价格】下降');
 assert.equal(eventTitle('image.price_increased','image/output_image/image'),'【图片输出（按张）价格】上涨');
 assert.equal(eventTitle('image.price_decreased','image/output_image/megapixel'),'【图片输出（按百万像素）价格】下降');
});
test('unknown dimension fails to a safe label and does not alter event identity',()=>{
 assert.equal(priceDimensionLabel('not_understood'),'其他计价价格');
 assert.equal(eventTitle('price.increased',null),'【价格】上涨');
 assert.equal(eventTitle('price.policy_changed','discount'),'【定价规则】变更');
 assert.equal(eventTitle('endpoint.removed',null),'端点下线');
});

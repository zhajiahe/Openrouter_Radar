import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryGroupKey,notificationText} from '../src/delivery';

const base={id:'one',user_id:'u',email:'u@example.test',frequency:'instant',subscription_id:'watch1',
 endpoint_id:'e1',snapshot_id:'snapshot1',model_id:'test/model',provider:'Provider',
 kind:'image.price_decreased',dimension:'image/output_image/image',old_price:'0.05',new_price:'0.04',
 change_pct:-20,created_at:1,event_id:'evt1'};
test('same snapshot and watch combines several billing dimensions into one mail',()=>{
 const next={...base,id:'two',kind:'image.price_increased',dimension:'image/output_image/megapixel'};
 assert.equal(deliveryGroupKey(base),deliveryGroupKey(next));
 assert.notEqual(deliveryGroupKey(base),deliveryGroupKey({...next,subscription_id:'watch2'}));
 assert.notEqual(deliveryGroupKey(base),deliveryGroupKey({...next,snapshot_id:'snapshot2'}));
 const body=notificationText([base,next],'https://radar.example.test');
 assert.match(body,/image\/output_image\/megapixel/);
 assert.match(body,/0\.05/);
 assert.match(body,/管理订阅/);
});

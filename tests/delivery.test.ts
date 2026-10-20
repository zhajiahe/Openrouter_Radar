import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationText} from '../src/delivery';

test('notification emails include event context and management link',()=>{
 const msg=notificationText([{
  id:'1',user_id:'u',email:'a@b.test',frequency:'instant',subscription_id:'watch1',endpoint_id:'endpoint1',snapshot_id:null,model_id:'test/model',
  provider:'Example',kind:'price.decreased',dimension:'input',old_price:'0.00002',
  new_price:'0.00001',change_pct:-50,created_at:1,event_id:'event'
 }], 'https://radar.example.com');
 assert.match(msg,/test\/model/);
 assert.match(msg,/Example/);
 assert.match(msg,/【输入价格】下降/);
 assert.match(msg,/radar.example.com/);
});

test('email price notices name the cache dimension instead of a generic increase',()=>{
 const msg=notificationText([{
  id:'2',user_id:'u',email:'a@b.test',frequency:'instant',
  subscription_id:'watch2',endpoint_id:'endpoint2',snapshot_id:null,
  model_id:'example/model',provider:'P',kind:'price.increased',dimension:'cache_read',
  old_price:'0.000001',new_price:'0.000002',change_pct:100,created_at:2,event_id:'event2'
 }],'https://radar.example.com');
 assert.match(msg,/【缓存读取价格】上涨/);
 assert.match(msg,/缓存读取价格/);
 assert.doesNotMatch(msg,/price.increased/);
});

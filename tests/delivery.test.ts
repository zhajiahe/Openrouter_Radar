import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationText} from '../src/delivery';

test('notification emails include event context and management link',()=>{
 const msg=notificationText([{
  id:'1',user_id:'u',email:'a@b.test',frequency:'instant',model_id:'test/model',
  provider:'Example',kind:'price.decreased',dimension:'input',old_price:'0.00002',
  new_price:'0.00001',change_pct:-50,created_at:1,event_id:'event'
 }], 'https://radar.example.com');
 assert.match(msg,/test\/model/);
 assert.match(msg,/Example/);
 assert.match(msg,/price.decreased/);
 assert.match(msg,/radar.example.com/);
});

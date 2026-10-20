import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedWebhookUrl} from '../src/channels';

test('webhooks are disabled without the operator allowlist',()=>{
 assert.equal(allowedWebhookUrl('https://hooks.example.com/radar',''),null);
});
test('webhook destination is restricted to exact allowed HTTPS hosts',()=>{
 const hosts='hooks.example.com,alerts.example.com';
 assert.equal(allowedWebhookUrl('https://hooks.example.com/radar',hosts),'https://hooks.example.com/radar');
 assert.equal(allowedWebhookUrl('https://sub.hooks.example.com/radar',hosts),null);
 assert.equal(allowedWebhookUrl('https://hooks.example.com.evil.com/radar',hosts),null);
 assert.equal(allowedWebhookUrl('http://hooks.example.com/radar',hosts),null);
 assert.equal(allowedWebhookUrl('https://user:pass@hooks.example.com/radar',hosts),null);
 assert.equal(allowedWebhookUrl('https://hooks.example.com:8443/radar',hosts),null);
 assert.equal(allowedWebhookUrl('https://hooks.example.com/radar#secret',hosts),null);
 assert.equal(allowedWebhookUrl('https://localhost/radar','localhost'),null);
 assert.equal(allowedWebhookUrl('https://127.0.0.1/radar','127.0.0.1'),null);
});

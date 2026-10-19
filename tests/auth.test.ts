import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,token,sha256} from '../src/crypto';

test('password hashes use unique salts and reject invalid passwords',async()=>{
 const p='correct horse battery staple';
 const one=await hashPassword(p),two=await hashPassword(p);
 assert.notEqual(one,two);
 assert.equal(await verifyPassword(p,one),true);
 assert.equal(await verifyPassword('wrong password',one),false);
 assert.equal(await verifyPassword(p,'malformed'),false);
});
test('session tokens are random and hashed before persistence',async()=>{
 const a=token(),b=token();
 assert.equal(a.length,64);
 assert.notEqual(a,b);
 assert.notEqual(await sha256(a),a);
});

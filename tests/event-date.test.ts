import test from 'node:test';
import assert from 'node:assert/strict';
import {utcEventBounds} from '../web/src/event-date';

test('clicking a UTC day filters the exact same 86400-second analytics bucket',()=>{
 const date=utcEventBounds('2026-10-20');
 assert.deepEqual(date,{start:1792454400,end:1792540799});
 assert.equal(date!.end-date!.start,86399);
 const next=utcEventBounds('2026-10-21')!;
 assert.equal(next.start,date!.end+1);
});

test('rejects invalid dates rather than linking to incorrect event ranges',()=>{
 assert.equal(utcEventBounds('2026-02-29'),null);
 assert.equal(utcEventBounds('2026-13-01'),null);
 assert.equal(utcEventBounds('bad'),null);
 assert.notEqual(utcEventBounds('2028-02-29'),null);
});

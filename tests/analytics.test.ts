import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsWindow, buildDailyAnalytics, classifyEventKind } from '../src/analytics';

test('analytics windows are UTC day-aligned and limited to supported ranges', () => {
 const current = Date.parse('2026-10-20T13:45:00Z') / 1000;
 const week = analyticsWindow('7', current);
 const month = analyticsWindow('30', current);
 assert.equal(week.days, 7);
 assert.equal(new Date(week.from * 1000).toISOString(), '2026-10-14T00:00:00.000Z');
 assert.equal(week.to, current);
 assert.equal(month.days, 30);
 assert.equal(new Date(month.from * 1000).toISOString(), '2026-09-21T00:00:00.000Z');
 assert.equal(analyticsWindow('999', current).days, 7);
});

test('daily analytics fills missing days and separates real price and lifecycle signals', () => {
 const from = Date.parse('2026-10-18T00:00:00Z') / 1000;
 const data = buildDailyAnalytics([
  {day:'2026-10-18',kind:'price.increased',count:2},
  {day:'2026-10-18',kind:'image.price_decreased',count:1},
  {day:'2026-10-20',kind:'model.restored',count:3},
  {day:'2026-10-20',kind:'model.capability_changed',count:2},
  {day:'2026-10-21',kind:'price.decreased',count:99}
 ], from, 3);
 assert.equal(data.length, 3);
 assert.deepEqual(data[0], {date:'2026-10-18',total:3,priceUp:2,priceDown:1,lifecycle:0,other:0});
 assert.deepEqual(data[1], {date:'2026-10-19',total:0,priceUp:0,priceDown:0,lifecycle:0,other:0});
 assert.deepEqual(data[2], {date:'2026-10-20',total:5,priceUp:0,priceDown:0,lifecycle:3,other:2});
 assert.equal(classifyEventKind('image.price_increased'),'priceUp');
 assert.equal(classifyEventKind('endpoint.removed'),'lifecycle');
});

test('zero and invalid counts do not create fabricated analytics', () => {
 const from = Date.parse('2026-10-20T00:00:00Z') / 1000;
 const data = buildDailyAnalytics([
  {day:'2026-10-20',kind:'price.increased',count:0},
  {day:'2026-10-20',kind:'price.increased',count:-1},
  {day:'2026-10-19',kind:'price.increased',count:5}
 ], from, 7);
 assert.equal(data[6].total, 0);
 assert.ok(data.every(day => day.total === 0));
});

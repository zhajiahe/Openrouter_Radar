import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchPredicate, parseSearchTerms, SEARCH_QUERY_LIMIT, SEARCH_TERM_LIMIT } from '../src/search';

 test('a single search phrase keeps its spaces', () => {
  assert.deepEqual(parseSearchTerms('  Gemini 2.5  '), ['Gemini 2.5']);
 });

 test('comma, Chinese comma, semicolon and newline separate OR terms', () => {
  assert.deepEqual(parseSearchTerms(' GPT , Claude；gpt\nDeepSeek、 '), ['GPT','Claude','DeepSeek']);
 });

 test('keyword bounds avoid unbounded database predicates', () => {
  assert.equal(parseSearchTerms(Array(20).fill('model').map((s,i)=>s+i).join(',')).length, SEARCH_TERM_LIMIT);
  assert.equal(parseSearchTerms('x'.repeat(SEARCH_QUERY_LIMIT+40))[0].length, 64);
 });

 test('empty filters are no-ops and SQL values stay parameterized', () => {
  assert.deepEqual(buildSearchPredicate('， ; ', ['m.name','m.id']), {sql:'1=1',binds:[]});
  const predicate=buildSearchPredicate('gpt, claude', ['m.name','m.id']);
  assert.deepEqual(predicate.binds, ['gpt','gpt','claude','claude']);
  assert.equal((predicate.sql.match(/instr\(/g)||[]).length,4);
  assert.equal((predicate.sql.match(/\?/g)||[]).length,4);
  assert.equal(predicate.sql.includes('gpt'),false);
  assert.match(predicate.sql,/ OR /);
 });

 test('event search can match either model ID or Provider', () => {
  const predicate=buildSearchPredicate('openai, fireworks', ['model_id','provider']);
  assert.ok(predicate.sql.includes('lower(model_id)'));
  assert.ok(predicate.sql.includes('lower(provider)'));
  assert.deepEqual(predicate.binds, ['openai','openai','fireworks','fireworks']);
 });

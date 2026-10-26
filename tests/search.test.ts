import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModelRelevance, buildSearchPredicate, parseSearchTerms, SEARCH_QUERY_LIMIT, SEARCH_TERM_LIMIT } from '../src/search';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('spaces and punctuation separate search words with OR semantics', () => {
 assert.deepEqual(parseSearchTerms(' GPT   Claude；gpt\nDeepSeek、Gemini，mistral '), ['GPT','Claude','DeepSeek','Gemini','mistral']);
 assert.deepEqual(parseSearchTerms('gpt\tclaude;deepseek'), ['gpt','claude','deepseek']);
});

test('quoted phrases keep spaces and punctuation for substring matches', () => {
 assert.deepEqual(parseSearchTerms('"Gemini 2.5" gpt "Claude 3.7 Sonnet"'), ['Gemini 2.5','gpt','Claude 3.7 Sonnet']);
 assert.deepEqual(parseSearchTerms('“Gemini 2.5” claude'), ['Gemini 2.5','claude']);
 assert.deepEqual(parseSearchTerms('"Gemini, 2.5"; gpt'), ['Gemini, 2.5','gpt']);
 assert.deepEqual(parseSearchTerms('   "  Claude   3.7  "  '), ['Claude 3.7']);
 assert.deepEqual(parseSearchTerms('"Unclosed phrase here'), ['Unclosed phrase here']);
});

test('bounded keyword parsing prevents unbounded D1 work', () => {
 assert.equal(parseSearchTerms(Array.from({length:20},(_,i)=>'model'+i).join(' ')).length, SEARCH_TERM_LIMIT);
 assert.equal(parseSearchTerms('x'.repeat(SEARCH_QUERY_LIMIT+40))[0].length, 64);
 assert.deepEqual(parseSearchTerms('GPT gpt "gpt"'), ['GPT']);
 assert.deepEqual(parseSearchTerms(' , ; 、 \n '), []);
});

test('predicate uses parameterized OR matches across both model columns', () => {
 assert.deepEqual(buildSearchPredicate('， ; ', ['m.name','m.id']), {sql:'1=1',binds:[]});
 const predicate=buildSearchPredicate('gpt claude', ['m.name','m.id']);
 assert.deepEqual(predicate.binds, ['gpt','gpt','claude','claude']);
 assert.equal((predicate.sql.match(/instr\(/g)||[]).length,4);
 assert.equal((predicate.sql.match(/\?/g)||[]).length,4);
 assert.equal(predicate.sql.includes('gpt'),false);
 assert.match(predicate.sql,/ OR /);
});

test('quoted phrases bind as a single term and SQL-like input remains data', () => {
 const phrase=buildSearchPredicate('"Gemini 2.5" gpt', ['m.name','m.id']);
 assert.deepEqual(phrase.binds, ['Gemini 2.5','Gemini 2.5','gpt','gpt']);
 const malicious=buildSearchPredicate('"x\' OR 1=1 --"', ['m.name','m.id']);
 assert.equal(malicious.sql.includes('OR 1=1'),false);
 assert.equal(malicious.binds[0], "x' OR 1=1 --");
});

test('event search also matches words or phrases in the model ID and Provider', () => {
 const predicate=buildSearchPredicate('openai "Fireworks AI"', ['model_id','provider']);
 assert.ok(predicate.sql.includes('lower(model_id)'));
 assert.ok(predicate.sql.includes('lower(provider)'));
 assert.deepEqual(predicate.binds, ['openai','openai','Fireworks AI','Fireworks AI']);
});

test('weighted score rewards exact matches, prefixes and multi-term coverage', () => {
 const score=buildModelRelevance(parseSearchTerms('gpt 4o'));
 assert.deepEqual(score.binds, ['["gpt","4o"]']);
 assert.match(score.sql,/SUM\(CASE/);
 assert.match(score.sql,/lower\(m\.id\)=lower\(t\.value\) THEN 1200/);
 assert.match(score.sql,/lower\(m\.name\)=lower\(t\.value\) THEN 1100/);
 assert.match(score.sql,/lower\(substr\(m\.id/);
 assert.match(score.sql,/instr\(lower\(m\.name\),lower\(t\.value\)\)=1 THEN 700/);
 assert.match(score.sql,/instr\(lower\(m\.id\),lower\(t\.value\)\)>0 THEN 260/);
 assert.deepEqual(buildModelRelevance([]), {sql:'0',binds:[]});
 assert.equal(JSON.parse(buildModelRelevance(Array.from({length:20},(_,i)=>String(i))).binds[0]).length,SEARCH_TERM_LIMIT);
});

test('model catalogue uses relevance by default only for nonempty searches', () => {
 const api=read('src/index.ts');
 const ui=read('web/src/main.tsx');
 assert.match(api,/sort==='auto'\|\|sort==='relevance'/);
 assert.match(api,/relevance_score DESC/);
 assert.match(api,/provider_count DESC/);
 assert.match(api,/order\[sortMode\]/);
 assert.match(api,/\.bind\(provider,provider,\.\.\.\(relevance\?\.binds\|\|\[\]\),\.\.\.binds/);
 assert.match(ui,/const \[sort,setSort\]=useState\(\(\)=>routeParam\('sort'\)\|\|'auto'\)/);
 assert.match(ui,/value:"relevance",label:"相关度优先"/);
 assert.match(ui,/双引号搜索完整短语/);
});

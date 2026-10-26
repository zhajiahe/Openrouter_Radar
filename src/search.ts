// Shared, bounded OR-search for public catalogue and event endpoints.
export const SEARCH_QUERY_LIMIT = 256;
export const SEARCH_TERM_LIMIT = 8;
const MAX_TERM_LENGTH = 64;
const SEPARATOR = /[\s,，、;；]/u;

/**
 * Whitespace and punctuation are OR separators outside double quotes.
 * Quoted phrases preserve spaces: gpt "Gemini 2.5" => ['gpt', 'Gemini 2.5'].
 */
export function parseSearchTerms(input: string): string[] {
 const seen = new Set<string>();
 const terms: string[] = [];
 let buffer = '';
 let quoted = false;
 const add = () => {
  const term = buffer.trim().replace(/\s+/gu, ' ').slice(0, MAX_TERM_LENGTH).trim();
  buffer = '';
  if (!term || seen.has(term.toLowerCase()) || terms.length >= SEARCH_TERM_LIMIT) return;
  seen.add(term.toLowerCase());
  terms.push(term);
 };
 for (const char of input.slice(0, SEARCH_QUERY_LIMIT)) {
  if (char === '"' || char === '“' || char === '”') {
   quoted = !quoted;
   continue;
  }
  if (!quoted && SEPARATOR.test(char)) {
   add();
   if (terms.length >= SEARCH_TERM_LIMIT) break;
  } else {
   buffer += char;
  }
 }
 if (terms.length < SEARCH_TERM_LIMIT) add();
 return terms;
}

/** Bindable, case-insensitive substring search; terms are OR'd across columns. */
export function buildSearchPredicate(input: string, columns: readonly string[]): {sql: string; binds: string[]} {
 const terms = parseSearchTerms(input);
 if (!terms.length) return {sql: '1=1', binds: []};
 const oneTerm = '(' + columns.map(column => `instr(lower(${column}),lower(?))>0`).join(' OR ') + ')';
 return {
  sql: '(' + terms.map(() => oneTerm).join(' OR ') + ')',
  binds: terms.flatMap(term => columns.map(() => term))
 };
}

/**
 * Weighted catalogue relevance, computed only when sorting a nonempty search.
 * - Sum per-keyword scores to reward models matching more of the OR terms.
 * - Exact model ID/name/slug > leading prefix > word boundary > substring.
 * - One JSON parameter prevents user text becoming SQL and bounds D1 work.
 */
export function buildModelRelevance(terms: readonly string[]): {sql: string; binds: string[]} {
 if (!terms.length) return {sql: '0', binds: []};
 return {
  sql: `(SELECT COALESCE(SUM(CASE
   WHEN lower(m.id)=lower(t.value) THEN 1200
   WHEN lower(m.name)=lower(t.value) THEN 1100
   WHEN lower(substr(m.id,instr(m.id,'/')+1))=lower(t.value) THEN 1000
   WHEN instr(lower(m.name),lower(t.value))=1 THEN 700
   WHEN instr(lower(m.id),lower(t.value))=1 THEN 650
   WHEN instr(lower(m.id),'/'||lower(t.value))>0 THEN 600
   WHEN instr(lower(m.name),' '||lower(t.value))>0 THEN 520
   WHEN instr(lower(m.id),lower(t.value))>0 THEN 260
   WHEN instr(lower(m.name),lower(t.value))>0 THEN 240
   ELSE 0 END),0) FROM json_each(?) t)`,
  binds: [JSON.stringify(terms.slice(0, SEARCH_TERM_LIMIT))]
 };
}

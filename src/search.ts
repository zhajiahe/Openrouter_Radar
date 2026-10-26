// Shared, bounded OR-search for public catalogue and event endpoints.
export const SEARCH_QUERY_LIMIT = 256;
export const SEARCH_TERM_LIMIT = 8;
const MAX_TERM_LENGTH = 64;

export function parseSearchTerms(input: string): string[] {
 const seen = new Set<string>();
 const result: string[] = [];
 for (const part of input.slice(0, SEARCH_QUERY_LIMIT).split(/[,，、;；\r\n]+/)) {
  const term = part.trim().slice(0, MAX_TERM_LENGTH).trim();
  const key = term.toLowerCase();
  if (!term || seen.has(key)) continue;
  seen.add(key);
  result.push(term);
  if (result.length === SEARCH_TERM_LIMIT) break;
 }
 return result;
}

/** Bindable, case-insensitive substring search; terms are OR'd across all columns. */
export function buildSearchPredicate(input: string, columns: readonly string[]): {sql: string; binds: string[]} {
 const terms = parseSearchTerms(input);
 if (!terms.length) return {sql: '1=1', binds: []};
 const oneTerm = '(' + columns.map(column => `instr(lower(${column}),lower(?))>0`).join(' OR ') + ')';
 return {
  sql: '(' + terms.map(() => oneTerm).join(' OR ') + ')',
  binds: terms.flatMap(term => columns.map(() => term))
 };
}

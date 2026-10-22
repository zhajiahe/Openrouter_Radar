import type { Bindings } from './types';

export type FreshStartPlan = { id: string; purgeAt: number; startAt: number };
export type FreshStartSettings = Pick<Bindings, 'APP_ORIGIN' | 'FRESH_START_INSTANCE' | 'FRESH_START_ID' | 'FRESH_START_PURGE_AT' | 'FRESH_START_START_AT' | 'ALLOW_DESTRUCTIVE_FRESH_START'>;

/**
 * This opt-in operation is deliberately bound to one instance and expires
 * 24 hours after collection begins. Forks and future installations do not
 * automatically destroy their data.
 */
export function readFreshStartPlan(env:FreshStartSettings,clock=Date.now()):FreshStartPlan|null {
 // Never execute a destructive reset merely because stale timestamp variables remain.
 if (env.ALLOW_DESTRUCTIVE_FRESH_START !== 'true') return null;
 if (!env.FRESH_START_ID || !env.FRESH_START_INSTANCE || env.APP_ORIGIN !== env.FRESH_START_INSTANCE) return null;
 const purgeAt = Date.parse(env.FRESH_START_PURGE_AT ?? '');
 const startAt = Date.parse(env.FRESH_START_START_AT ?? '');
 if (!Number.isFinite(purgeAt) || !Number.isFinite(startAt) || purgeAt >= startAt) return null;
 if (startAt - purgeAt > 86_400_000 || clock > startAt + 86_400_000) return null;
 return {id:env.FRESH_START_ID,purgeAt,startAt};
}

/**
 * Discard old catalogues, endpoint snapshots, observed prices and events.
 * Do not touch users, authentication data or the migration ledger.
 * This is idempotent and runs only in the single global scheduler.
 */
export async function clearCollectionHistory(db:D1Database):Promise<void> {
 const subs = await db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first<{n:number}>();
 if ((subs?.n ?? 0) !== 0) throw new Error('Fresh-start reset refused: subscriptions exist');
 // Separate statements allow recovery if D1's row-write limit is reached mid-reset.
 // Parent tables are deleted last to avoid deleting their children twice by cascade.
 for (const table of ['channel_deliveries','notifications','price_events','price_observations','price_history','endpoints','collection_jobs','models']) {
  await db.prepare('DELETE FROM ' + table).run();
 }
 await db.prepare('UPDATE sync_state SET last_success=0,leased_until=0,last_error=NULL').run();
}

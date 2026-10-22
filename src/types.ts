export type Bindings = {
 DB: D1Database;
 SCHEDULER: DurableObjectNamespace;
 AUTH_RATE_LIMITER: RateLimit;
 IDENTITY_RATE_LIMITER: RateLimit;
 API_RATE_LIMITER: RateLimit;
 EXPENSIVE_RATE_LIMITER: RateLimit;
 MUTATION_RATE_LIMITER: RateLimit;
 ASSETS?: Fetcher;
 APP_ORIGIN: string;
 MAIL_FROM: string;
 RESEND_API_KEY?: string;
 /** Server-side owner secret, never accepted from web clients. */
 OPENROUTER_API_KEY?: string;
 OPEN_SIGNUP?: string;
 MAX_MODELS_PER_TICK?: string;
 /** Pauses collection and cancels the persistent DO alarm without deleting any data. */
 COLLECTION_PAUSED?: string;
 /** Extra safety gate; always absent from normal production configuration. */
 ALLOW_DESTRUCTIVE_FRESH_START?: string;
 /** One-time opt-in reset, scoped to a specific production origin. */
 FRESH_START_ID?: string;
 FRESH_START_INSTANCE?: string;
 FRESH_START_PURGE_AT?: string;
 FRESH_START_START_AT?: string;
};
export type AppEnv = { Bindings: Bindings; Variables: { userId: string } };
export type EventKind = 'price.increased' | 'price.decreased' | 'price.policy_changed'
 | 'endpoint.added' | 'endpoint.removed' | 'endpoint.restored'
 | 'model.added' | 'model.removed' | 'model.restored'
 | 'image.price_increased' | 'image.price_decreased' | 'image.price_policy_changed'
 | 'model.context_changed' | 'model.capability_changed' | 'model.alias_changed'
 | 'model.expiration_changed' | 'model.expiring';
export const EVENT_KINDS: EventKind[] = [
 'price.increased','price.decreased','price.policy_changed',
 'endpoint.added','endpoint.removed','endpoint.restored',
 'model.added','model.removed','model.restored',
 'image.price_increased','image.price_decreased','image.price_policy_changed',
 'model.context_changed','model.capability_changed','model.alias_changed',
 'model.expiration_changed','model.expiring'
];
export const now = () => Math.floor(Date.now()/1000);

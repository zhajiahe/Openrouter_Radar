export type Bindings = {
 DB: D1Database;
 SCHEDULER: DurableObjectNamespace;
 ASSETS?: Fetcher;
 APP_ORIGIN: string;
 MAIL_FROM: string;
 RESEND_API_KEY?: string;
 TELEGRAM_BOT_TOKEN?: string;
 WEBHOOK_ALLOWED_HOSTS?: string;
 /** Server-side owner secret, never accepted from web clients. */
 OPENROUTER_API_KEY?: string;
 OPEN_SIGNUP?: string;
 MAX_MODELS_PER_TICK?: string;
};
export type AppEnv = { Bindings: Bindings; Variables: { userId: string } };
export type EventKind = 'price.increased' | 'price.decreased' | 'price.policy_changed'
 | 'endpoint.added' | 'endpoint.removed' | 'endpoint.restored'
 | 'model.context_changed' | 'model.capability_changed' | 'model.alias_changed'
 | 'model.expiration_changed' | 'model.expiring';
export const EVENT_KINDS: EventKind[] = [
 'price.increased','price.decreased','price.policy_changed',
 'endpoint.added','endpoint.removed','endpoint.restored',
 'model.context_changed','model.capability_changed','model.alias_changed',
 'model.expiration_changed','model.expiring'
];
export const now = () => Math.floor(Date.now()/1000);

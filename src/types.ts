export type Bindings = {
 DB: D1Database;
 SCHEDULER: DurableObjectNamespace;
 ASSETS?: Fetcher;
 APP_ORIGIN: string;
 MAIL_FROM: string;
 RESEND_API_KEY?: string;
 OPEN_SIGNUP?: string;
 MAX_MODELS_PER_TICK?: string;
};
export type AppEnv = { Bindings: Bindings; Variables: { userId: string } };
export type EventKind = 'price.increased' | 'price.decreased' | 'endpoint.added' | 'endpoint.removed' | 'endpoint.restored';
export const EVENT_KINDS: EventKind[] = ['price.increased','price.decreased','endpoint.added','endpoint.removed','endpoint.restored'];
export const now = () => Math.floor(Date.now()/1000);

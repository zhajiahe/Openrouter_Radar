/** Allowlist only anonymous, read-only API resources. */
const CACHE_SECONDS:Readonly<Record<string,number>>={
 '/api/models':120,
 '/api/model':120,
 '/api/provider-stability':120,
 '/api/providers':300,
 '/api/stats':120,
 '/api/analytics':120,
 '/api/events':60,
 '/api/price-history':120
};
export function publicCacheSeconds(pathname:string):number{
 return Object.prototype.hasOwnProperty.call(CACHE_SECONDS,pathname)?CACHE_SECONDS[pathname]:0;
}

/** Cloudflare cache.match() returns a response with immutable headers.
 * Hono secureHeaders mutates response headers after downstream middleware returns. */
export function mutablePublicCacheResponse(hit:Response):Response{
 return new Response(hit.body,hit);
}

import type { RequestMiddleware, ResponseMiddleware } from "@solidjs/start/middleware";
import { createISR } from "../isr.ts";
import { renderer } from "../render.ts";
import type { ISRAdapterOptions, ISRInstance, ISRRequestScope } from "../types.ts";
import { resolveRequestOrigin } from "../utils.ts";

export type { ISRAdapterOptions } from "../types.ts";

/** Cloudflare bindings exposed via vinxi's nativeEvent context. */
interface CloudflareContext {
  env: Record<string, unknown>;
  context: ExecutionContext;
}

/** ISR-specific locals stored on the SolidStart middleware event. */
interface ISRLocals {
  isr?: ISRRequestScope;
  _isrRequest?: Request;
  _isrCtx?: ExecutionContext;
  [key: string]: unknown;
}

/** Shape returned by `handle()` — compatible with `createMiddleware()`. */
export interface MiddlewareHandlers {
  onRequest: RequestMiddleware;
  onBeforeResponse: ResponseMiddleware;
}

let instance: ISRInstance | undefined;

function getISR(env: Record<string, unknown>, options: ISRAdapterOptions): ISRInstance {
  if (!instance) {
    const kvName = options.kvBinding ?? "ISR_CACHE";
    const tagName = options.tagIndexBinding ?? "TAG_INDEX";

    const kv = env[kvName];
    if (!kv) {
      throw new Error(
        `[ISR] KV binding "${kvName}" not found in environment. ` +
        `Add [[kv_namespaces]] with binding = "${kvName}" to your wrangler.toml.`,
      );
    }
    const tagIndex = env[tagName];
    if (!tagIndex) {
      throw new Error(
        `[ISR] Durable Object binding "${tagName}" not found in environment. ` +
        `Add [[durable_objects.bindings]] with name = "${tagName}" to your wrangler.toml, ` +
        `and ensure ISRTagIndexDO is exported from your worker entry point.`,
      );
    }

    instance = createISR({
      kv: kv as KVNamespace,
      tagIndex: tagIndex as DurableObjectNamespace,
      render: options.render ?? renderer(),
      routes: options.routes,
      logger: options.logger,
      bypassToken: options.bypassToken,
      defaultRevalidate: options.defaultRevalidate,
      renderTimeout: options.renderTimeout,
      lockOnMiss: options.lockOnMiss,
      exposeHeaders: options.exposeHeaders,
      shouldCacheStatus: options.shouldCacheStatus,
      cacheKey: options.cacheKey,
      cacheName: options.cacheName,
    });
  }
  return instance;
}

/**
 * Create SolidStart middleware that integrates ISR.
 *
 * Returns an object with `onRequest` and `onBeforeResponse` handlers
 * compatible with `createMiddleware()`.
 *
 * @remarks Options are captured on first invocation and reused for all subsequent requests.
 * Changing options after the first request has no effect.
 *
 * @example
 * ```ts
 * // src/middleware.ts
 * import { createMiddleware } from "@solidjs/start/middleware";
 * import { handle } from "cloudflare-isr/solidstart";
 * export default createMiddleware(handle({ routes: { "/": { revalidate: 60 } } }));
 * ```
 */
export function handle(options: ISRAdapterOptions = {}): MiddlewareHandlers {
  return {
    onRequest: async (event) => {
      const nativeEvent = event.nativeEvent;
      const cf = nativeEvent.context.cloudflare as CloudflareContext | undefined;

      if (!cf) return;

      const { env, context: ctx } = cf;

      // nativeEvent is H3Event — use .path + host header to build full URL
      let origin: string;
      try {
        origin = resolveRequestOrigin({
          rawHost: nativeEvent.headers.get("host") ?? "",
          logger: options.logger,
          protocol: options.originProtocol,
          trustedOrigin: options.trustedOrigin,
          allowedHosts: options.allowedHosts,
        });
      } catch {
        return new Response("Invalid Host header", { status: 400 });
      }

      const url = new URL(nativeEvent.path, origin);
      const request = new Request(url.toString(), {
        method: nativeEvent.method,
        headers: Object.fromEntries(nativeEvent.headers.entries()),
      });

      const isr = getISR(env, options);
      const scoped = isr.scope({ request });
      const locals = event.locals as ISRLocals;
      locals.isr = scoped;
      locals._isrRequest = request;
      locals._isrCtx = ctx;

      // Phase 1: check cache — return Response to short-circuit
      const cached = await scoped.lookup({ request, ctx });
      if (!cached) return;

      return cached;
    },

    onBeforeResponse: async (event, { body }) => {
      const locals = event.locals as ISRLocals;
      const scoped = locals.isr;
      const request = locals._isrRequest;
      const ctx = locals._isrCtx;

      if (!scoped || !request || !ctx) return;

      const routeConfig = scoped.resolveConfig();
      if (!routeConfig) return;

      if (body === undefined || body === null) return;

      const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
      const isrResponse = await scoped.cache({
        request,
        body: bodyStr,
        status: event.response.status ?? 200,
        headers: event.response.headers,
        routeConfig,
        ctx,
      });

      event.response.status = isrResponse.status;
      for (const [key, value] of isrResponse.headers.entries()) {
        event.response.headers.set(key, value);
      }
    },
  };
}

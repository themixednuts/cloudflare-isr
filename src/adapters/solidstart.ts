import type { RequestMiddleware, ResponseMiddleware } from "@solidjs/start/middleware";
import { createISR } from "../isr.ts";
import { renderer } from "../render.ts";
import type { ISRAdapterOptions, ISRInstance, ISRRequestScope } from "../types.ts";
import { host as hostValidator } from "../utils.ts";

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

function getISR(env: Record<string, unknown>, opts: ISRAdapterOptions): ISRInstance {
  if (!instance) {
    const kvName = opts.kvBinding ?? "ISR_CACHE";
    const tagName = opts.tagIndexBinding ?? "TAG_INDEX";

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
      render: renderer(),
      routes: opts.routes,
      logger: opts.logger,
      bypassToken: opts.bypassToken,
      defaultRevalidate: opts.defaultRevalidate,
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
export function handle(opts: ISRAdapterOptions = {}): MiddlewareHandlers {
  return {
    onRequest: async (event) => {
      const nativeEvent = event.nativeEvent;
      const cf = nativeEvent.context.cloudflare as CloudflareContext | undefined;

      if (!cf) return;

      const { env, context: ctx } = cf;

      // nativeEvent is H3Event — use .path + host header to build full URL
      const hostValue = hostValidator.sanitize(nativeEvent.headers.get("host") ?? "localhost", opts.logger);
      const url = new URL(nativeEvent.path, `http://${hostValue}`);
      const request = new Request(url.toString(), {
        method: nativeEvent.method,
        headers: Object.fromEntries(nativeEvent.headers.entries()),
      });

      const isr = getISR(env, opts);
      const scoped = isr.scope(request);
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
      const response = new Response(bodyStr, {
        status: event.response.status ?? 200,
        headers: event.response.headers,
      });

      const isrResponse = await scoped.cache({ request, response, routeConfig, ctx });

      event.response.status = isrResponse.status;
      for (const [key, value] of isrResponse.headers.entries()) {
        event.response.headers.set(key, value);
      }
    },
  };
}

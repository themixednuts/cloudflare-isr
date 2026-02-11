import type { NitroApp, NitroAppPlugin } from "nitropack";
import type { H3Event } from "h3";
import { createISR } from "../isr.ts";
import { renderer } from "../render.ts";
import type { ISRAdapterOptions, ISRInstance, ISRRequestScope } from "../types.ts";
import { host as hostValidator } from "../utils.ts";

export type { ISRAdapterOptions } from "../types.ts";

/** Cloudflare bindings injected by nitro-cloudflare into `event.context`. */
interface CloudflareContext {
  env: Record<string, unknown>;
  context: ExecutionContext;
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
 * Create a Nuxt/Nitro plugin that integrates ISR.
 *
 * @remarks Options are captured on first invocation and reused for all subsequent requests.
 * Changing options after the first request has no effect.
 *
 * @example
 * ```ts
 * // server/plugins/isr.ts
 * import { handle } from "cloudflare-isr/nuxt";
 * export default handle({ routes: { "/": { revalidate: 60 } } });
 * ```
 */
export function handle(opts: ISRAdapterOptions = {}): NitroAppPlugin {
  return (nitro: NitroApp) => {
    const originalHandler = nitro.h3App.handler;

    nitro.h3App.handler = async (event: H3Event) => {
      const cf = event.context.cloudflare as CloudflareContext | undefined;

      if (!cf) {
        return originalHandler(event);
      }

      const { env, context: ctx } = cf;

      const hostValue = hostValidator.sanitize(event.headers.get("host") ?? "localhost", opts.logger);
      const url = new URL(event.path, `http://${hostValue}`);
      const request = new Request(url.toString(), {
        method: event.method,
        headers: event.headers,
      });

      const isr = getISR(env, opts);
      const scoped = isr.scope(request);
      event.context.isr = scoped;

      // Phase 1: check cache
      const cached = await scoped.lookup({ request, ctx });
      if (cached) {
        event.respondWith(cached);
        return;
      }

      // Phase 2: framework renders (route handlers may call isr.set())
      const result = await originalHandler(event);

      // Phase 3: store in cache if the route opted in
      const routeConfig = scoped.resolveConfig();
      if (routeConfig) {
        const body = typeof result === "string" ? result : JSON.stringify(result);
        const status = event.node.res.statusCode;
        const rawHeaders = event.node.res.getHeaders();
        const responseHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (v !== undefined) {
            responseHeaders[k] = Array.isArray(v) ? v.join(", ") : String(v);
          }
        }
        const response = new Response(body, { status, headers: responseHeaders });
        const isrResponse = await scoped.cache({ request, response, routeConfig, ctx });

        event.respondWith(isrResponse);
        return;
      }

      return result;
    };
  };
}

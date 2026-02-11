import type { Handle } from "@sveltejs/kit";
import { createISR } from "../isr.ts";
import { renderer } from "../render.ts";
import type { ISRAdapterOptions, ISRInstance, ISRRequestScope } from "../types.ts";

export type { ISRAdapterOptions } from "../types.ts";

/** Cloudflare platform bindings available on `event.platform` in SvelteKit. */
interface CloudflarePlatform {
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
 * Create a SvelteKit `Handle` that integrates ISR.
 *
 * @remarks Options are captured on first invocation and reused for all subsequent requests.
 * Changing options after the first request has no effect.
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * import { handle as isr } from "cloudflare-isr/sveltekit";
 * export const handle = isr();
 * ```
 */
export function handle(opts: ISRAdapterOptions = {}): Handle {
  return async ({ event, resolve }) => {
    const platform = event.platform as CloudflarePlatform | undefined;

    if (!platform) {
      return resolve(event);
    }

    const { env, context: ctx } = platform;
    const isr = getISR(env, opts);
    const scoped = isr.scope(event.request);
    (event.locals as Record<string, unknown>).isr = scoped;

    // Phase 1: check cache
    const cached = await scoped.lookup({ request: event.request, ctx });
    if (cached) return cached;

    // Phase 2: framework renders (load functions call isr.defaults()/set())
    const response = await resolve(event);

    // Phase 3: store in cache if the route opted in
    const routeConfig = scoped.resolveConfig();
    if (routeConfig) {
      return scoped.cache({ request: event.request, response, routeConfig, ctx });
    }

    return response;
  };
}

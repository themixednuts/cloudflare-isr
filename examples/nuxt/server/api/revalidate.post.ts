import { createISR, type ISRInstance } from "cloudflare-isr";

let isr: ISRInstance | undefined;

function getISR(env: { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace }): ISRInstance {
  if (!isr) {
    isr = createISR({
      kv: env.ISR_CACHE,
      tagIndex: env.TAG_INDEX,
    });
  }
  return isr;
}

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do work proportional to max length to avoid leaking length info
    let result = 1;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      result |= (a.charCodeAt(i % a.length) ?? 0) ^ (b.charCodeAt(i % b.length) ?? 0);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare?.env as
    | { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace; REVALIDATION_SECRET?: string }
    | undefined;

  if (!env) {
    throw createError({ statusCode: 500, statusMessage: "No platform bindings" });
  }

  const secret = env.REVALIDATION_SECRET;
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: "REVALIDATION_SECRET not configured" });
  }

  const token = getHeader(event, "authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !timingSafeEqual(token, secret)) {
    throw createError({ statusCode: 401, statusMessage: "Invalid revalidation token" });
  }

  const body = await readBody<{
    path?: string;
    paths?: string[];
    tag?: string;
    tags?: string[];
  }>(event);

  const instance = getISR(env);

  const paths = body.paths ?? (body.path ? [body.path] : []);
  const tags = body.tags ?? (body.tag ? [body.tag] : []);

  await Promise.all([
    ...paths.map((p) => instance.revalidatePath(p)),
    ...tags.map((t) => instance.revalidateTag(t)),
  ]);

  return { revalidated: true };
});

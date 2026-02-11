import type { APIEvent } from "@solidjs/start/server";
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

export async function POST({ request, nativeEvent }: APIEvent) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return new Response(JSON.stringify({ error: "Request body too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  const env = (nativeEvent as any).context?.cloudflare?.env as
    | { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace; REVALIDATION_SECRET?: string }
    | undefined;

  if (!env) {
    return new Response(JSON.stringify({ error: "No platform bindings" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const secret = env.REVALIDATION_SECRET;
  if (!secret) {
    return new Response(JSON.stringify({ error: "REVALIDATION_SECRET not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !timingSafeEqual(token, secret)) {
    return new Response(JSON.stringify({ error: "Invalid revalidation token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { path?: string; tag?: string };
  try {
    body = (await request.json()) as { path?: string; tag?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (body.path) {
    await getISR(env).revalidatePath({ path: body.path });
  }
  if (body.tag) {
    await getISR(env).revalidateTag({ tag: body.tag });
  }

  return new Response(JSON.stringify({ revalidated: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

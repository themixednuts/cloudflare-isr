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

export async function POST({ request, nativeEvent }: APIEvent) {
  const env = (nativeEvent as any).context?.cloudflare?.env as
    | { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace }
    | undefined;

  if (!env) {
    return new Response(JSON.stringify({ error: "No platform bindings" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await request.json()) as { path?: string; tag?: string };

  if (body.path) {
    await getISR(env).revalidatePath(body.path);
  }
  if (body.tag) {
    await getISR(env).revalidateTag(body.tag);
  }

  return new Response(JSON.stringify({ revalidated: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

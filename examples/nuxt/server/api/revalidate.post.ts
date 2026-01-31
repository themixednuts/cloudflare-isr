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

export default defineEventHandler(async (event) => {
  const env = event.context.cloudflare?.env as
    | { ISR_CACHE: KVNamespace; TAG_INDEX: DurableObjectNamespace }
    | undefined;

  if (!env) {
    throw createError({ statusCode: 500, statusMessage: "No platform bindings" });
  }

  const body = await readBody<{ path?: string; tag?: string }>(event);

  if (body.path) {
    await getISR(env).revalidatePath(body.path);
  }
  if (body.tag) {
    await getISR(env).revalidateTag(body.tag);
  }

  return { revalidated: true };
});

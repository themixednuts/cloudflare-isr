import type { RequestHandler } from "./$types";
import type { ISRInstance } from "cloudflare-isr";

let isr: ISRInstance | undefined;

async function getISR(env: App.Platform["env"]): Promise<ISRInstance> {
  if (!isr) {
    const { createISR } = await import("cloudflare-isr");
    isr = createISR({
      kv: env.ISR_CACHE,
      tagIndex: env.TAG_INDEX,
    });
  }
  return isr;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env;
  if (!env) {
    return new Response(JSON.stringify({ error: "No platform bindings" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const instance = await getISR(env);
  const body = await request.json<{ path?: string; tag?: string }>();

  if (body.path) {
    await instance.revalidatePath(body.path);
  }
  if (body.tag) {
    await instance.revalidateTag(body.tag);
  }

  return new Response(JSON.stringify({ revalidated: true }), {
    headers: { "Content-Type": "application/json" },
  });
};

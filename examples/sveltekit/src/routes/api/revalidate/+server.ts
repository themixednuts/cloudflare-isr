import type { RequestHandler } from "./$types";

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

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  const secret = (platform?.env as Record<string, string> | undefined)?.REVALIDATION_SECRET;
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

  const body = await request.json<{ path?: string; tag?: string }>();

  if (body.path) {
    console.log(`[revalidate] Purging path: ${body.path}`);
    await locals.isr.revalidatePath(body.path);
  }
  if (body.tag) {
    console.log(`[revalidate] Purging tag: ${body.tag}`);
    await locals.isr.revalidateTag(body.tag);
  }

  return new Response(JSON.stringify({ revalidated: true }), {
    headers: { "Content-Type": "application/json" },
  });
};

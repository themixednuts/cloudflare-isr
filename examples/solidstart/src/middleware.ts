import { createMiddleware } from "@solidjs/start/middleware";
import { handle } from "cloudflare-isr/solidstart";

export default createMiddleware(handle({
  routes: {
    "/": { revalidate: 60, tags: ["home"] },
    "/blog/[slug]": { revalidate: 120, tags: ["blog"] },
  },
}));

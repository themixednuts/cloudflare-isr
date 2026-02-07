import { handle } from "cloudflare-isr/nuxt";

export default handle({
  routes: {
    "/": { revalidate: 60, tags: ["home"] },
    "/blog/[slug]": { revalidate: 120, tags: ["blog"] },
  },
});

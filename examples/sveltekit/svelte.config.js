import adapter from "@sveltejs/adapter-cloudflare";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      platformProxy: {
        persist: { path: "../.wrangler/v3" },
      },
    }),
  },
};

export default config;

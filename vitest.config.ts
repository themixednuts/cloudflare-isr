import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: "./src/test-worker.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});

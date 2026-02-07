import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8899",
  },
  webServer: {
    command: "bun run cf:dev",
    url: "http://127.0.0.1:8899",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

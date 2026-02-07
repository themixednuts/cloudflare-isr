/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "cloudflare:workers",
];

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.join(rootDir, "src/index.ts"),
        sveltekit: path.join(rootDir, "src/adapters/sveltekit.ts"),
        nuxt: path.join(rootDir, "src/adapters/nuxt.ts"),
        solidstart: path.join(rootDir, "src/adapters/solidstart.ts"),
      },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: externals,
    },
  },
  plugins: [
    dts({
      entryRoot: "src",
      tsconfigPath: path.join(rootDir, "tsconfig.json"),
    }),
  ],
});

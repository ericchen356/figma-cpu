import { defineConfig } from "vitest/config";

// Load .asm programs as text, like esbuild's `loader: { ".asm": "text" }` in build.mjs.
export default defineConfig({
  plugins: [
    {
      name: "asm-as-text",
      transform(code, id) {
        if (id.endsWith(".asm")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
});

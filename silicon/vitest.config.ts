import { defineConfig } from "vitest/config";

// Load .asm programs as text (esbuild uses loader { ".asm": "text" }).
export default defineConfig({
  plugins: [
    {
      name: "asm-as-text",
      transform(code, id) {
        if (id.endsWith(".asm")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  test: { testTimeout: 30000 },
});

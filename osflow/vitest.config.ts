import { defineConfig } from "vitest/config";

// silicon's programs are .asm files imported as text (silicon/vitest.config.ts does the same).
export default defineConfig({
  plugins: [
    {
      name: "asm-as-text",
      transform(code, id) {
        if (id.endsWith(".asm")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  test: { testTimeout: 60000 },
});

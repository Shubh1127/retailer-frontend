/**
 * Test setup for the retailer app.
 *
 * jsdom, because the component under test is about what a buyer can SEE and
 * click — that a basket's other lines are shown, and that no control exists to
 * clear one. Those are assertions about rendered output, not about state.
 *
 * No @vitejs/plugin-react: esbuild's automatic JSX runtime is all these tests
 * need, and the plugin is ESM-only, which a CommonJS config file cannot load.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});

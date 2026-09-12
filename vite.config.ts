import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@host": resolve(process.cwd(), mode === "native" ? "src/host/tauri.ts" : "src/host/web.ts"),
    },
  },
  server: {
    proxy: {
      "/v1": "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
    clearMocks: true,
  },
}));

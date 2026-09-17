import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: {
      "@host": resolve(
        process.cwd(),
        mode === "native" ? "src/host/tauri.ts" : "src/host/web.ts",
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: mode === "native" ? process.env.TAURI_DEV_HOST || false : false,
    hmr: mode === "native" && process.env.TAURI_DEV_HOST
      ? { protocol: "ws", host: process.env.TAURI_DEV_HOST, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    proxy: {
      "/v1": process.env.KENKUI_DEV_API_ORIGIN ?? "http://127.0.0.1:8000",
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
    clearMocks: true,
  },
}));

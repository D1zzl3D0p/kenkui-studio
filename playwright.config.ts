import { defineConfig } from "@playwright/test";
import path from "node:path";

const serverRoot = process.env.KENKUI_SERVER_ROOT
  ?? path.resolve(__dirname, "..", "kenkui-server");

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: `npm run build && ${path.join(serverRoot, ".venv/bin/python")} tests/e2e/local-server.py`,
    url: "http://127.0.0.1:4173/v1/health",
    reuseExistingServer: false,
    env: { KENKUI_SERVER_ROOT: serverRoot },
  },
});

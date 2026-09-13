import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "npm run build && ../kenkui-server/.venv/bin/python tests/e2e/local-server.py",
    url: "http://127.0.0.1:4173/v1/health",
    reuseExistingServer: false,
  },
});

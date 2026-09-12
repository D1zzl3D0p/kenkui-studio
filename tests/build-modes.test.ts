import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import config from "../vite.config";

function aliasFor(mode: string): string {
  const factory = config as unknown as (env: { command: string; mode: string }) => unknown;
  const resolved = factory({ command: "build", mode });
  return (resolved as { resolve: { alias: Record<string, string> } }).resolve.alias["@host"];
}

describe("build modes", () => {
  it("resolves @host to the web host by default", () => {
    expect(aliasFor("production")).toBe(resolve(process.cwd(), "src/host/web.ts"));
  });

  it("resolves @host to the native host under the native mode", () => {
    expect(aliasFor("native")).toBe(resolve(process.cwd(), "src/host/tauri.ts"));
  });
});

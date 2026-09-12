import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Pages and components branch on host.can.*, never on platform identity. */
const forbidden = [/platform\s*===/, /__TAURI__/, /isLocalServer/, /isKenkuiCloud/];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

describe("capability discipline", () => {
  it("keeps platform identity out of pages and components", () => {
    const offenders = [...sourceFiles("src/pages"), ...sourceFiles("src/components")]
      .filter((file) => forbidden.some((pattern) => pattern.test(readFileSync(file, "utf8"))));

    expect(offenders).toEqual([]);
  });
});

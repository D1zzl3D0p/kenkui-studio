import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const cli = path.join(
  path.dirname(require.resolve("openapi-typescript/package.json")),
  "bin/cli.js",
);
const frozen = fileURLToPath(new URL('../contracts/local-api/v1.json', import.meta.url));
if (!process.env.KENKUI_SERVER_ROOT) {
  const provenance = JSON.parse(readFileSync(new URL('../contracts/local-api/source.json', import.meta.url),'utf8'));
  const source = readFileSync(frozen);
  const blob = createHash('sha1').update(`blob ${source.length}\0`).update(source).digest('hex');
  if (blob !== provenance.gitBlob) throw new Error('Frozen local API schema differs from its reviewed source');
}
const result = spawnSync(
  process.execPath,
  [
    cli,
    process.env.KENKUI_SERVER_ROOT ? path.join(process.env.KENKUI_SERVER_ROOT, "openapi/v1.json") : frozen,
    "-o",
    "src/api/generated/schema.ts",
    "--default-non-nullable",
    "false",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);

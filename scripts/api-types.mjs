import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const cli = path.join(
  path.dirname(require.resolve("openapi-typescript/package.json")),
  "bin/cli.js",
);
const server = process.env.KENKUI_SERVER_ROOT ?? "../kenkui-server";
const result = spawnSync(
  process.execPath,
  [
    cli,
    path.join(server, "openapi/v1.json"),
    "-o",
    "src/api/generated/schema.ts",
    "--default-non-nullable",
    "false",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);

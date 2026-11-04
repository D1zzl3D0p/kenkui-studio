import { spawnSync } from "node:child_process";
import { loadRelease } from "./release-config.mjs";

const [environment, ...flags] = process.argv.slice(2);
if (!["staging", "production"].includes(environment) || flags.some(flag => flag !== "--dry-run")) {
  throw new Error("Usage: node scripts/deploy.mjs staging|production [--dry-run]");
}
const release = loadRelease(environment);
for (const [command, args] of [
  ["npm", ["run", "build"]],
  ["npx", ["--no-install", "wrangler", "deploy", "--env", environment, ...flags]],
]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...release },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

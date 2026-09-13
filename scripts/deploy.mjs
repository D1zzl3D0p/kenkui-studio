import { spawnSync } from "node:child_process";

const [environment, ...flags] = process.argv.slice(2);
if (!["staging", "production"].includes(environment) || flags.some(flag => flag !== "--dry-run")) {
  throw new Error("Usage: node scripts/deploy.mjs staging|production [--dry-run]");
}
const origin = environment === "production"
  ? "https://api.kenkui.fm" : "https://api.staging.kenkui.fm";
for (const [command, args] of [
  ["npm", ["run", "build"]],
  ["npx", ["--no-install", "wrangler", "deploy", "--env", environment, ...flags]],
]) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, VITE_KENKUI_API_ORIGIN: origin },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

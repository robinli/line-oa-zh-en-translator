import {spawnSync} from "node:child_process";

const npmCli = process.env.npm_execpath;
const checks = ["check", "test", "build"];

if (!npmCli) {
  console.error("Unable to locate the npm CLI from npm_execpath.");
  process.exit(1);
}

for (const check of checks) {
  const result = spawnSync(process.execPath, [npmCli, "run", check], {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`Unable to run npm script '${check}':`, result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Pre-deployment verification passed.");

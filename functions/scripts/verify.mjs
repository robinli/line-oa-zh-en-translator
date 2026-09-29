import {spawnSync} from "node:child_process";
import {delimiter, dirname} from "node:path";

const npmCli = process.env.npm_execpath;
const checks = ["check", "test", "build", "test:nmt-tools", "test:quality-tools", "test:deploy-tools", "test:local-tools"];

if (process.versions.node.split('.')[0] !== '22') {
  console.error(`Node.js 22 is required; received ${process.version} (${process.execPath}). Use scripts/check-local.ps1 -NodePath <Node22 node.exe>.`);
  process.exit(1);
}

if (!npmCli) {
  console.error("Unable to locate the npm CLI from npm_execpath.");
  process.exit(1);
}

// npm lifecycle scripts resolve bare `node` via PATH, even when npm itself was pinned.
const env = {...process.env};
// A full verification must never inherit a previous targeted selection.
delete env.LINE_OA_TEST_FILES_JSON;
const pathKeys = Object.keys(env).filter(key => process.platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH');
const existingPath = pathKeys.map(key => env[key]).filter(Boolean).join(delimiter);
for (const key of pathKeys) delete env[key];
env.PATH = dirname(process.execPath) + delimiter + existingPath;

for (const check of checks) {
  const result = spawnSync(process.execPath, [npmCli, "run", check], {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env,
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

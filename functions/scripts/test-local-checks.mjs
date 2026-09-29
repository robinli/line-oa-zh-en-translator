import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, dirname, basename, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));
const windows = process.platform === 'win32';
const powershell = windows ? resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : '';
const checks = ['check', 'test', 'build', 'test:nmt-tools', 'test:quality-tools', 'test:deploy-tools', 'test:local-tools'];
const quote = value => "'" + value.replace(/'/g, "''") + "'";
const put = (root, name, contents) => {
  const path = resolve(root, name);
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, contents.replace(/\r?\n/g, '\r\n'), 'utf8');
  return path;
};

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'local-check-tests-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('local-check-tests-'));
    rmSync(root, {recursive: true, force: true});
  });
  const checkout = resolve(root, "space 中文 & quote' checkout");
  for (const name of ['scripts/check-local.ps1', 'functions/scripts/verify.mjs', 'functions/vitest.config.mts']) {
    mkdirSync(dirname(resolve(checkout, name)), {recursive: true});
    copyFileSync(resolve(project, name), resolve(checkout, name));
  }
  mkdirSync(resolve(checkout, 'functions/src'), {recursive: true});
  const npmCli = put(checkout, 'fake-npm.cjs', `
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2), task = args[args.indexOf('run') + 1];
if (task === 'verify') {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'functions/scripts/verify.mjs')], {stdio: 'inherit', env: {...process.env, npm_execpath: __filename}});
  process.exit(result.status ?? 1);
}
const child = spawnSync('node', ['-p', 'process.execPath'], {encoding: 'utf8'});
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({task, cwd: process.cwd(), runtime: process.execPath, child: child.stdout?.trim(), status: child.status, selection: process.env.LINE_OA_TEST_FILES_JSON ?? null}) + '\\n');
console.log('fixture stdout ' + task);
if (process.env.LOCAL_CHECK_FIXTURE_FAIL === task) { console.error('fixture stderr 中文'); process.exit(23); }
if (child.status !== 0) process.exit(77);
`);
  return {root, checkout, npmCli, launcher: resolve(checkout, 'scripts/check-local.ps1')};
}

function runPowerShell(f, tail = '', cwd = f.root, env = {}) {
  const command = `& ${quote(f.launcher)} -NodePath ${quote(process.execPath)} -NpmCli ${quote(f.npmCli)} ${tail}; exit $LASTEXITCODE`;
  return spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd, env: {...process.env, ...env}, encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
}
const calls = f => readFileSync(resolve(f.checkout, 'calls.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const logs = f => readdirSync(resolve(f.checkout, '.local/checks')).map(name => readFileSync(resolve(f.checkout, '.local/checks', name), 'utf8'));

test('verify pins npm lifecycle child Node and cwd despite an unrelated inherited PATH', t => {
  const f = fixture(t), env = {...process.env, npm_execpath: f.npmCli, LINE_OA_TEST_FILES_JSON: '["must-not-leak"]'};
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env[windows ? 'Path' : 'PATH'] = resolve(f.root, 'absent-runtime') + delimiter + (process.env.PATH ?? process.env.Path ?? '');
  const result = spawnSync(process.execPath, [resolve(f.checkout, 'functions/scripts/verify.mjs')], {cwd: f.root, env, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const records = calls(f);
  assert.deepEqual(records.map(row => row.task), checks);
  for (const row of records) {
    assert.equal(row.cwd, resolve(f.checkout, 'functions'));
    assert.equal(row.runtime, process.execPath);
    assert.equal(row.child, process.execPath);
    assert.equal(row.status, 0);
    assert.equal(row.selection, null);
  }
});

test('Windows launcher runs full checks from another cwd and saves a UTF-8 log', {skip: !windows}, t => {
  const f = fixture(t), result = runPowerShell(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS \(exit 0\)/);
  assert.deepEqual(calls(f).map(row => row.task), checks);
  assert.match(logs(f)[0], /fixture stdout test:local-tools/);
});

test('Windows launcher retains native stderr and exit 23 and stops later checks', {skip: !windows}, t => {
  const f = fixture(t), result = runPowerShell(f, '', f.root, {LOCAL_CHECK_FIXTURE_FAIL: 'test'});
  assert.equal(result.status, 23, result.stdout + result.stderr);
  assert.deepEqual(calls(f).map(row => row.task), ['check', 'test']);
  assert.match(logs(f)[0], /fixture stderr 中文/);
  assert.match(logs(f)[0], /Exit code: 23/);
});

test('Windows launcher rejects a non-22 runtime before any check runs', {skip: !windows}, t => {
  const f = fixture(t), wrongNode = put(f.root, 'wrong-node.cmd', '@echo off\necho v24.0.0\nexit /b 0\n');
  const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f.launcher, '-NodePath', wrongNode], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /v24\.0\.0/);
  assert.equal(existsSync(resolve(f.checkout, 'calls.jsonl')), false);
});

test('targeted mode rejects missing, out-of-scope and empty selections before running Vitest', {skip: !windows}, t => {
  const f = fixture(t);
  put(f.checkout, 'functions/src/valid.test.ts', '// fixture');
  put(f.checkout, 'functions/lib/old.test.ts', '// archived');
  for (const tail of [
    '-Mode targeted',
    "-Mode targeted -Tests @('src/valid.test.ts','src/missing.test.ts')",
    "-Mode targeted -Tests @('lib/old.test.ts')",
    "-Mode full -Tests @('src/valid.test.ts')",
  ]) {
    const result = runPowerShell(f, tail);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
  assert.equal(existsSync(resolve(f.checkout, '.local/checks')), false);
});

function vitestFixture(t) {
  const f = fixture(t);
  symlinkSync(resolve(project, 'functions/node_modules'), resolve(f.checkout, 'functions/node_modules'), 'junction');
  put(f.checkout, 'functions/src/first.test.ts', "import {test, expect} from 'vitest'; test('current first', () => expect(1).toBe(1));\n");
  put(f.checkout, 'functions/src/second.test.ts', "import {test, expect} from 'vitest'; test('current second', () => expect(2).toBe(2));\n");
  for (const name of ['.local/archive/functions/src/old.test.ts', 'functions/lib/old.test.ts', 'functions/src/.local/old.test.ts']) {
    put(f.checkout, name, "throw Error('ARCHIVED_TEST_MUST_NOT_RUN');\n");
  }
  return f;
}

test('explicit Vitest config collects the same current tests from root and functions, excluding archives', t => {
  const f = vitestFixture(t);
  for (const cwd of [f.checkout, resolve(f.checkout, 'functions')]) {
    const result = spawnSync(process.execPath, [resolve(project, 'functions/node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(f.checkout, 'functions/vitest.config.mts'), '--reporter=json'], {cwd, encoding: 'utf8', timeout: 60000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.numTotalTests, 2);
    assert.equal(report.numPassedTests, 2);
    assert.ok(report.testResults.every(row => row.name.includes('src') && !row.name.includes('.local')));
  }
});

test('Windows targeted launcher selects exact existing files across cwd and rejects a file without tests', {skip: !windows}, t => {
  const f = vitestFixture(t);
  for (const cwd of [f.root, resolve(f.checkout, 'functions')]) {
    const result = runPowerShell(f, "-Mode targeted -Tests @('src/first.test.ts')", cwd);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  for (const log of logs(f)) {
    assert.match(log, /first\.test\.ts/);
    assert.doesNotMatch(log, /second\.test\.ts|ARCHIVED_TEST_MUST_NOT_RUN/);
  }
  put(f.checkout, 'functions/src/empty.test.ts', 'export {};\n');
  const empty = runPowerShell(f, "-Mode targeted -Tests @('src/empty.test.ts')");
  assert.notEqual(empty.status, 0);
});

test('Vitest exits nonzero when filters select no current test files', t => {
  const f = vitestFixture(t);
  const result = spawnSync(process.execPath, [resolve(project, 'functions/node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(f.checkout, 'functions/vitest.config.mts'), 'missing-test-file'], {cwd: f.root, encoding: 'utf8', timeout: 60000});
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /No test files found/);
});

test('targeted collection excludes extension neighbors and treats glob characters literally', {skip: !windows}, t => {
  const f = vitestFixture(t);
  put(f.checkout, 'functions/src/first.test.tsx', "import {test} from 'vitest'; test('unrequested', () => {throw Error('UNREQUESTED_NEIGHBOR_EXECUTED')});\n");
  put(f.checkout, 'functions/src/paired.test.js', "import {test} from 'vitest'; test('selected js', () => {});\n");
  put(f.checkout, 'functions/src/paired.test.jsx', "import {test} from 'vitest'; test('unrequested jsx', () => {throw Error('UNREQUESTED_NEIGHBOR_EXECUTED')});\n");
  put(f.checkout, 'functions/src/case [1].test.ts', "import {test} from 'vitest'; test('literal brackets', () => {});\n");
  put(f.checkout, 'functions/src/case 1.test.ts', "import {test} from 'vitest'; test('glob neighbor', () => {throw Error('UNREQUESTED_NEIGHBOR_EXECUTED')});\n");
  const result = runPowerShell(f, "-Mode targeted -Tests @('src/first.test.ts','src/paired.test.js','src/case [1].test.ts')");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(logs(f)[0], /first\.test\.tsx|paired\.test\.jsx|UNREQUESTED_NEIGHBOR_EXECUTED/);
});

test('targeted zero-execution skip/todo runs fail while a mixed executed/skipped run passes', {skip: !windows}, t => {
  const f = vitestFixture(t);
  put(f.checkout, 'functions/src/skipped.test.ts', "import {test} from 'vitest'; test.skip('not executed', () => {});\n");
  put(f.checkout, 'functions/src/todo.test.ts', "import {test} from 'vitest'; test.todo('not implemented');\n");
  for (const name of ['skipped', 'todo']) {
    const result = runPowerShell(f, `-Mode targeted -Tests @('src/${name}.test.ts')`);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /No tests executed/);
    assert.doesNotMatch(result.stdout, /PASS \(exit 0\)/);
  }
  const mixed = runPowerShell(f, "-Mode targeted -Tests @('src/first.test.ts','src/skipped.test.ts')");
  assert.equal(mixed.status, 0, mixed.stdout + mixed.stderr);
});

test('the full application config also rejects all-skipped tests', t => {
  const f = vitestFixture(t);
  for (const name of ['first', 'second']) put(f.checkout, `functions/src/${name}.test.ts`, "import {test} from 'vitest'; test.skip('not executed', () => {});\n");
  const result = spawnSync(process.execPath, [resolve(project, 'functions/node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(f.checkout, 'functions/vitest.config.mts')], {cwd: f.checkout, encoding: 'utf8', timeout: 60000});
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /No tests executed/);
});

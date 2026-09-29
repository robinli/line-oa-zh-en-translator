import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, dirname, basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareDevPackage, validateDevPackage, DEV_PROJECT} from './prepare-dev-deploy.mjs';
import {glossaryRecordFile} from './nmt-glossary-spec.mjs';

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'dev-package-test-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dev-package-test-'));
    rmSync(root, {recursive: true, force: true});
  });
  const put = (name, contents) => {const path = resolve(root, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, contents);};
  for (const dir of ['src', 'scripts', 'evaluation', 'glossaries', 'config']) put(`functions/${dir}/fixture.txt`, dir + '\r\n');
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.mts']) put('functions/' + name, '{}\r\n');
  put('scripts/check-local.ps1', '# project local check launcher\r\n');
  put('package.json', '{}\r\n');
  put('firebase.json', JSON.stringify({functions: [{source: 'functions', predeploy: [`node nmt-admin.mjs deploy-check --project=${DEV_PROJECT}`, 'npm run verify']}]}));
  put('.firebaserc', JSON.stringify({projects: {test: DEV_PROJECT}}));
  put(`functions/.env.${DEV_PROJECT}`, `TRANSLATION_ENGINE=nmt-glossary\r\nTEST_RUNTIME_SERVICE_ACCOUNT=nmt-test-runtime@${DEV_PROJECT}.iam.gserviceaccount.com\r\nLINE_MENTION_ALIASES_JSON=[]\r\n`);
  put('functions/.env.line-auto-translate-bot', 'production-must-not-copy');
  put('functions/lib/old.js', 'stale build must not copy');
  put('functions/node_modules/typescript/bin/tsc', 'fixture');
  put('npm-cli.js', 'fixture');
  put('.local/nmt-auth/gcloud/application_default_credentials.json', '{}');
  put('.local/nmt-auth/firebase/configstore/firebase-tools.json', '{}');
  put('.local/evidence/' + glossaryRecordFile, '{}\r\n');
  put('.local/evidence/unrelated-history.json', 'preserve');
  return {root, out: '.local/dev-deploy/candidate', npmCli: resolve(root, 'npm-cli.js'), put};
}

function compiled(plan) {
  mkdirSync(resolve(plan.output, 'functions/lib'));
  for (const name of ['index.js', 'nmt-controlled-client.js', 'nmt-isolation.js']) writeFileSync(resolve(plan.output, 'functions/lib', name), '// built in isolated package\r\n');
  writeFileSync(resolve(plan.output, '.local/evidence/test-stale-freeze.json'), '{"contractHash":"changed"}\r\n');
}

test('complete package contains root/config/glossary inputs and freshly built entries, without copying production or historical data', t => {
  const options = fixture(t); let calls = 0;
  const result = prepareDevPackage(options, {verify: plan => {calls++; compiled(plan);}});
  assert.equal(calls, 1); assert.equal(result.status, 'verified'); assert.equal(result.deployed, false);
  const stage = result.output;
  for (const path of ['package.json', '.firebaserc', 'firebase.json', 'scripts/check-local.ps1', 'functions/vitest.config.mts', 'functions/config/fixture.txt', 'functions/glossaries/fixture.txt', 'functions/lib/nmt-controlled-client.js']) assert.ok(existsSync(resolve(stage, path)), path);
  for (const path of ['functions/.env.line-auto-translate-bot', 'functions/lib/old.js', '.local/evidence/unrelated-history.json']) assert.equal(existsSync(resolve(stage, path)), false, path);
  assert.equal(validateDevPackage(stage).status, 'verified');
  assert.ok(JSON.parse(readFileSync(resolve(stage, 'dev-package.json'))).files['.local/evidence/test-stale-freeze.json']);
  const launcher = readFileSync(resolve(stage, 'deploy.ps1'));
  assert.equal(launcher.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.doesNotMatch(launcher.toString('utf8'), /(?<!\r)\n/);
  assert.match(launcher.toString('utf8'), /if \(-not \$Execute\)/);
  assert.match(launcher.toString('utf8'), /--validate-package/);
  assert.ok(readFileSync(resolve(stage, '.local/bin/npm.cmd'), 'utf8').includes(process.execPath));
  assert.throws(() => prepareDevPackage(options, {verify: compiled}), /already exists/);
});

test('check-only reports inputs without writing a package or invoking verification', t => {
  const options = fixture(t);
  const result = prepareDevPackage({...options, checkOnly: true}, {verify: () => assert.fail('must not run')});
  assert.equal(result.status, 'preflight-passed'); assert.equal(existsSync(result.output), false);
});

test('missing config, root config and credentials are reported together before creating output', t => {
  const options = fixture(t);
  for (const name of ['functions/config', '.firebaserc', '.local/nmt-auth/gcloud/application_default_credentials.json']) rmSync(resolve(options.root, name), {recursive: true});
  assert.throws(() => prepareDevPackage(options), error => ['functions', '.firebaserc', 'application_default_credentials'].every(word => error.message.includes(word)));
  assert.equal(existsSync(resolve(options.root, options.out)), false);
});

test('failed checks or absent compiled entries leave a failed package that cannot be deployed or overwritten', t => {
  const options = fixture(t);
  assert.throws(() => prepareDevPackage(options, {verify: () => {throw Error('fixture failure');}}), /fixture failure/);
  assert.equal(JSON.parse(readFileSync(resolve(options.root, options.out, 'dev-package.json'))).status, 'failed');
  assert.throws(() => validateDevPackage(resolve(options.root, options.out)), /has not passed/);
  assert.throws(() => prepareDevPackage({...options, out: '.local/dev-deploy/no-build'}, {verify: () => {}}), /Missing compiled/);
});

test('source edits during verification invalidate the package instead of blessing stale evidence', t => {
  const options = fixture(t);
  assert.throws(() => prepareDevPackage(options, {verify: plan => {compiled(plan); options.put('functions/config/fixture.txt', 'changed');}}), /Input changed/);
});

test('new source files during verification invalidate the source snapshot', t => {
  const options = fixture(t);
  assert.throws(() => prepareDevPackage(options, {verify: plan => {compiled(plan); options.put('functions/src/new.txt', 'new source');}}), /file list changed/);
});

test('changed and newly added package files or production dotenv invalidate deployment readiness', t => {
  const options = fixture(t), stage = prepareDevPackage(options, {verify: compiled}).output;
  const target = resolve(stage, 'functions/config/fixture.txt'), original = readFileSync(target);
  writeFileSync(target, 'changed'); assert.throws(() => validateDevPackage(stage), /changed after/); writeFileSync(target, original);
  const added = resolve(stage, 'functions/lib/unreviewed.js'); writeFileSync(added, 'unreviewed'); assert.throws(() => validateDevPackage(stage), /Unexpected inputs/); rmSync(added);
  writeFileSync(resolve(stage, 'functions/.env'), 'unscoped'); assert.throws(() => validateDevPackage(stage), /Unexpected inputs/);
});

test('new root/function configuration files and same-content directory junctions invalidate readiness', t => {
  const options = fixture(t), stage = prepareDevPackage(options, {verify: compiled}).output;
  for (const name of ['.npmrc', 'functions/.npmrc', 'functions/extra.js', 'functions/extra-folder/file.js']) {
    const path = resolve(stage, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, 'unexpected');
    assert.throws(() => validateDevPackage(stage), /Unexpected inputs/, name); rmSync(path);
  }
  const config = resolve(stage, 'functions/config');
  rmSync(config, {recursive: true}); symlinkSync(resolve(options.root, 'functions/config'), config, 'junction');
  assert.throws(() => validateDevPackage(stage), /symlink\/junction/);
});

test('output containment rejects traversal and existing junctions before writing', t => {
  const options = fixture(t);
  for (const out of ['.local', '.local/dev-deploy', '.local/dev-deploy/../../escape']) assert.throws(() => prepareDevPackage({...options, out}), /new child/);
  const target = resolve(options.root, '.local/existing'); mkdirSync(target, {recursive: true}); mkdirSync(resolve(options.root, '.local/dev-deploy'));
  symlinkSync(target, resolve(options.root, '.local/dev-deploy/link'), 'junction');
  assert.throws(() => prepareDevPackage({...options, out: '.local/dev-deploy/link/new'}), /symlink\/junction/);
  assert.equal(existsSync(resolve(target, 'new')), false);
});

test('DEV configuration and existing predeploy protection must remain intact', t => {
  const options = fixture(t);
  assert.throws(() => prepareDevPackage({...options, envFile: 'functions/.env.line-auto-translate-bot'}), /DEV dotenv/);
  options.put('.firebaserc', JSON.stringify({projects: {default: 'line-auto-translate-bot'}}));
  assert.throws(() => prepareDevPackage(options), /Only DEV/);
  options.put('.firebaserc', JSON.stringify({projects: {test: DEV_PROJECT}}));
  options.put('firebase.json', JSON.stringify({functions: [{source: 'functions', predeploy: ['npm run verify']}]}));
  assert.throws(() => prepareDevPackage(options), /predeploy hooks/);
});

test('Firebase deployment diagnostics retain success-plus-failure output without logging token command output', () => {
  const module = new URL('./nmt-local-guard.mjs', import.meta.url).href;
  const script = `import child from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
child.spawnSync = executable => ({status:23,stdout:executable==='firebase'?'Function update succeeded\\n':'secret-token',stderr:'cleanup policy error\\n'});
syncBuiltinESMExports(); const {command}=await import(${JSON.stringify(module)});
for (const executable of ['gcloud','firebase']) {try {command(executable, executable==='firebase'?['deploy']:['auth','print-access-token']);} catch (error) {if(executable==='firebase')process.exitCode=error.exitCode;}}
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 23, result.stderr);
  assert.match(result.stdout, /Function update succeeded/); assert.match(result.stderr, /cleanup policy error/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-token/);
});

test('the actual deployment entry still rejects missing execution authorization before cloud checks', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./nmt-admin.mjs', import.meta.url)), 'deploy', `--project=${DEV_PROJECT}`], {encoding: 'utf8', windowsHide: true});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Review action then pass --execute/);
});

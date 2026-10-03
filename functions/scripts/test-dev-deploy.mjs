import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, dirname, basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareDevPackage, validateDevPackage, DEV_PROJECT} from './prepare-dev-deploy.mjs';
import {glossaryRecordFile} from './nmt-glossary-spec.mjs';
import {devRuntimeConfiguration} from './dev-request-profile.mjs';

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

test('packaging preserves existing mention aliases byte-for-byte and freezes their configuration', t => {
  const options = fixture(t), name = 'functions/.env.' + DEV_PROJECT;
  const original = readFileSync(resolve(options.root, name), 'utf8').replace('LINE_MENTION_ALIASES_JSON=[]',
    'LINE_MENTION_ALIASES_JSON=' + JSON.stringify([
      {alias: 'Wei bro', userId: 'U' + '1'.repeat(32)},
      {alias: 'Wei brother', userId: 'U' + '1'.repeat(32)},
    ]));
  options.put(name, original);
  const before = readFileSync(resolve(options.root, name));
  const preflight = prepareDevPackage({...options, checkOnly: true}, {verify: () => assert.fail('must not run')});
  assert.equal(preflight.status, 'preflight-passed');
  assert.equal(existsSync(preflight.output), false);
  const stage = prepareDevPackage(options, {verify: compiled}).output;
  assert.deepEqual(readFileSync(resolve(options.root, name)), before);
  assert.deepEqual(readFileSync(resolve(stage, name)), before);
  assert.equal(validateDevPackage(stage).status, 'verified');
  writeFileSync(resolve(stage, name), original.replace('"Wei bro"', '"Changed alias"'));
  assert.throws(() => validateDevPackage(stage), /changed after verification/);
});

test('changes to source mention configuration during verification invalidate the package', t => {
  const options = fixture(t), name = 'functions/.env.' + DEV_PROJECT;
  assert.throws(() => prepareDevPackage(options, {verify: plan => {
    compiled(plan);
    options.put(name, readFileSync(resolve(options.root, name), 'utf8').replace('LINE_MENTION_ALIASES_JSON=[]',
      'LINE_MENTION_ALIASES_JSON=[{"alias":"Wei bro","userId":"U' + '1'.repeat(32) + '"}]'));
  }}), /Input changed/);
});

test('the real admin predeploy accepts existing aliases while retaining runtime, ledger and glossary checks offline', t => {
  const options = fixture(t), name = 'functions/.env.' + DEV_PROJECT;
  const configured = readFileSync(resolve(options.root, name), 'utf8').replace('LINE_MENTION_ALIASES_JSON=[]',
    'LINE_MENTION_ALIASES_JSON=[{"alias":"Wei bro","userId":"U' + '1'.repeat(32) + '"}]');
  rmSync(resolve(options.root, 'functions/.env.line-auto-translate-bot'));
  options.put('.local/evidence/admin-glossary.json', '{}');
  const mockSources = {
    './nmt-glossary-spec.mjs': "export const glossaryRecordFile = 'admin-glossary.json';",
    './nmt-glossary-provision.mjs': 'export function provisionNmtGlossaries() { throw Error("unexpected provisioning"); }',
    '../lib/nmt-controlled-client.js': 'export class AuthenticatedNmtTransport {}',
    '../lib/nmt-diagnostics.js': 'export function nmtFailure() { throw Error("unexpected diagnostics"); }',
    '../lib/nmt-isolation.js': 'export const NMT_TEST_PROJECT=' + JSON.stringify(DEV_PROJECT) +
      '; export const NMT_TEST_ACCOUNT="fixture", NMT_RUNTIME_ACCOUNT="nmt-test-runtime@" + NMT_TEST_PROJECT + ".iam.gserviceaccount.com", NMT_GLOSSARIES={}; export function assertNmtIdentity() {}',
    'firebase-admin/app': 'export function initializeApp() { globalThis.checks.push("app"); return {}; }',
    'firebase-admin/firestore': 'export function getFirestore() { return {doc(path) { return {async get() { globalThis.checks.push(path); return {data: () => ({version:2})}; }}; }, async terminate() {globalThis.checks.push("terminated");}}; }',
    '@google-cloud/translate': 'export const v3={};',
    '../lib/nmt-budget.js': 'export const NMT_LEDGER_PATH="ledger", NMT_MIGRATION_PATH="history"; export function initialNmtLedger() {} export function enableTrackingOnlyBudget() {} export function validateNmtLedger(data) {globalThis.checks.push("ledger-validated"); return data;} export function validateNmtPolicyHistory() {globalThis.checks.push("history-validated");}',
    './nmt-local-guard.mjs': 'export const root=' + JSON.stringify(options.root) +
      '; export function command() {throw Error("cloud commands forbidden");} export async function verifyLocalTarget() {globalThis.checks.push("identity"); return {};}' +
      'export async function verifyGlossaries() {globalThis.checks.push("glossaries");} export function validateGlossaryRecords() {} export function canonicalGlossary() {}' +
      'export function requireDeploySession() {globalThis.checks.push("session");} export function requireProjectArgument() {globalThis.checks.push("project");}',
  };
  const script = [
    "import {registerHooks} from 'node:module';",
    'globalThis.checks=[]; const sources=' + JSON.stringify(mockSources) + ';',
    'registerHooks({resolve(specifier, context, nextResolve) {if (Object.hasOwn(sources,specifier)) return {url:"data:text/javascript,"+encodeURIComponent(sources[specifier]),shortCircuit:true}; return nextResolve(specifier,context);}});',
    'process.argv=[process.execPath,"nmt-admin.mjs","deploy-check","--project=' + DEV_PROJECT + '"];',
    'await import(' + JSON.stringify(new URL('./nmt-admin.mjs', import.meta.url).href) + ');',
    'console.log(JSON.stringify(globalThis.checks));',
  ].join('\n');
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', windowsHide: true, env: {...process.env, GCLOUD_PROJECT: DEV_PROJECT},
  });
  options.put(name, configured);
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout), ['project', 'session', 'identity', 'app', 'ledger',
    'ledger-validated', 'history', 'history-validated', 'terminated', 'glossaries']);
  // New profiles retain project/session/identity/ledger checks. Only no-glossary skips glossary resources.
  for (const profile of ['nmt-direct-v1', 'nmt-direct-glossary-v1']) {
    options.put(name, configured.replace('TRANSLATION_ENGINE=nmt-glossary', 'TRANSLATION_ENGINE=nmt-direct\r\nNMT_REQUEST_PROFILE=' + profile));
    const direct = run();
    assert.equal(direct.status, 0, direct.stderr);
    assert.deepEqual(JSON.parse(direct.stdout), ['project', 'session', 'identity', 'app', 'ledger', 'ledger-validated', 'history', 'history-validated', 'terminated', ...(profile === 'nmt-direct-v1' ? [] : ['glossaries'])]);
  }
  for (const changed of [configured.replace('TRANSLATION_ENGINE=nmt-glossary', 'TRANSLATION_ENGINE=business'),
    configured.replace('TEST_RUNTIME_SERVICE_ACCOUNT=nmt-test-runtime@', 'TEST_RUNTIME_SERVICE_ACCOUNT=wrong@')]) {
    options.put(name, changed);
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Test runtime configuration mismatch/);
  }
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

test('trusted direct profiles package without bypassing identity, verification or literal entries', t => {
  for (const profile of ['nmt-direct-v1', 'nmt-direct-glossary-v1']) {
    const options = fixture(t), name = 'functions/.env.' + DEV_PROJECT;
    const configured = readFileSync(resolve(options.root, name), 'utf8').replace('TRANSLATION_ENGINE=nmt-glossary',
      'TRANSLATION_ENGINE=nmt-direct\r\nNMT_REQUEST_PROFILE=' + profile);
    options.put(name, configured);
    let verified = 0;
    const stage = prepareDevPackage(options, {verify: plan => {
      verified++; compiled(plan);
      for (const name of ['nmt-direct-translator.js', 'nmt-literal-policy.js', 'nmt-exact-directives.js', 'nmt-integrity.js', 'nmt-transport-codec.js', 'nmt-request-profile.js']) {
        writeFileSync(resolve(plan.output, 'functions/lib', name), '// synthetic build\r\n');
      }
    }}).output;
    assert.equal(verified, 1);
    assert.equal(validateDevPackage(stage).status, 'verified');
    assert.deepEqual(readFileSync(resolve(stage, name)), readFileSync(resolve(options.root, name)));
    assert.equal(JSON.parse(readFileSync(resolve(stage, 'dev-package.json'))).profile, profile);
    assert.equal(existsSync(resolve(stage, '.local/evidence/' + glossaryRecordFile)), true);
  }
});
test('plain runtime still requires legacy metadata for full offline verification before writing a package', t => {
  const options = fixture(t), name = 'functions/.env.' + DEV_PROJECT;
  options.put(name, readFileSync(resolve(options.root, name), 'utf8').replace('TRANSLATION_ENGINE=nmt-glossary',
    'TRANSLATION_ENGINE=nmt-direct\r\nNMT_REQUEST_PROFILE=nmt-direct-v1'));
  rmSync(resolve(options.root, '.local/evidence/' + glossaryRecordFile));
  assert.throws(() => prepareDevPackage(options, {verify: () => assert.fail('must stop at preflight')}), /Missing file/);
  assert.equal(existsSync(resolve(options.root, options.out)), false);
});

test('direct configuration rejects missing/mismatched profile and duplicate controlled parameters', t => {
  const options = fixture(t), name = 'functions/.env.' + DEV_PROJECT;
  const original = readFileSync(resolve(options.root, name), 'utf8');
  for (const text of [
    original.replace('TRANSLATION_ENGINE=nmt-glossary', 'TRANSLATION_ENGINE=nmt-direct'),
    original + 'NMT_REQUEST_PROFILE=nmt-direct-v1\r\n',
    original + 'TRANSLATION_ENGINE=google\r\n',
    original + 'TEST_RUNTIME_SERVICE_ACCOUNT=wrong\r\n',
  ]) {
    options.put(name, text);
    assert.throws(() => prepareDevPackage({...options, checkOnly: true}), /runtime configuration|deployment contract/);
    assert.equal(existsSync(resolve(options.root, options.out)), false);
  }
});

test('direct package requires the explicit directive module even when all other entries were built', t => {
  const options = fixture(t), name = 'functions/.env.' + DEV_PROJECT;
  options.put(name, readFileSync(resolve(options.root, name), 'utf8').replace('TRANSLATION_ENGINE=nmt-glossary',
    'TRANSLATION_ENGINE=nmt-direct\r\nNMT_REQUEST_PROFILE=nmt-direct-v1'));
  assert.throws(() => prepareDevPackage(options, {verify: plan => {
    compiled(plan);
    for (const name of ['nmt-direct-translator.js', 'nmt-literal-policy.js', 'nmt-integrity.js', 'nmt-transport-codec.js', 'nmt-request-profile.js']) {
      writeFileSync(resolve(plan.output, 'functions/lib', name), '// synthetic build\r\n');
    }
  }}), /Missing compiled deployment entry: lib\/nmt-exact-directives\.js/);
  assert.equal(JSON.parse(readFileSync(resolve(options.root, options.out, 'dev-package.json'))).status, 'failed');
});

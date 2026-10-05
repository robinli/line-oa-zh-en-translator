import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {delimiter, dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {glossaryRecordFile} from './nmt-glossary-spec.mjs';
import {devRuntimeConfiguration} from './dev-request-profile.mjs';

export const DEV_PROJECT = 'line-auto-translate-bot-dev';
const rootFiles = ['package.json', 'firebase.json', '.firebaserc', 'scripts/check-local.ps1'];
const functionFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.mts'];
const sourceDirectories = ['src', 'scripts', 'evaluation', 'glossaries', 'config'];
const builtEntries = ['index.js', 'nmt-controlled-client.js', 'nmt-content-capture.js', 'nmt-isolation.js'];
const stateFile = 'dev-package.json';
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const text = (path, value) => writeFileSync(path, value.replace(/\r?\n/g, '\r\n'), 'utf8');
const json = (path, value) => text(path, JSON.stringify(value, null, 2) + '\n');
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const present = path => {try {lstatSync(path); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}};
const inside = (parent, path) => {const rel = relative(parent, path); return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);};

function walk(directory, prefix = '') {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name), info = lstatSync(path), key = prefix + name;
    if (info.isSymbolicLink()) throw Error(`Source links are not allowed: ${key}`);
    if (/^(?:\.env|\.secret)(?:\.|$)/.test(name) || name === '.local' || name === 'node_modules') throw Error(`Unexpected private/generated input: ${key}`);
    if (info.isDirectory()) result.push(...walk(path, key + '/'));
    else if (info.isFile()) result.push(key);
    else throw Error(`Unsupported input: ${key}`);
  }
  return result;
}

function outputPath(root, output) {
  const base = resolve(root, '.local/dev-deploy'), target = resolve(root, output);
  if (!inside(base, target)) throw Error('Output must be a new child of .local/dev-deploy/');
  for (let path = target; path !== root; path = dirname(path)) {
    if (present(path) && lstatSync(path).isSymbolicLink()) throw Error('Output cannot traverse a symlink/junction');
    if (process.platform === 'win32') {
      const name = path.slice(dirname(path).length + 1);
      if (/[. ]$|:|^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw Error('Ambiguous Windows output path');
    }
  }
  if (present(target)) throw Error('Output already exists; choose a new candidate directory');
  return target;
}

export function preflightDevPackage(options) {
  const root = realpathSync(options.root), output = outputPath(root, options.out);
  const envFile = resolve(root, options.envFile ?? `functions/.env.${DEV_PROJECT}`);
  const authDir = resolve(root, options.authDir ?? '.local/nmt-auth');
  const evidenceDir = resolve(root, options.evidenceDir ?? '.local/evidence');
  const npmCli = options.npmCli ?? process.env.npm_execpath;
  const errors = [];
  const requirePath = (path, directory = false) => {
    if (!existsSync(path) || (directory ? !lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() : !lstatSync(path).isFile())) errors.push(`Missing ${directory ? 'directory' : 'file'}: ${path}`);
  };
  if (process.versions.node.split('.')[0] !== '22') errors.push('Node.js 22 is required; run npm with the Node 22 runtime');
  for (const name of rootFiles) requirePath(resolve(root, name));
  for (const name of functionFiles) requirePath(resolve(root, 'functions', name));
  for (const name of sourceDirectories) requirePath(resolve(root, 'functions', name), true);
  requirePath(resolve(root, 'functions/node_modules/typescript/bin/tsc'));
  requirePath(envFile);
  requirePath(resolve(authDir, 'gcloud/application_default_credentials.json'));
  requirePath(resolve(authDir, 'firebase/configstore/firebase-tools.json'));
  let configuration;
  if (existsSync(envFile)) {
    try {configuration = devRuntimeConfiguration(readFileSync(envFile, 'utf8'));}
    catch (error) {errors.push('DEV dotenv does not match the existing deployment contract: ' + error.message);}
  }
  // Full offline verification includes archived glossary-contract tools for every runtime profile.
  // This metadata is a verification input; it does not enable glossary requests in the plain runtime.
  requirePath(resolve(evidenceDir, glossaryRecordFile));
  if (npmCli) requirePath(npmCli); else errors.push('npm CLI is required: run via npm run prepare:dev or supply --npm-cli=PATH');
  if (errors.length) throw Error('DEV package preflight failed:\n' + errors.join('\n'));
  if (!inside(root, envFile) || !envFile.endsWith(`.env.${DEV_PROJECT}`)) throw Error('Use an explicit project-local DEV dotenv file');
  // Preserve existing mention aliases verbatim; packaging only validates controlled parameters.
  const aliases = Object.values(readJson(resolve(root, '.firebaserc')).projects ?? {});
  if (!aliases.length || aliases.some(value => value !== DEV_PROJECT)) throw Error('Only DEV Firebase aliases are allowed in this package');
  const firebase = readJson(resolve(root, 'firebase.json'));
  if (firebase.functions?.length !== 1 || firebase.functions[0].source !== 'functions') throw Error('Expected the existing single functions source');
  const hooks = firebase.functions[0].predeploy ?? [];
  if (!hooks.some(value => value.includes('nmt-admin.mjs') && value.includes('deploy-check') && value.includes(`--project=${DEV_PROJECT}`)) || !hooks.some(value => value.includes('run verify'))) throw Error('Existing identity and verification predeploy hooks are required');
  const files = [...rootFiles, ...functionFiles.map(name => `functions/${name}`)];
  for (const name of sourceDirectories) {
    const directory = resolve(root, 'functions', name);
    if (lstatSync(directory).isSymbolicLink()) throw Error(`Source links are not allowed: functions/${name}`);
    files.push(...walk(directory, `functions/${name}/`));
  }
  for (const name of files) if (lstatSync(resolve(root, name)).isSymbolicLink()) throw Error(`Source links are not allowed: ${name}`);
  return {root, output, envFile, authDir: realpathSync(authDir), evidenceDir: realpathSync(evidenceDir), configuration, npmCli: resolve(npmCli), files: files.sort()};
}

function runVerify(plan) {
  const result = spawnSync(process.execPath, [plan.npmCli, '--prefix', resolve(plan.output, 'functions'), 'run', 'verify'], {
    cwd: plan.output, encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    env: {...process.env, PATH: dirname(process.execPath) + delimiter + process.env.PATH},
  });
  text(resolve(plan.output, 'verify.log'), (result.stdout ?? '') + '\n' + (result.stderr ?? ''));
  if (result.error || result.status !== 0) throw Error('Offline verification failed; see verify.log. Package is not ready; no deployment was attempted');
}

const ps = value => "'" + value.replace(/'/g, "''") + "'";
function deploymentLauncher(plan) {
  const bin = resolve(plan.output, '.local/bin');
  mkdirSync(bin);
  // Firebase predeploy invokes npm.cmd on Windows; pin that shim to the same Node 22.
  text(resolve(bin, 'npm.cmd'), `@echo off\n"${process.execPath.replace(/%/g, '%%')}" "${plan.npmCli.replace(/%/g, '%%')}" %*\nexit /b %errorlevel%\n`);
  const body = `param([switch]$Execute)
$ErrorActionPreference = 'Stop'
if (-not $Execute) { Write-Output 'Prepared DEV package only. Use -Execute only when DEV deployment is authorized.'; exit 0 }
$devNode = ${ps(process.execPath)}
& $devNode (Join-Path $PSScriptRoot 'functions/scripts/prepare-dev-deploy.mjs') "--validate-package=$PSScriptRoot"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:PATH = (Join-Path $PSScriptRoot '.local/bin') + ';' + (Split-Path -Parent $devNode) + ';' + $env:PATH
$env:CLOUDSDK_CONFIG = Join-Path $PSScriptRoot '.local/nmt-auth/gcloud'
$env:GOOGLE_APPLICATION_CREDENTIALS = Join-Path $env:CLOUDSDK_CONFIG 'application_default_credentials.json'
$env:XDG_CONFIG_HOME = Join-Path $PSScriptRoot '.local/nmt-auth/firebase'
# Windows PowerShell 5.1 represents redirected native stderr as ErrorRecord.
# Retain diagnostics and the native exit code before restoring strict errors.
$ErrorActionPreference = 'Continue'
& $devNode (Join-Path $PSScriptRoot 'functions/scripts/nmt-admin.mjs') deploy --project=${DEV_PROJECT} --execute *> (Join-Path $PSScriptRoot 'deploy.log')
$devExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deploy.log') -Tail 30
exit $devExit
`;
  text(resolve(plan.output, 'deploy.ps1'), '\uFEFF' + body);
}

export function prepareDevPackage(options, {verify = runVerify} = {}) {
  const plan = preflightDevPackage(options);
  if (options.checkOnly) return {status: 'preflight-passed', output: plan.output, files: plan.files.length, deployed: false};
  const before = Object.fromEntries(plan.files.map(name => [name, sha(resolve(plan.root, name))]));
  const privateInputs = {
    [`functions/.env.${DEV_PROJECT}`]: plan.envFile,
    [`.local/evidence/${glossaryRecordFile}`]: resolve(plan.evidenceDir, glossaryRecordFile),
  };
  const inputHashes = Object.fromEntries(Object.entries(privateInputs).map(([name, path]) => [name, sha(path)]));
  mkdirSync(dirname(plan.output), {recursive: true});
  mkdirSync(plan.output); // No overwrite/resume of an old or partially built candidate.
  const state = {version: 1, project: DEV_PROJECT, profile: plan.configuration.profile, status: 'preparing', node: process.version, deployed: false};
  json(resolve(plan.output, stateFile), state);
  try {
    mkdirSync(resolve(plan.output, '.local/evidence'), {recursive: true});
    for (const [name, source] of [...plan.files.map(name => [name, resolve(plan.root, name)]), ...Object.entries(privateInputs)]) {
      const target = resolve(plan.output, name); mkdirSync(dirname(target), {recursive: true}); copyFileSync(source, target);
    }
    symlinkSync(realpathSync(resolve(plan.root, 'functions/node_modules')), resolve(plan.output, 'functions/node_modules'), 'junction');
    symlinkSync(plan.authDir, resolve(plan.output, '.local/nmt-auth'), 'junction');
    verify(plan);
    const currentSources = [...rootFiles, ...functionFiles.map(name => `functions/${name}`)];
    for (const dir of sourceDirectories) currentSources.push(...walk(resolve(plan.root, 'functions', dir), `functions/${dir}/`));
    if (JSON.stringify(currentSources.sort()) !== JSON.stringify(plan.files)) throw Error('Input file list changed during preparation');
    for (const [name, hash] of Object.entries({...before, ...inputHashes})) {
      if (sha(resolve(plan.output, name)) !== hash || sha(privateInputs[name] ?? resolve(plan.root, name)) !== hash) throw Error(`Input changed during preparation: ${name}`);
    }
    const requiredBuilt = [...builtEntries, ...(plan.configuration.engine === 'nmt-direct' ? ['nmt-direct-translator.js', 'nmt-literal-policy.js', 'nmt-exact-directives.js', 'nmt-integrity.js', 'nmt-transport-codec.js', 'nmt-request-profile.js'] : [])];
    for (const name of requiredBuilt) if (!existsSync(resolve(plan.output, 'functions/lib', name))) throw Error(`Missing compiled deployment entry: lib/${name}`);
    deploymentLauncher(plan);
    const files = {...before, ...inputHashes};
    for (const name of walk(resolve(plan.output, 'functions/lib'), 'functions/lib/')) files[name] = sha(resolve(plan.output, name));
    // Existing offline tools retain synthetic evidence; freeze those new package-local files too.
    for (const name of walk(resolve(plan.output, '.local/evidence'), '.local/evidence/')) files[name] = sha(resolve(plan.output, name));
    for (const name of ['deploy.ps1', '.local/bin/npm.cmd']) files[name] = sha(resolve(plan.output, name));
    Object.assign(state, {status: 'verified', completedAt: new Date().toISOString(), files, links: {
      'functions/node_modules': realpathSync(resolve(plan.root, 'functions/node_modules')), '.local/nmt-auth': plan.authDir,
    }});
    json(resolve(plan.output, stateFile), state);
    validateDevPackage(plan.output);
    return {status: state.status, output: plan.output, files: Object.keys(files).length, deployed: false};
  } catch (error) {
    json(resolve(plan.output, stateFile), {...state, status: 'failed'});
    throw error;
  }
}

function packageFiles(directory, links, prefix = '') {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const key = prefix + name, path = resolve(directory, name), info = lstatSync(path);
    if (Object.hasOwn(links, key)) {
      if (!info.isSymbolicLink() || realpathSync(path) !== links[key]) throw Error(`Package dependency/auth link changed: ${key}`);
      continue;
    }
    if (info.isSymbolicLink()) throw Error(`Unexpected package symlink/junction: ${key}`);
    if (info.isDirectory()) files.push(...packageFiles(path, links, key + '/'));
    else if (info.isFile()) {
      // Only these root status/log files may change during verification/deployment.
      if (![stateFile, 'verify.log', 'deploy.log'].includes(key)) files.push(key);
    } else throw Error(`Unsupported package input: ${key}`);
  }
  return files;
}

export function validateDevPackage(directory) {
  const output = resolve(directory), state = readJson(resolve(output, stateFile));
  if (state.project !== DEV_PROJECT || state.status !== 'verified' || !state.files || !Object.keys(state.files).length) throw Error('Package has not passed offline verification');
  for (const [name, hash] of Object.entries(state.files)) {
    const file = resolve(output, name);
    if (!inside(output, file) || !existsSync(file) || sha(file) !== hash) throw Error(`Package changed after verification: ${name}`);
  }
  for (const [name, target] of Object.entries(state.links ?? {})) {
    if (!inside(output, resolve(output, name)) || realpathSync(resolve(output, name)) !== target) throw Error(`Package dependency/auth link changed: ${name}`);
  }
  // Inspect the whole package: root-level JS/.npmrc and junctions can affect predeploy too.
  const actual = packageFiles(output, state.links ?? {}).sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(state.files).sort())) throw Error('Unexpected inputs added after verification');
  return {status: 'verified', project: DEV_PROJECT, files: Object.keys(state.files).length, deployed: false};
}

function main(args) {
  if (args.length === 1 && args[0].startsWith('--validate-package=')) return validateDevPackage(args[0].slice('--validate-package='.length));
  if (args.includes('--help')) return {usage: 'npm run prepare:dev -- --out=.local/dev-deploy/NAME [--env-file=PATH --auth-dir=PATH --evidence-dir=PATH] [--check-only]', note: 'Offline verification only; deployment remains a separate authorized action.'};
  const options = {root: resolve(dirname(fileURLToPath(import.meta.url)), '../..')};
  for (const arg of args) {
    if (arg === '--check-only') {options.checkOnly = true; continue;}
    const match = /^--(out|env-file|auth-dir|evidence-dir|npm-cli)=(.+)$/.exec(arg);
    if (!match) throw Error('Unknown or incomplete argument: ' + arg);
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (Object.hasOwn(options, key)) throw Error('Duplicate argument: ' + match[1]);
    options[key] = match[2];
  }
  if (!options.out) throw Error('Specify a new --out=.local/dev-deploy/NAME');
  return prepareDevPackage(options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));}
  catch (error) {console.error(error.message); process.exitCode = 1;}
}

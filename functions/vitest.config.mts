import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {defineConfig} from 'vitest/config';
import type {Reporter} from 'vitest/reporters';

const root = fileURLToPath(new URL('.', import.meta.url));
const requested: unknown = process.env.LINE_OA_TEST_FILES_JSON ? JSON.parse(process.env.LINE_OA_TEST_FILES_JSON) : null;
if (requested !== null && (!Array.isArray(requested) || !requested.length || requested.some(value => typeof value !== 'string'))) {
  throw new Error('Targeted selection must contain existing test-file paths.');
}
const paths = requested === null ? null : [...new Set((requested as string[]).map(value => realpathSync(resolve(root, value))))];
const relativePaths = paths?.map(path => relative(root, path).replace(/\\/g, '/'));
if (relativePaths?.some(path => !path.startsWith('src/') || /(^|\/)(node_modules|\.local|lib|coverage)(\/|$)/.test(path))) {
  throw new Error('Targeted selection must stay inside current functions/src.');
}
const identity = (path: string) => {
  const value = realpathSync(path).replace(/\\/g, '/');
  return process.platform === 'win32' ? value.toLowerCase() : value;
};
const executionGuard: Reporter = {
  onTestRunStart(specifications) {
    if (!paths) return;
    const expected = new Set(paths.map(identity));
    const actual = new Set(specifications.map(item => identity(item.moduleId)));
    if (actual.size !== expected.size || [...actual].some(path => !expected.has(path))) {
      throw new Error('Collected tests do not match the exact requested file set.');
    }
  },
  onTestRunEnd(modules) {
    const executed = modules.reduce((count, module) => count + [...module.children.allTests()].filter(test => ['passed', 'failed'].includes(test.result().state)).length, 0);
    if (executed === 0) throw new Error('No tests executed; skipped/todo tests do not count as verification.');
  },
};

export default defineConfig({
  root,
  test: {
    // Escape glob syntax in literal file names instead of using CLI substring filters.
    include: relativePaths?.map(path => path.replace(/([()[\]{}*?!+@|])/g, '\\$1')) ?? ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/.local/**', '**/lib/**', '**/coverage/**'],
    passWithNoTests: false,
    reporters: ['default', executionGuard],
  },
});

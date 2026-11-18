import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const find = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const location = join(dir, entry.name);
  if (entry.isDirectory()) return find(location);
  return entry.name.endsWith('.test.mjs') && entry.name !== 'recordings.test.mjs' ? [location] : [];
});
const files = [...find(join(root, 'test-node')), ...find(join(root, 'src'))].sort();
if (files.length === 0) throw new Error('No native node:test files found');
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? files(target) : target.endsWith('.js') ? [target] : [];
  });
}

const targets = [
  ...files(path.join(backendRoot, 'src')),
  ...files(path.join(backendRoot, 'scripts')),
].filter((file) => !file.endsWith('check-syntax.js'));

for (const file of targets) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`${targets.length} JavaScript-Dateien syntaktisch geprueft.`);

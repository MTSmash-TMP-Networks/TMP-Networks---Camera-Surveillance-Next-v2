import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { scanSessionBlocks } from '../src/services/recording/BlockArchive.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (name) => readFileSync(resolve(root, name), 'utf8');

test('block scanner accepts missing session directories without failing the backend', () => {
  const dir = path.join(os.tmpdir(), 'non-existent-recording-' + process.pid);
  assert.deepEqual(scanSessionBlocks(dir), []);
});

test('block scanner tolerates a file finalized between readdir and stat', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-scan-race-'));
  const partial = path.join(dir, 'block-000001.ts.partial');
  const finished = path.join(dir, 'block-000001.ts');
  fs.writeFileSync(partial, Buffer.alloc(1880, 1));
  const realStat = fs.statSync;
  let raced = false;
  try {
    fs.statSync = function(file, ...args) {
      if (String(file) === partial && !raced) {
        raced = true;
        fs.renameSync(partial, finished);
      }
      return realStat.call(this, file, ...args);
    };
    assert.deepEqual(scanSessionBlocks(dir), []);
    assert.equal(raced, true);
  } finally {
    fs.statSync = realStat;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recording watchdog catches unexpected disk errors and limits overlapping finalizations', () => {
  const recording = source('backend/src/services/RecordingService.js');
  assert.match(recording, /RECORDING_WATCHDOG_SCAN_FAILED/);
  assert.match(recording, /watchdogCommitPending/);
  assert.match(recording, /kioskActiveList\(\)/);
  assert.doesNotMatch(recording.match(/kioskActiveList\(\) \{[\s\S]*?\n  \}/)?.[0] || '', /recordingRepository\./);
});

test('kiosk uses lightweight states and tolerates transient heartbeat failures', () => {
  const route = source('backend/src/routes/recordings.js');
  const frontend = source('frontend/src/pages/KioskPage.jsx');
  const api = source('frontend/src/services/api.js');
  assert.match(route, /recordingService\.kioskActiveList\(\)/);
  assert.match(api, /kioskStatus: \(\) => request\('\/recordings\/kiosk\/status', \{ cache: 'no-store', timeoutMs: 5000 \}\)/);
  assert.match(frontend, /kioskStatusFailures\.current >= 3/);
  assert.match(frontend, /window\.setInterval\(loadRuntimeStatus, 3500\)/);
});

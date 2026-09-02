import test from 'node:test';
import assert from 'node:assert/strict';
import { collectContainerStatus, normalizeContainerSet } from '../src/containerStatus.js';

function inspect(service, state = {}, overrides = {}) {
  return {
    Id: `${service}-container-id-1234567890`,
    Name: `/${service}-1`,
    RestartCount: overrides.RestartCount || 0,
    Config: { Image: overrides.image || `tmp/${service}:latest`, Labels: { 'com.docker.compose.service': service, 'com.docker.compose.project': overrides.project || 'tmp-camera' } },
    State: {
      Status: state.Status || 'running',
      Running: state.Running ?? true,
      Paused: false,
      Restarting: state.Restarting || false,
      OOMKilled: state.OOMKilled || false,
      Dead: state.Dead || false,
      ExitCode: state.ExitCode || 0,
      StartedAt: state.StartedAt || '2026-08-06T12:00:00.000Z',
      FinishedAt: state.FinishedAt || '0001-01-01T00:00:00Z',
      Health: state.Health,
    },
  };
}

test('normalisiert laufende, gesunde und fehlende Compose-Dienste', () => {
  const result = normalizeContainerSet([
    inspect('updater', { Health: { Status: 'healthy', FailingStreak: 0, Log: [] } }),
    inspect('backend'),
    inspect('mediamtx'),
  ], { composeProjectName: 'tmp-camera', now: Date.parse('2026-08-06T12:10:00.000Z') });
  assert.equal(result.status, 'critical');
  assert.equal(result.items.find((item) => item.service === 'updater').status, 'healthy');
  assert.equal(result.items.find((item) => item.service === 'backend').uptimeSeconds, 600);
  assert.equal(result.items.find((item) => item.service === 'frontend').status, 'missing');
  assert.equal(result.summary.running, 3);
  assert.equal(result.summary.missing, 1);
});

test('bevorzugt während eines Updates den laufenden Container eines Dienstes', () => {
  const stopped = inspect('backend', { Status: 'exited', Running: false, ExitCode: 1, FinishedAt: '2026-08-06T12:09:00.000Z' });
  stopped.Name = '/backend-old';
  const running = inspect('backend', { Status: 'running', Running: true, StartedAt: '2026-08-06T12:09:30.000Z' });
  running.Name = '/backend-new';
  const result = normalizeContainerSet([stopped, running, inspect('updater'), inspect('mediamtx'), inspect('frontend')], { now: Date.parse('2026-08-06T12:10:00.000Z') });
  assert.equal(result.status, 'ok');
  assert.equal(result.items.find((item) => item.service === 'backend').name, 'backend-new');
});

test('liest Container über die Docker-Engine und begrenzt die Ausgabe auf das Compose-Projekt', async () => {
  const calls = [];
  const executeDocker = async (args) => {
    calls.push(args);
    if (args[0] === 'ps') return { stdout: 'abc\ndef\n' };
    return { stdout: JSON.stringify([inspect('updater'), inspect('backend'), inspect('mediamtx'), inspect('frontend')]) };
  };
  const result = await collectContainerStatus({ executeDocker, composeProjectName: 'tmp-camera', now: Date.parse('2026-08-06T12:10:00.000Z') });
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls[0].slice(0, 4), ['ps', '-a', '--filter', 'label=com.docker.compose.project=tmp-camera']);
  assert.deepEqual(calls[1], ['inspect', 'abc', 'def']);
});


test('findet das aktive Compose-Projekt über Service-Labels wenn der konfigurierte Projektname abweicht', async () => {
  const calls = [];
  const active = [
    inspect('updater', {}, { project: 'directory-project' }),
    inspect('backend', {}, { project: 'directory-project' }),
    inspect('mediamtx', {}, { project: 'directory-project' }),
    inspect('frontend', {}, { project: 'directory-project' }),
  ];
  active[0].Id = 'runtime-updater-abcdef1234567890';
  const executeDocker = async (args) => {
    calls.push(args);
    if (args[0] === 'inspect') return { stdout: JSON.stringify(active) };
    if (String(args.find((item) => item.startsWith?.('label=com.docker.compose.project=')) || '').includes('wrong-project')) return { stdout: '' };
    const serviceFilter = args.find((item) => item.startsWith?.('label=com.docker.compose.service='));
    const service = serviceFilter?.split('=').at(-1);
    const match = active.find((item) => item.Config.Labels['com.docker.compose.service'] === service);
    return { stdout: match ? `${match.Id}\n` : '' };
  };
  const result = await collectContainerStatus({
    executeDocker,
    composeProjectName: 'wrong-project',
    currentContainerId: 'runtime-updater',
    now: Date.parse('2026-08-06T12:10:00.000Z'),
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.project, 'directory-project');
  assert.equal(result.summary.running, 4);
  assert.ok(calls.some((args) => args.includes('label=com.docker.compose.service=updater')));
});

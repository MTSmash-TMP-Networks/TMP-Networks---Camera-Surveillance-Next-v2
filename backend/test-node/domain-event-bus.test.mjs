import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainEventBus } from '../src/services/events/DomainEventBus.js';

test('domain events are bounded, ordered and redact secret-like fields', () => {
  const bus = new DomainEventBus({ limit: 100 });
  try {
    for (let index = 0; index < 120; index += 1) {
      bus.publish('camera.test', {
        index,
        password: 'do-not-leak',
        nested: { streamUrl: 'rtsp://user:password@example.invalid/live', label: 'safe' },
      });
    }
    const events = bus.recent({ after: 0, limit: 1000 });
    assert.equal(events.length, 100);
    assert.equal(events[0].sequence, 21);
    assert.equal(events.at(-1).sequence, 120);
    assert.equal(events[0].payload.password, '[REDACTED]');
    assert.equal(events[0].payload.nested.streamUrl, '[REDACTED]');
    assert.equal(events[0].payload.nested.label, 'safe');
  } finally { bus.shutdown(); }
});

test('domain event role defaults fail closed and shutdown rejects new events', () => {
  const bus = new DomainEventBus({ limit: 100 });
  const event = bus.publish('security.test', { ok: true }, { minRole: 'unknown-role' });
  assert.equal(event.minRole, 'admin');
  bus.shutdown();
  assert.equal(bus.publish('after.shutdown'), null);
  assert.deepEqual(bus.recent(), []);
});

import { describe, expect, it, vi } from 'vitest';
import { runStreamCleanup } from './asyncCleanup.js';

describe('Stream-Aufräumlogik', () => {
  it('akzeptiert synchrone und asynchrone Teardown-Funktionen', async () => {
    const sync = vi.fn();
    const asyncCleanup = vi.fn(async () => {});
    await expect(runStreamCleanup(sync)).resolves.toBeUndefined();
    await expect(runStreamCleanup(asyncCleanup)).resolves.toBeUndefined();
    expect(sync).toHaveBeenCalledOnce();
    expect(asyncCleanup).toHaveBeenCalledOnce();
  });

  it('lässt einen Teardown-Fehler die Reconnect-Logik nicht blockieren', async () => {
    await expect(runStreamCleanup(() => { throw new Error('teardown'); })).resolves.toBeUndefined();
    await expect(runStreamCleanup(async () => { throw new Error('async teardown'); })).resolves.toBeUndefined();
  });
});

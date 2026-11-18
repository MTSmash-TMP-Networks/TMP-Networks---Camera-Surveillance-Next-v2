import { describe, expect, it } from 'vitest';
import { createKioskThumbnailLoader } from './kioskThumbnailLoader.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('kiosk thumbnail loader', () => {
  it('fetches at most two snapshots at once, once per camera, and frees object URLs', async () => {
    const pending = new Map();
    const updated = [];
    const revoked = [];
    let inFlight = 0;
    let peak = 0;
    const loader = createKioskThumbnailLoader({
      load: (id) => new Promise((resolve) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        pending.set(id, (blob) => { inFlight -= 1; resolve(blob); });
      }),
      createUrl: (blob) => `blob:${blob}`,
      revokeUrl: (url) => revoked.push(url),
      onUpdate: (id, url) => updated.push([id, url]),
    });
    for (const id of ['a', 'b', 'c', 'd', 'a']) loader.request(id);
    await settle();
    expect(peak).toBe(2);
    expect(pending.size).toBe(2);
    pending.get('a')('image-a');
    pending.get('b')('image-b');
    await settle();
    expect(peak).toBe(2);
    expect(pending.has('c')).toBe(true);
    expect(pending.has('d')).toBe(true);
    pending.get('c')('image-c');
    pending.get('d')('image-d');
    await settle();
    expect(updated).toHaveLength(4);
    loader.request('a');
    await settle();
    expect(updated).toHaveLength(4);
    loader.dispose();
    expect(revoked).toEqual(expect.arrayContaining(['blob:image-a', 'blob:image-b', 'blob:image-c', 'blob:image-d']));
  });

  it('aborts pending work on close and never publishes late images', async () => {
    let complete;
    let receivedSignal;
    const updated = [];
    const loader = createKioskThumbnailLoader({
      load: (_id, signal) => {
        receivedSignal = signal;
        return new Promise((resolve) => { complete = resolve; });
      },
      createUrl: () => 'blob:too-late',
      revokeUrl: () => {},
      onUpdate: (...args) => updated.push(args),
    });
    loader.request('offline-camera');
    await settle();
    loader.dispose();
    expect(receivedSignal.aborted).toBe(true);
    complete('late');
    await settle();
    expect(updated).toHaveLength(0);
  });
});

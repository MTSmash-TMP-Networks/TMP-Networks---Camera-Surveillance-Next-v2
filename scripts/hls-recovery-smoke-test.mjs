import { readFile } from 'node:fs/promises';

class FakeVideo {
  constructor() {
    this.listeners = new Map();
    this.paused = false;
    this.readyState = 3;
    this.currentTime = 0;
    this.seekable = { length: 0 };
  }
  addEventListener(name, fn) {
    const list = this.listeners.get(name) || [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  removeEventListener(name, fn) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== fn));
  }
  dispatch(name) {
    for (const fn of this.listeners.get(name) || []) fn();
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  removeAttribute() {}
  load() {}
  canPlayType() { return ''; }
}

class FakeHls {
  static instances = [];
  static Events = {
    MEDIA_ATTACHED: 'media-attached',
    MANIFEST_PARSED: 'manifest-parsed',
    FRAG_BUFFERED: 'frag-buffered',
    ERROR: 'error',
  };
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  static isSupported() { return true; }
  constructor(config) {
    this.config = config;
    this.handlers = new Map();
    this.startLoadCount = 0;
    this.recoverCount = 0;
    this.swapCount = 0;
    this.liveSyncPosition = 12;
    FakeHls.instances.push(this);
  }
  on(name, fn) { this.handlers.set(name, fn); }
  emit(name, data = {}) { this.handlers.get(name)?.(name, data); }
  attachMedia(video) { this.video = video; queueMicrotask(() => this.emit(FakeHls.Events.MEDIA_ATTACHED)); }
  loadSource(url) { this.source = url; }
  startLoad() { this.startLoadCount += 1; }
  stopLoad() {}
  recoverMediaError() { this.recoverCount += 1; }
  swapAudioCodec() { this.swapCount += 1; }
  destroy() { this.destroyed = true; }
}

globalThis.__FakeHls = FakeHls;
globalThis.window = { location: { origin: 'http://localhost' } };

const file = process.argv[2] || new URL('../frontend/src/services/hlsPlayer.js', import.meta.url);
let source = await readFile(file, 'utf8');
source = source.replace("import Hls from 'hls.js';", 'const Hls = globalThis.__FakeHls;');
source = source.replace('const RECOVERY_WATCHDOG_MS = 8000;', 'const RECOVERY_WATCHDOG_MS = 60;');
source = source.replace('const WAITING_GRACE_MS = 3000;', 'const WAITING_GRACE_MS = 10;');
source = source.replace('Math.min(250 * networkRecoveries, 750)', '5');
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const states = [];
const video = new FakeVideo();
const cleanup = mod.connectHls({
  url: '/live-hls/test/index.m3u8',
  tokenRef: { current: '' },
  video,
  onState: (state, details = {}) => states.push({ state, details }),
});
await new Promise((resolve) => setTimeout(resolve, 0));
const hls = FakeHls.instances.at(-1);
hls.emit(FakeHls.Events.MANIFEST_PARSED);
if (!states.some((item) => item.state === 'connected')) throw new Error('initial connection was not reported');

hls.emit(FakeHls.Events.ERROR, { fatal: true, type: FakeHls.ErrorTypes.NETWORK_ERROR, details: 'fragLoadError' });
await new Promise((resolve) => setTimeout(resolve, 15));
if (hls.startLoadCount < 1) throw new Error('network recovery did not resume loading');
if (!states.some((item) => item.state === 'recovering')) throw new Error('network recovery was not started');
hls.emit(FakeHls.Events.FRAG_BUFFERED);
video.dispatch('playing');
if (!states.some((item) => item.state === 'connected' && item.details.recovered)) throw new Error('successful recovery was not reported');

hls.emit(FakeHls.Events.ERROR, { fatal: true, type: FakeHls.ErrorTypes.NETWORK_ERROR, details: 'manifestLoadError' });
await new Promise((resolve) => setTimeout(resolve, 90));
if (!states.some((item) => item.state === 'failed' && item.details.recoveryTimedOut)) throw new Error('recovery timeout did not escalate to failed');

cleanup();
if (!hls.destroyed) throw new Error('cleanup did not destroy hls');
console.log(JSON.stringify({ ok: true, states: states.map((item) => item.state), startLoadCount: hls.startLoadCount }));

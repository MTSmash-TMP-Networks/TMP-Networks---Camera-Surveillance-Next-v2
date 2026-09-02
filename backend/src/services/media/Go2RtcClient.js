import { config } from '../../config.js';

const APP_API_PREFIX = '/media/go2rtc';

function normalizeName(name) {
  return String(name || '').replace(/^\/+/, '').trim();
}

function streamName(item, fallback = null) {
  return item?.name || item?.path || item?.src || item?.key || fallback || null;
}

function streamReady(item) {
  if (!item) return false;
  if (item.ready === true || item.online === true) return true;
  if (Array.isArray(item.tracks) && item.tracks.length > 0) return true;
  if (Array.isArray(item.producers) && item.producers.length > 0) return true;
  if (Number(item.producer) > 0 || Number(item.producersCount) > 0) return true;
  return false;
}

function normalizeStreamsPayload(payload, requestedName = null) {
  const map = new Map();
  if (!payload) return map;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const name = streamName(item, requestedName);
      if (name) map.set(name, item);
    }
    return map;
  }

  if (requestedName && (payload.producers || payload.consumers || payload.tracks || payload.ready !== undefined)) {
    map.set(requestedName, { ...payload, name: requestedName });
    return map;
  }

  const items = Array.isArray(payload.items) ? payload.items : null;
  if (items) {
    for (const item of items) {
      const name = streamName(item, requestedName);
      if (name) map.set(name, item);
    }
    return map;
  }

  for (const [name, item] of Object.entries(payload)) {
    if (!item || typeof item !== 'object') continue;
    map.set(name, { name, ...item });
  }
  return map;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const clean = trimTrailingSlash(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

function endpointVariants(value) {
  const clean = trimTrailingSlash(value);
  if (!clean) return [];
  try {
    const parsed = new URL(clean);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    if (!pathname || pathname === '/') {
      const origin = trimTrailingSlash(parsed.origin);
      return [`${origin}${APP_API_PREFIX}`, origin];
    }
    return [trimTrailingSlash(parsed.toString())];
  } catch {
    return [clean];
  }
}

function safeRequestUrl(value) {
  try {
    const parsed = new URL(value);
    for (const key of ['src', 'url', 'file', 'live']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[redacted-source]');
    }
    return parsed.toString();
  } catch {
    return String(value || '').replace(/([?&](?:src|url|file|live)=)[^&]*/gi, '$1[redacted-source]');
  }
}

function fetchFailureDetails(error, url) {
  const parts = [error?.message || String(error)];
  const cause = error?.cause;
  if (cause?.code) parts.push(cause.code);
  if (cause?.errno && cause.errno !== cause.code) parts.push(cause.errno);
  if (cause?.syscall) parts.push(cause.syscall);
  if (cause?.address) parts.push(cause.address);
  if (cause?.port) parts.push(String(cause.port));
  parts.push(`url=${safeRequestUrl(url)}`);
  return parts.filter(Boolean).join(' | ');
}

function retryableMessage(value) {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|AbortError|HTTP 404|HTTP 405/i.test(String(value || ''));
}

function bestAttemptError(errors) {
  if (!errors.length) return new Error('go2rtc API request failed');
  // A speculative compatibility endpoint returning 404 must never hide a
  // connection error from the configured/cached endpoint.
  return errors.find((item) => item.kind === 'network')?.error
    || errors.find((item) => ![404, 405].includes(item.status))?.error
    || errors[0].error;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class Go2RtcClient {
  constructor({ baseUrl = null, fallbackUrls = null } = {}) {
    this.configuredBaseUrl = baseUrl;
    this.configuredFallbackUrls = fallbackUrls;
    this.preferredBaseUrl = null;
  }

  baseUrls() {
    const primary = this.configuredBaseUrl || config.go2RtcApi || `http://127.0.0.1:1984${APP_API_PREFIX}`;
    const envFallbacks = this.configuredFallbackUrls || String(process.env.GO2RTC_API_FALLBACKS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const candidates = unique([
      ...endpointVariants(primary),
      ...envFallbacks.flatMap(endpointVariants),
      `http://mediamtx:1984${APP_API_PREFIX}`,
      `http://tmp-camera-go2rtc:1984${APP_API_PREFIX}`,
    ]);
    if (!this.preferredBaseUrl) return candidates;
    return unique([this.preferredBaseUrl, ...candidates]);
  }

  baseUrl() {
    return this.baseUrls()[0];
  }

  requestTargets(path) {
    const cleanPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
    return this.baseUrls().map((base) => ({ base, url: `${base}${cleanPath}` }));
  }

  requestUrls(path) {
    return this.requestTargets(path).map(({ url }) => url);
  }

  async fetchResponse(path, init = {}, { timeoutMs = 2500, retryMs = 0, retryIntervalMs = 350 } = {}) {
    const started = Date.now();
    let lastAttemptErrors = [];
    do {
      const attemptErrors = [];
      for (const { base, url } of this.requestTargets(path)) {
        try {
          const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
          if (response.ok) {
            this.preferredBaseUrl = base;
            return response;
          }
          const body = await response.text().catch(() => '');
          const error = new Error(`go2rtc API HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''} | url=${safeRequestUrl(url)}`);
          error.status = response.status;
          attemptErrors.push({ error, status: response.status, kind: 'http', base });
          if (![404, 405].includes(response.status)) throw error;
        } catch (error) {
          if (Number.isInteger(error?.status)) {
            if (![404, 405].includes(error.status)) throw error;
            continue;
          }
          const wrapped = error instanceof Error ? new Error(fetchFailureDetails(error, url)) : new Error(String(error));
          attemptErrors.push({ error: wrapped, status: null, kind: 'network', base });
          if (!retryableMessage(wrapped.message)) throw wrapped;
        }
      }
      lastAttemptErrors = attemptErrors;
      if (!retryMs || Date.now() - started >= retryMs) break;
      await delay(retryIntervalMs);
    } while (Date.now() - started < retryMs);
    throw bestAttemptError(lastAttemptErrors);
  }

  async info() {
    const response = await this.fetchResponse('/api', {}, { timeoutMs: 2500, retryMs: 12000, retryIntervalMs: 500 });
    return response.json();
  }


  async upsertStream(name, source) {
    const cleanName = normalizeName(name);
    if (!cleanName) throw new Error('go2rtc stream name is empty');
    const cleanSource = String(source || '').trim();
    if (!cleanSource) throw new Error(`go2rtc source for ${cleanName} is empty`);
    const params = new URLSearchParams();
    params.set('src', cleanSource);
    params.set('name', cleanName);
    try {
      const response = await this.fetchResponse(`/api/streams?${params.toString()}`, { method: 'PUT' }, { timeoutMs: 3500, retryMs: 4000 });
      if (response.ok) return true;
    } catch (error) {
      if (!/409|already|exist|HTTP 400|HTTP 405/i.test(error?.message || '')) throw error;
    }
    const patchResponse = await this.fetchResponse(`/api/streams?${params.toString()}`, { method: 'PATCH' }, { timeoutMs: 3500, retryMs: 4000 });
    if (!patchResponse.ok) {
      const body = await patchResponse.text().catch(() => '');
      throw new Error(`go2rtc stream update HTTP ${patchResponse.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return true;
  }

  async preloadStream(name, { video = 'all', audio = 'all' } = {}) {
    const cleanName = normalizeName(name);
    if (!cleanName) throw new Error('go2rtc preload stream name is empty');
    const params = new URLSearchParams();
    params.set('src', cleanName);
    if (video) params.set('video', video);
    if (audio) params.set('audio', audio);
    const response = await this.fetchResponse(`/api/preload?${params.toString()}`, { method: 'PUT' }, { timeoutMs: 3500, retryMs: 4000 });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`go2rtc preload HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return true;
  }

  async deletePreload(name) {
    const cleanName = normalizeName(name);
    if (!cleanName) return false;
    const params = new URLSearchParams();
    params.set('src', cleanName);
    try {
      const response = await this.fetchResponse(`/api/preload?${params.toString()}`, { method: 'DELETE' }, { timeoutMs: 2500 });
      return response.ok || response.status === 404;
    } catch (error) {
      if (/404/.test(error?.message || '')) return true;
      throw error;
    }
  }

  async ensureEmptyStream(name) {
    const cleanName = normalizeName(name);
    if (!cleanName) throw new Error('go2rtc stream name is empty');
    const params = new URLSearchParams();
    params.set('src', '');
    params.set('name', cleanName);
    const response = await this.fetchResponse(`/api/streams?${params.toString()}`, { method: 'PUT' }, { timeoutMs: 3500, retryMs: 4000 });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`go2rtc stream precreate HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return true;
  }

  async ensurePublisherTargets(names) {
    for (const name of names) await this.ensureEmptyStream(name);
  }

  async deleteStream(name) {
    const cleanName = normalizeName(name);
    if (!cleanName) return false;
    const params = new URLSearchParams();
    params.set('src', cleanName);
    try {
      const response = await this.fetchResponse(`/api/streams?${params.toString()}`, { method: 'DELETE' }, { timeoutMs: 2500 });
      return response.ok || response.status === 404;
    } catch (error) {
      if (/404/.test(error?.message || '')) return true;
      throw error;
    }
  }

  async paths() {
    const response = await this.fetchResponse('/api/streams', {}, { timeoutMs: 2500 });
    return normalizeStreamsPayload(await response.json());
  }

  async stream(name) {
    const cleanName = normalizeName(name);
    const params = new URLSearchParams();
    params.set('src', cleanName);
    const response = await this.fetchResponse(`/api/streams?${params.toString()}`, {}, { timeoutMs: 2500 });
    const map = normalizeStreamsPayload(await response.json(), cleanName);
    return map.get(cleanName) || null;
  }

  streamTsUrl(name) {
    const cleanName = normalizeName(name);
    if (!cleanName) throw new Error('go2rtc MPEG-TS stream name is empty');
    const params = new URLSearchParams();
    params.set('src', cleanName);
    return `${this.baseUrl()}/api/stream.ts?${params.toString()}`;
  }

  async waitUntilRegistered(name, { timeoutMs = 4000, intervalMs = 100 } = {}) {
    const cleanName = normalizeName(name);
    if (!cleanName) throw new Error('go2rtc stream name is empty');
    const deadline = Date.now() + Math.max(250, Number(timeoutMs) || 4000);
    let lastError = null;
    do {
      try {
        const item = await this.stream(cleanName);
        if (item) return item;
      } catch (error) {
        lastError = error;
      }
      if (Date.now() < deadline) await delay(Math.max(25, Number(intervalMs) || 100));
    } while (Date.now() < deadline);
    throw new Error(`go2rtc stream was not registered: ${cleanName}${lastError ? ` | ${lastError.message}` : ''}`);
  }

  async waitUntilAnyReady(names, {
    timeoutMs = config.startTimeoutMs,
    intervalMs = 350,
    onPoll = null,
    isProcessAlive = null,
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    const cleanNames = names.map(normalizeName).filter(Boolean);
    let lastApiError = null;
    let polls = 0;
    while (Date.now() < deadline) {
      if (isProcessAlive && !isProcessAlive()) {
        return { ready: {}, apiError: lastApiError, processExited: true, polls };
      }
      polls += 1;
      try {
        const paths = await this.paths();
        const ready = Object.fromEntries(cleanNames.map((name) => [name, streamReady(paths.get(name))]));
        onPoll?.({ ready, paths, polls, apiError: null });
        if (Object.values(ready).some(Boolean)) return { ready, paths, apiError: null, processExited: false, polls };
        lastApiError = null;
      } catch (error) {
        lastApiError = error.message;
        onPoll?.({ ready: {}, paths: new Map(), polls, apiError: lastApiError });
      }
      await delay(intervalMs);
    }
    return { ready: {}, apiError: lastApiError, processExited: false, polls };
  }

  async hlsPlaylistReady(name) {
    const cleanName = normalizeName(name);
    if (!cleanName) return false;
    const params = new URLSearchParams();
    params.set('src', cleanName);
    params.set('_probe', String(Date.now()));
    try {
      const response = await this.fetchResponse(`/api/stream.m3u8?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*' },
      }, { timeoutMs: 3500 });
      if (!response.ok) return false;
      const body = await response.text().catch(() => '');
      return /#EXTM3U/i.test(body);
    } catch {
      return false;
    }
  }

  async waitUntilHlsReady(name, {
    timeoutMs = config.startTimeoutMs,
    intervalMs = 500,
    onPoll = null,
    isProcessAlive = null,
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    const cleanName = normalizeName(name);
    let lastApiError = null;
    let polls = 0;
    while (Date.now() < deadline) {
      if (isProcessAlive && !isProcessAlive()) {
        return { ready: { [cleanName]: false }, apiError: lastApiError, processExited: true, polls };
      }
      polls += 1;
      try {
        const paths = await this.paths();
        const streamIsReady = streamReady(paths.get(cleanName));
        const playlistIsReady = streamIsReady ? await this.hlsPlaylistReady(cleanName) : false;
        const ready = { [cleanName]: Boolean(streamIsReady && playlistIsReady) };
        onPoll?.({ ready, paths, polls, apiError: null, playlistReady: playlistIsReady, streamReady: streamIsReady });
        if (ready[cleanName]) return { ready, paths, apiError: null, processExited: false, polls };
        lastApiError = null;
      } catch (error) {
        lastApiError = error.message;
        onPoll?.({ ready: { [cleanName]: false }, paths: new Map(), polls, apiError: lastApiError });
      }
      await delay(intervalMs);
    }
    return { ready: { [cleanName]: false }, apiError: lastApiError, processExited: false, polls };
  }

  async readers(name) {
    const item = await this.stream(name).catch(() => null);
    if (!item) return 0;
    if (Array.isArray(item.consumers)) return item.consumers.length;
    if (Array.isArray(item.readers)) return item.readers.length;
    return Number(item.consumersCount || item.readerCount || 0) || 0;
  }
}

export const go2RtcClient = new Go2RtcClient();
export { streamReady as go2RtcStreamReady };

import crypto from 'node:crypto';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { joinUpdaterEndpoint, resolveUpdaterEndpoints } from './UpdaterEndpointResolver.js';

const FAILURE_LOG_INTERVAL_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const VALID_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

const ISSUE_MESSAGES = Object.freeze({
  UPDATER_TOKEN_INVALID: 'Die interne Updater-Authentifizierung ist nicht korrekt konfiguriert.',
  PROJECT_MOUNT_INVALID: 'Das Projektverzeichnis ist im Update-Dienst nicht verfügbar.',
  DOCKER_SOCKET_UNAVAILABLE: 'Die Docker-Steuerung ist im Update-Dienst nicht verfügbar.',
  UPDATER_INITIALIZATION_FAILED: 'Der Update-Dienst konnte nicht vollständig initialisiert werden.',
  HEALTH_ENDPOINT_CONFIGURATION_INVALID: 'Ein interner Gesundheitsendpunkt ist ungültig konfiguriert.',
});

const RESPONSE_MESSAGES = Object.freeze({
  UPDATER_AUTH_FAILED: 'Die interne Authentifizierung des Update-Dienstes ist fehlgeschlagen. Bitte UPDATER_TOKEN in der Laufzeitkonfiguration prüfen.',
  UPDATER_STARTING: 'Der Update-Dienst wird noch initialisiert. Bitte den Vorgang erneut starten.',
  UPDATER_INITIALIZATION_FAILED: 'Der Update-Dienst konnte nicht initialisiert werden. Details stehen im Updater-Protokoll.',
  UPDATER_NOT_READY: 'Der Update-Dienst ist erreichbar, aber nicht installierbereit. Details stehen im Update-Center und im Updater-Protokoll.',
  UPDATE_BUSY: 'Es läuft bereits ein Update oder Rollback.',
  NOT_FOUND: 'Der konfigurierte Endpunkt ist kein kompatibler TMP-Update-Dienst.',
  UPDATER_REQUEST_FAILED: 'Der Update-Dienst konnte die Anfrage nicht verarbeiten. Details stehen im Updater-Protokoll.',
  UPDATER_STORAGE_TARGET_INVALID: 'Der Pfad für den Aufnahmespeicher ist ungültig.',
  UPDATER_STORAGE_TARGET_NOT_WRITABLE: 'Der Aufnahmespeicher ist für den Anwendungsbenutzer nicht beschreibbar.',
  UPDATER_STORAGE_APPLY_FAILED: 'Der Aufnahmespeicher konnte nicht aktiviert werden.',
  UPDATER_ERROR: 'Der Update-Dienst hat die Anfrage abgelehnt. Details stehen im Updater-Protokoll.',
});

function requestId(value) {
  const candidate = String(value || '').trim();
  return VALID_REQUEST_ID.test(candidate) ? candidate : crypto.randomUUID();
}

function responseDiagnosticId(value, fallback) {
  const candidate = String(value || '').trim();
  return VALID_REQUEST_ID.test(candidate) ? candidate : fallback;
}

function safeText(value, maxLength = 800) {
  return String(value || '')
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, '$1[REDACTED]@')
    .replace(/\b(token|password|secret|authorization)=([^\s&]+)/gi, '$1=[REDACTED]')
    .slice(0, maxLength);
}

function causeCode(error) {
  return String(error?.cause?.code || error?.code || '').toUpperCase();
}

function classifyNetworkError(error) {
  const code = causeCode(error);
  const name = String(error?.name || 'Error');
  if (error?.updaterTransport === 'unix' && ['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM'].includes(code)) {
    return { code: 'UPDATER_IPC_UNAVAILABLE', message: 'Der lokale IPC-Kanal des Update-Dienstes ist derzeit nicht verfügbar.', retryable: true, safeToRetryPost: true };
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(code)) return { code: 'UPDATER_DNS_ERROR', message: 'Der Dienstname konnte im Backend-Netz nicht aufgelöst werden.', retryable: true, safeToRetryPost: true };
  if (code === 'ECONNREFUSED') return { code: 'UPDATER_CONNECTION_REFUSED', message: 'Der Update-Dienst nimmt am konfigurierten Ziel derzeit keine Verbindung an.', retryable: true, safeToRetryPost: true };
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return { code: 'UPDATER_CONNECT_TIMEOUT', message: 'Der Verbindungsaufbau zum Update-Dienst hat das Zeitlimit überschritten.', retryable: true, safeToRetryPost: true };
  if (['ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ABORT_ERR'].includes(code) || ['TimeoutError', 'AbortError'].includes(name)) return { code: 'UPDATER_TIMEOUT', message: 'Der Update-Dienst hat nicht innerhalb des Zeitlimits geantwortet.', retryable: true, safeToRetryPost: false };
  if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return { code: 'UPDATER_CONNECTION_INTERRUPTED', message: 'Die Verbindung zum Update-Dienst wurde unerwartet unterbrochen.', retryable: true, safeToRetryPost: false };
  if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) return { code: 'UPDATER_TLS_ERROR', message: 'Die TLS-Verbindung zum Update-Dienst konnte nicht verifiziert werden.', retryable: false, safeToRetryPost: false };
  return { code: 'UPDATER_NETWORK_ERROR', message: 'Der Update-Dienst konnte über das aktuelle Backend-Netz nicht erreicht werden.', retryable: true, safeToRetryPost: false };
}

function internalErrorDetails(error) {
  return { errorName: String(error?.name || 'Error').slice(0, 80), causeCode: causeCode(error) || undefined, errorMessage: safeText(error?.cause?.message || error?.message || error) };
}

async function responsePayload(response) {
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel?.().catch?.(() => {});
    return { parseError: 'response_too_large' };
  }

  let text = '';
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return { parseError: 'response_too_large' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return { parseError: 'response_too_large' };
  }

  if (!text) return {};
  try { return JSON.parse(text); } catch { return { parseError: 'invalid_json' }; }
}

function issueCodes(payload) {
  const result = new Set();
  for (const code of Array.isArray(payload?.issueCodes) ? payload.issueCodes : []) if (VALID_CODE.test(String(code))) result.add(String(code));
  for (const item of Array.isArray(payload?.issues) ? payload.issues.map(String) : []) {
    if (/UPDATER_TOKEN/i.test(item)) result.add('UPDATER_TOKEN_INVALID');
    if (/Projekt-Mount|PROJECT_DIR|VERSION/i.test(item)) result.add('PROJECT_MOUNT_INVALID');
    if (/Docker-Socket|docker\.sock/i.test(item)) result.add('DOCKER_SOCKET_UNAVAILABLE');
  }
  return [...result];
}

function healthMessage({ installReady, busy, codes }) {
  if (busy) return 'Interner Update-Dienst ist erreichbar; ein Update- oder Rollbackvorgang läuft.';
  if (installReady) return 'Interner Update-Dienst ist betriebsbereit.';
  return codes.map((code) => ISSUE_MESSAGES[code]).find(Boolean) || 'Interner Update-Dienst ist erreichbar, aber derzeit nicht installierbereit.';
}

function unavailableMessage(attempts, configurationIssues) {
  if (configurationIssues.length && !attempts.length) return 'Die Konfiguration des internen Update-Dienstes ist ungültig.';
  const codes = new Set(attempts.map((item) => item.code));
  if (codes.has('UPDATER_IPC_UNAVAILABLE') && !codes.has('UPDATER_DNS_ERROR')) return 'Der lokale IPC-Kanal des Update-Dienstes ist derzeit nicht verfügbar.';
  if (codes.has('UPDATER_DNS_ERROR')) return 'Der konfigurierte Dienstname konnte im Backend-Netz nicht aufgelöst werden.';
  if (codes.has('UPDATER_CONNECTION_REFUSED')) return 'Der Update-Dienst ist im Backend-Netz adressierbar, nimmt aber derzeit keine Verbindung an.';
  if (codes.has('UPDATER_CONNECT_TIMEOUT') || codes.has('UPDATER_TIMEOUT')) return 'Der Update-Dienst hat nicht innerhalb des Zeitlimits geantwortet.';
  if (codes.has('UPDATER_TLS_ERROR')) return 'Die sichere Verbindung zum Update-Dienst konnte nicht verifiziert werden.';
  return 'Interner Update-Dienst ist derzeit nicht erreichbar.';
}

function publicAttempt(endpoint, result, attempt) {
  return { endpoint: endpoint.displayName, source: endpoint.source, code: result.code, status: result.status || undefined, attempt, message: result.message };
}

function payloadCodeIsUpdater(value) {
  const code = String(value || '');
  return VALID_CODE.test(code) && (code.startsWith('UPDATER_') || code === 'UPDATE_BUSY');
}

function responseError(response, payload, fallbackDiagnosticId = undefined) {
  const compatibleService = payload?.service === 'tmp-camera-updater';
  const payloadCode = VALID_CODE.test(String(payload?.error || '')) ? String(payload.error) : '';
  const declaredCode = payload?.service && !compatibleService
    ? 'NOT_FOUND'
    : payloadCode || (response.ok || response.status === 404 ? 'NOT_FOUND' : response.status === 401 || response.status === 403 ? 'UPDATER_AUTH_FAILED' : response.status === 409 ? 'UPDATE_BUSY' : 'UPDATER_ERROR');
  let message = RESPONSE_MESSAGES[declaredCode];
  if (!message) {
    if (response.status === 401 || response.status === 403) message = RESPONSE_MESSAGES.UPDATER_AUTH_FAILED;
    else if (response.status === 404) message = RESPONSE_MESSAGES.NOT_FOUND;
    else if (response.status === 409) message = RESPONSE_MESSAGES.UPDATE_BUSY;
    else if (response.status >= 500) message = 'Der Update-Dienst ist vorübergehend nicht bereit.';
    else message = 'Der Update-Dienst hat die Anfrage abgelehnt.';
  }
  const transientStatus = [502, 503, 504].includes(response.status);
  const nonTransientCode = ['UPDATER_NOT_READY', 'UPDATER_INITIALIZATION_FAILED', 'UPDATER_AUTH_FAILED', 'UPDATE_BUSY'].includes(declaredCode);
  return {
    code: declaredCode,
    message,
    status: response.status,
    retryable: response.status >= 500,
    safeToRetryPost: declaredCode === 'UPDATER_STARTING' || (transientStatus && !nonTransientCode),
    issueCodes: issueCodes(payload),
    diagnosticId: responseDiagnosticId(payload?.diagnosticId, fallbackDiagnosticId),
  };
}


function unixSocketRequest(endpoint, endpointPath, init = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const body = init.body === undefined || init.body === null ? null : Buffer.from(String(init.body));
    const headers = { ...(init.headers || {}) };
    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-length')) headers['Content-Length'] = String(body.length);
    let completed = false;
    const fail = (error) => {
      if (completed) return;
      completed = true;
      if (error && typeof error === 'object') error.updaterTransport = 'unix';
      reject(error);
    };
    const request = http.request({
      socketPath: endpoint.socketPath,
      path: String(endpointPath || '/').startsWith('/') ? String(endpointPath || '/') : `/${endpointPath}`,
      method: init.method || 'GET',
      headers,
    }, (response) => {
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          const error = new Error('Updater IPC response too large');
          error.code = 'UPDATER_RESPONSE_TOO_LARGE';
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', fail);
      response.on('end', () => {
        if (completed) return;
        completed = true;
        const status = Number(response.statusCode || 500);
        resolve(new Response(Buffer.concat(chunks), { status: status >= 200 && status <= 599 ? status : 500, headers: response.headers }));
      });
    });
    request.setTimeout(Math.max(100, Number(timeoutMs) || 15_000), () => {
      const error = new Error('Updater IPC request timed out');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', fail);
    if (body) request.write(body);
    request.end();
  });
}

async function requestEndpoint(fetchImpl, endpoint, endpointPath, init, timeoutMs) {
  if (endpoint.transport === 'unix') return unixSocketRequest(endpoint, endpointPath, init, timeoutMs);
  return fetchImpl(joinUpdaterEndpoint(endpoint.baseUrl, endpointPath), {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function createUpdaterClient({ settings = config, log = logger, fetchImpl = (...args) => globalThis.fetch(...args), wait = delay, now = () => Date.now() } = {}) {
  let availability = null;
  const lastFailureLog = new Map();
  const loggedConfigurationIssues = new Set();

  function resolved() {
    const result = resolveUpdaterEndpoints(settings);
    for (const issue of result.issues) {
      const key = `${issue.source}:${issue.code}:${issue.message}`;
      if (loggedConfigurationIssues.has(key)) continue;
      loggedConfigurationIssues.add(key);
      log.warn({ component: 'updater-client', code: issue.code, source: issue.source, endpoint: issue.endpoint, detail: safeText(issue.message) }, 'Ungültige Updater-Endpunktkonfiguration');
    }
    return result;
  }

  function logFailure(endpoint, result, diagnosticId, attempt, error = null) {
    const key = `${endpoint.id}:${result.code}:${result.status || ''}`;
    const timestamp = now();
    if (timestamp - (lastFailureLog.get(key) || 0) < FAILURE_LOG_INTERVAL_MS) return;
    lastFailureLog.set(key, timestamp);
    log.warn({ component: 'updater-client', diagnosticId, endpoint: endpoint.safeTarget, endpointSource: endpoint.source, code: result.code, status: result.status, attempt, ...(error ? internalErrorDetails(error) : {}) }, 'Updater-Endpunkt nicht erreichbar oder nicht bereit');
  }

  function markAvailable(endpoint, diagnosticId) {
    if (availability !== true) log.info({ component: 'updater-client', diagnosticId, endpoint: endpoint.safeTarget, endpointSource: endpoint.source }, 'Verbindung zum Update-Dienst hergestellt');
    availability = true;
  }

  function markUnavailable(diagnosticId, attempts) {
    if (availability !== false) log.warn({ component: 'updater-client', diagnosticId, attempts: attempts.map(({ endpoint, source, code, status }) => ({ endpoint, source, code, status })) }, 'Kein konfigurierter Update-Dienst ist erreichbar');
    availability = false;
  }

  async function health({ requestId: suppliedRequestId } = {}) {
    const diagnosticId = requestId(suppliedRequestId);
    const { endpoints, issues } = resolved();
    const attempts = [];
    if (!endpoints.length) {
      markUnavailable(diagnosticId, attempts);
      return { status: 'offline', reachable: false, installReady: false, message: unavailableMessage(attempts, issues), code: 'UPDATER_CONFIGURATION_INVALID', diagnosticId, attempts: issues.map((issue) => ({ endpoint: issue.endpoint, source: issue.source, code: issue.code, message: issue.message })), checkedAt: new Date().toISOString() };
    }
    for (const endpoint of endpoints) {
      const maximumAttempts = settings.updaterHealthRetries + 1;
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        try {
          const response = await requestEndpoint(fetchImpl, endpoint, '/health', { method: 'GET', headers: { Accept: 'application/json', 'X-Request-ID': diagnosticId }, cache: 'no-store' }, settings.updaterHealthTimeoutMs);
          const payload = await responsePayload(response);
          const compatible = payload?.service === 'tmp-camera-updater';
          if (compatible && (response.ok || response.status === 503)) {
            const codes = issueCodes(payload);
            if (payload.status === 'error' && !codes.length) codes.push('UPDATER_INITIALIZATION_FAILED');
            const installReady = response.ok && payload.status !== 'error' && payload.installReady !== false;
            const busy = Boolean(payload.busy);
            markAvailable(endpoint, diagnosticId);
            return { status: installReady ? 'ok' : 'degraded', reachable: true, installReady, busy, version: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(payload.version || '')) ? payload.version : undefined, initializedAt: typeof payload.initializedAt === 'string' ? payload.initializedAt : undefined, issueCodes: codes, message: healthMessage({ installReady, busy, codes }), connection: { method: endpoint.displayName, source: endpoint.source }, diagnosticId: installReady ? undefined : diagnosticId, attempts, checkedAt: new Date().toISOString() };
          }
          const result = responseError(response, payload, diagnosticId);
          attempts.push(publicAttempt(endpoint, result, attempt));
          if (attempt === maximumAttempts || !result.retryable) logFailure(endpoint, result, diagnosticId, attempt);
          if (!result.retryable) break;
        } catch (error) {
          const result = classifyNetworkError(error);
          attempts.push(publicAttempt(endpoint, result, attempt));
          if (attempt === maximumAttempts || !result.retryable) logFailure(endpoint, result, diagnosticId, attempt, error);
          if (!result.retryable) break;
        }
        if (attempt < maximumAttempts && settings.updaterRetryDelayMs > 0) await wait(settings.updaterRetryDelayMs * attempt);
      }
    }
    markUnavailable(diagnosticId, attempts);
    return { status: 'offline', reachable: false, installReady: false, message: unavailableMessage(attempts, issues), code: 'UPDATER_UNAVAILABLE', diagnosticId, attempts: [...attempts.slice(-8), ...issues.map((issue) => ({ endpoint: issue.endpoint, source: issue.source, code: issue.code, message: issue.message }))].slice(-10), checkedAt: new Date().toISOString() };
  }

  async function get(endpointPath, { timeoutMs = settings.updaterHealthTimeoutMs, requestId: suppliedRequestId } = {}) {
    const diagnosticId = requestId(suppliedRequestId);
    const { endpoints, issues } = resolved();
    const attempts = [];
    let lastServiceError = null;
    if (!endpoints.length) throw new AppError(503, 'UPDATER_CONFIGURATION_INVALID', 'Die Konfiguration des internen Update-Dienstes ist ungültig.', { diagnosticId, attempts: issues.map((issue) => ({ endpoint: issue.endpoint, source: issue.source, code: issue.code, message: issue.message })) });
    for (const endpoint of endpoints) {
      const maximumAttempts = settings.updaterHealthRetries + 1;
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        try {
          const response = await requestEndpoint(fetchImpl, endpoint, endpointPath, {
            method: 'GET',
            headers: { Accept: 'application/json', 'X-Updater-Token': settings.updaterToken, 'X-Updater-Request-ID': diagnosticId },
            cache: 'no-store',
          }, timeoutMs);
          const payload = await responsePayload(response);
          if (response.ok && payload?.service === 'tmp-camera-updater') {
            markAvailable(endpoint, diagnosticId);
            return { ...payload, diagnosticId: responseDiagnosticId(payload?.diagnosticId, diagnosticId) };
          }
          const result = responseError(response, payload, diagnosticId);
          attempts.push(publicAttempt(endpoint, result, attempt));
          const recognizedUpdaterResponse = payload?.service === 'tmp-camera-updater' || (payloadCodeIsUpdater(payload?.error) && result.code !== 'UPDATER_ERROR');
          if (recognizedUpdaterResponse) {
            markAvailable(endpoint, diagnosticId);
            lastServiceError = { endpoint, result };
          }
          if (attempt === maximumAttempts || !result.retryable) logFailure(endpoint, result, diagnosticId, attempt);
          if (!result.retryable) break;
        } catch (error) {
          const result = classifyNetworkError(error);
          attempts.push(publicAttempt(endpoint, result, attempt));
          if (attempt === maximumAttempts || !result.retryable) logFailure(endpoint, result, diagnosticId, attempt, error);
          if (!result.retryable) break;
        }
        if (attempt < maximumAttempts && settings.updaterRetryDelayMs > 0) await wait(settings.updaterRetryDelayMs * attempt);
      }
    }
    if (lastServiceError) {
      const { result } = lastServiceError;
      throw new AppError(result.status || 503, result.code, result.message, {
        diagnosticId: result.diagnosticId || diagnosticId,
        issueCodes: result.issueCodes,
        attempts: attempts.slice(-10),
      });
    }
    markUnavailable(diagnosticId, attempts);
    throw new AppError(503, 'UPDATER_UNAVAILABLE', unavailableMessage(attempts, issues), {
      diagnosticId,
      attempts: [...attempts.slice(-8), ...issues.map((issue) => ({ endpoint: issue.endpoint, source: issue.source, code: issue.code, message: issue.message }))].slice(-10),
    });
  }

  async function post(endpointPath, body, { timeoutMs = settings.updaterRequestTimeoutMs, requestId: suppliedRequestId } = {}) {
    const diagnosticId = requestId(suppliedRequestId);
    const { endpoints, issues } = resolved();
    const attempts = [];
    let lastServiceError = null;
    if (!endpoints.length) throw new AppError(503, 'UPDATER_CONFIGURATION_INVALID', 'Die Konfiguration des internen Update-Dienstes ist ungültig.', { diagnosticId, attempts: issues.map((issue) => ({ endpoint: issue.endpoint, source: issue.source, code: issue.code, message: issue.message })) });
    for (const endpoint of endpoints) {
      const maximumAttempts = settings.updaterRequestRetries + 1;
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        try {
          const response = await requestEndpoint(fetchImpl, endpoint, endpointPath, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Updater-Token': settings.updaterToken, 'X-Updater-Request-ID': diagnosticId }, body: JSON.stringify(body) }, timeoutMs);
          const payload = await responsePayload(response);
          if (response.ok && payload?.service === 'tmp-camera-updater') {
            markAvailable(endpoint, diagnosticId);
            log.info({ component: 'updater-client', diagnosticId, endpoint: endpoint.safeTarget, endpointSource: endpoint.source, operation: endpointPath }, 'Updater-Anfrage angenommen');
            return { ...payload, diagnosticId: responseDiagnosticId(payload?.diagnosticId, diagnosticId) };
          }

          const result = responseError(response, payload, diagnosticId);
          attempts.push(publicAttempt(endpoint, result, attempt));
          const recognizedUpdaterResponse = payload?.service === 'tmp-camera-updater' || (payloadCodeIsUpdater(payload?.error) && result.code !== 'UPDATER_ERROR');
          if (recognizedUpdaterResponse) {
            markAvailable(endpoint, diagnosticId);
            lastServiceError = { endpoint, result };
          }
          logFailure(endpoint, result, diagnosticId, attempt);

          const details = {
            diagnosticId: result.diagnosticId || diagnosticId,
            issueCodes: result.issueCodes,
            attempts: attempts.slice(-8),
          };
          if ([400, 401, 403, 409].includes(response.status)
            || ['UPDATER_NOT_READY', 'UPDATER_INITIALIZATION_FAILED', 'UPDATER_AUTH_FAILED', 'UPDATE_BUSY'].includes(result.code)) {
            throw new AppError(response.status, result.code, result.message, details);
          }

          const mayRetry = result.safeToRetryPost && attempt < maximumAttempts;
          if (mayRetry) {
            if (settings.updaterRetryDelayMs > 0) await wait(settings.updaterRetryDelayMs * attempt);
            continue;
          }
          break;
        } catch (error) {
          if (error instanceof AppError) throw error;
          const result = classifyNetworkError(error);
          attempts.push(publicAttempt(endpoint, result, attempt));
          const mayRetry = result.safeToRetryPost && attempt < maximumAttempts;
          if (!mayRetry) logFailure(endpoint, result, diagnosticId, attempt, error);
          if (!mayRetry) break;
          if (settings.updaterRetryDelayMs > 0) await wait(settings.updaterRetryDelayMs * attempt);
        }
      }
    }

    if (lastServiceError) {
      const { result } = lastServiceError;
      throw new AppError(result.status || 503, result.code, result.message, {
        diagnosticId: result.diagnosticId || diagnosticId,
        issueCodes: result.issueCodes,
        attempts: attempts.slice(-10),
      });
    }

    markUnavailable(diagnosticId, attempts);
    throw new AppError(503, 'UPDATER_UNAVAILABLE', `${unavailableMessage(attempts, issues)} Bitte Updater-Protokoll und Service-Konfiguration prüfen.`, { diagnosticId, attempts: [...attempts.slice(-8), ...issues.map((issue) => ({ endpoint: issue.endpoint, source: issue.source, code: issue.code, message: issue.message }))].slice(-10) });
  }
  return { health, get, post };
}

export const updaterClient = createUpdaterClient();

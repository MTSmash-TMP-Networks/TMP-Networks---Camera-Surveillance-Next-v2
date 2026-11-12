import { translate } from '../i18n/messages.js';

const API = '/api';
let accessToken = sessionStorage.getItem('tmp_camera_token') || '';

export function setAccessToken(token) {
  accessToken = token || '';
  if (token) sessionStorage.setItem('tmp_camera_token', token);
  else sessionStorage.removeItem('tmp_camera_token');
}

function localizedErrorMessage(payload, fallback) {
  if (payload?.error === 'DEMO_MODE_READ_ONLY') {
    const locale = typeof document === 'undefined' ? 'en' : (document.documentElement.lang || 'en');
    return translate(locale, 'demo.actionBlocked');
  }
  return payload?.message || fallback;
}

async function fetchApi(resource, options) {
  try {
    return await fetch(resource, options);
  } catch {
    const error = new Error('Backend nicht erreichbar. Bitte Netzwerkverbindung und Dienststatus prüfen.');
    error.code = 'API_NETWORK_ERROR';
    error.details = { category: 'network' };
    throw error;
  }
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetchApi(`${API}${path}`, { cache: options.cache || 'no-store', ...options, headers, body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body });
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* ignore */ }
    const error = new Error(localizedErrorMessage(payload, `HTTP ${response.status}`));
    error.code = payload.error;
    error.details = payload.details;
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}


export async function requestBlob(path) {
  const headers = new Headers();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetchApi(`${API}${path}`, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

function filenameFromDisposition(value) {
  const header = String(value || '');
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { return utf8[1]; } }
  const ascii = header.match(/filename=\"?([^\";]+)\"?/i);
  return ascii ? ascii[1] : '';
}

export async function requestDownload(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetchApi(`${API}${path}`, {
    ...options,
    headers,
    cache: 'no-store',
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* ignore */ }
    const error = new Error(localizedErrorMessage(payload, `HTTP ${response.status}`));
    error.code = payload.error;
    error.details = payload.details;
    error.status = response.status;
    throw error;
  }
  return { blob: await response.blob(), filename: filenameFromDisposition(response.headers.get('content-disposition')) };
}


async function uploadUpdate(file) {
  const headers = new Headers({
    'Content-Type': file.type || 'application/zip',
    'X-File-Name': file.name,
  });
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetchApi(`${API}/system/update/upload`, { method: 'POST', headers, body: file });
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* ignore */ }
    const error = new Error(localizedErrorMessage(payload, `HTTP ${response.status}`));
    error.code = payload.error;
    error.details = payload.details;
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function queryString(values = {}) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export const api = {
  runtime: () => request('/auth/runtime'),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => request('/auth/me'),
  websocketToken: () => request('/auth/ws-token', { method: 'POST' }),
  users: () => request('/auth/users'),
  createUser: (input) => request('/auth/users', { method: 'POST', body: input }),
  updateUser: (id, input) => request(`/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: input }),
  changePassword: (input) => request('/auth/change-password', { method: 'POST', body: input }),
  cameras: () => request('/cameras'),
  nextCameraName: () => request('/cameras/next-name'),
  camera: (id) => request(`/cameras/${id}`),
  cameraLogs: (id, query = {}) => request(`/cameras/${id}/logs${queryString(query)}`),
  clearCameraLogs: (id) => request(`/cameras/${id}/logs`, { method: 'DELETE' }),
  discover: (input = {}) => request('/cameras/discover', { method: 'POST', body: { timeoutMs: 5000, includeUnverified: false, ...input } }),
  startDiscoveryJob: (input = {}) => request('/cameras/discovery-jobs', { method: 'POST', body: input }),
  discoveryJob: (id) => request(`/cameras/discovery-jobs/${encodeURIComponent(id)}`),
  latestDiscoveryJob: (origin = '') => request(`/cameras/discovery-jobs/latest${origin ? `?origin=${encodeURIComponent(origin)}` : ''}`),
  recentDiscoveryJobs: (limit = 20) => request(`/cameras/discovery-jobs/recent?limit=${encodeURIComponent(limit)}`),
  inspect: (input) => request('/cameras/inspect', { method: 'POST', body: input }),
  addCamera: (input) => request('/cameras', { method: 'POST', body: input }),
  updateCamera: (id, input) => request(`/cameras/${id}`, { method: 'PATCH', body: input }),
  deleteCamera: (id) => request(`/cameras/${id}`, { method: 'DELETE' }),
  refreshProfiles: (id) => request(`/cameras/${id}/profiles/refresh`, { method: 'POST' }),
  testMediaSources: (id) => request(`/cameras/${id}/sources/test`, { method: 'POST' }),
  discoverMediaSources: (id, input = {}) => request(`/cameras/${id}/sources/discover`, { method: 'POST', body: input }),
  streamSession: (id, input) => request(`/streams/${id}/session`, { method: 'POST', body: input }),
  streamStatus: (id) => request(`/streams/${id}/status`, { cache: 'no-store' }),
  streamHeartbeat: (id, input) => request(`/streams/${id}/heartbeat`, { method: 'POST', cache: 'no-store', body: input }),
  streamClientEvent: (id, input) => request(`/streams/${id}/client-event`, { method: 'POST', body: input }),
  restartStream: (id) => request(`/streams/${id}/restart`, { method: 'POST' }),
  ptzMove: (id, input) => request(`/ptz/${id}/move`, { method: 'POST', body: input }),
  ptzHeartbeat: (id, input) => request(`/ptz/${id}/heartbeat`, { method: 'POST', cache: 'no-store', body: input }),
  ptzStop: (id, input = {}) => request(`/ptz/${id}/stop`, { method: 'POST', cache: 'no-store', body: typeof input === 'string' ? { profileToken: input } : input }),
  ptzHome: (id, input = {}) => request(`/ptz/${id}/home`, { method: 'POST', body: typeof input === 'string' ? { profileToken: input } : input }),
  ptzStatus: (id) => request(`/ptz/${id}/status`),
  presets: (id, profileToken) => request(`/ptz/${id}/presets?profile=${encodeURIComponent(profileToken || '')}`),
  snapshot: (id, profile = '') => requestBlob(`/cameras/${id}/snapshot${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`),
  gotoPreset: (id, preset, input = {}) => request(`/ptz/${id}/presets/${encodeURIComponent(preset)}`, { method: 'POST', body: typeof input === 'string' ? { profileToken: input } : input }),
  recordings: (cameraId = '') => request(`/recordings${cameraId ? `?cameraId=${encodeURIComponent(cameraId)}` : ''}`),
  startRecording: (input) => request('/recordings', { method: 'POST', body: input }),
  stopRecording: (id) => request(`/recordings/${id}/stop`, { method: 'POST' }),
  recordingToken: (id) => request(`/recordings/${id}/token`, { method: 'POST' }),
  recordingSegments: (id) => request(`/recordings/${id}/segments`),
  deleteRecording: (id) => request(`/recordings/${id}`, { method: 'DELETE' }),
  recordingCapabilities: () => request('/recordings/capabilities'),
  recordingPlans: (cameraId) => request(`/recordings/cameras/${encodeURIComponent(cameraId)}/plans`),
  saveRecordingPlans: (cameraId, plans) => request(`/recordings/cameras/${encodeURIComponent(cameraId)}/plans`, { method: 'PUT', body: { plans } }),
  previewRecordingPlans: (cameraId, input = {}) => request(`/recordings/cameras/${encodeURIComponent(cameraId)}/plans/preview`, { method: 'POST', body: input }),
  retentionPolicy: (cameraId) => request(`/recordings/cameras/${encodeURIComponent(cameraId)}/retention`),
  saveRetentionPolicy: (cameraId, input) => request(`/recordings/cameras/${encodeURIComponent(cameraId)}/retention`, { method: 'PUT', body: input }),
  saveRecordingPlanning: (cameraId, input) => request(`/recordings/cameras/${encodeURIComponent(cameraId)}/planning`, { method: 'PUT', body: input }),
  recordingEvents: (cameraId, limit = 200) => request(`/recordings/cameras/${encodeURIComponent(cameraId)}/events?limit=${encodeURIComponent(limit)}`),
  createRecordingEvent: (input) => request('/recordings/events', { method: 'POST', body: input }),
  recordingSchedulerStatus: () => request('/recordings/scheduler/status'),
  motionDetectionStatus: () => request('/recordings/motion/status'),
  kioskStatus: () => request('/recordings/kiosk/status', { cache: 'no-store' }),
  runRecordingScheduler: () => request('/recordings/scheduler/run', { method: 'POST' }),
  retentionStatus: () => request('/recordings/retention/status'),
  cleanupRecordings: (input = {}) => request('/recordings/cleanup', { method: 'POST', body: input }),
  recordingEvidenceTimeline: (input = {}) => request(`/recordings/export/timeline${queryString(input)}`),
  recordingEvidencePreview: (input) => request('/recordings/export/preview', { method: 'POST', body: input }),
  recordingEvidenceExport: (input) => requestDownload('/recordings/export', { method: 'POST', body: input }),
  recordingStorage: () => request('/system/recording-storage', { cache: 'no-store' }),
  testRecordingStorage: (input) => request('/system/recording-storage/test', { method: 'POST', body: input }),
  saveRecordingStorage: (input) => request('/system/recording-storage', { method: 'PUT', body: input }),
  demoModeSettings: () => request('/system/demo-mode', { cache: 'no-store' }),
  saveDemoModeSettings: (input) => request('/system/demo-mode', { method: 'PUT', body: input }),
  systemStatus: () => request('/system/status', { cache: 'no-store' }),
  restartSystem: () => request('/system/restart', { method: 'POST', body: { confirmation: 'NEUSTART' } }),
  updateOverview: () => request('/system/update'),
  checkGitHubUpdate: () => request('/system/update/github/check'),
  prepareGitHubUpdate: (commit) => request('/system/update/github/prepare', { method: 'POST', body: { commit, confirmation: 'HERUNTERLADEN' } }),
  uploadUpdate,
  installUpdate: (packageId) => request('/system/update/install', { method: 'POST', body: { packageId, confirmation: 'INSTALLIEREN' } }),
  rollbackUpdate: (backupId) => request('/system/update/rollback', { method: 'POST', body: { backupId, confirmation: 'ROLLBACK' } }),
  deleteUpdatePackage: (id) => request(`/system/update/packages/${id}`, { method: 'DELETE' }),
  auditLogs: (query = {}) => request(`/system/audit${queryString(query)}`),
  recentDomainEvents: (query = {}) => request(`/system/events/recent${queryString(query)}`),
  emailNotificationSettings: () => request('/system/notifications/email', { cache: 'no-store' }),
  saveEmailNotificationSettings: (input) => request('/system/notifications/email', { method: 'PUT', body: input }),
  testEmailNotification: (recipient = '') => request('/system/notifications/email/test', { method: 'POST', body: recipient ? { recipient } : {} }),
  emailNotificationDeliveries: (limit = 50) => request(`/system/notifications/email/deliveries?limit=${encodeURIComponent(limit)}`, { cache: 'no-store' }),
  aiEventAnalysisSettings: () => request('/system/notifications/ai', { cache: 'no-store' }),
  saveAiEventAnalysisSettings: (input) => request('/system/notifications/ai', { method: 'PUT', body: input }),
  testAiEventAnalysis: (cameraId, language = 'auto') => request('/system/notifications/ai/test', { method: 'POST', body: { cameraId, language } }),
};

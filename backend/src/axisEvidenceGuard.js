/**
 * v2.20.8 Axis evidence guard.
 *
 * An answered /axis-cgi/* probe is not proof of an Axis camera. Many web
 * servers return redirects, login pages, branded error documents, 401/403,
 * or a generic 200 response for unknown paths. Only concrete device identity
 * data from VAPIX/Axis is authoritative. Authenticated ONVIF remains the
 * preferred source for profiles and PTZ capabilities.
 */
const CLASSIFICATION_KEYS = new Set([
  'manufacturer', 'vendor', 'brand', 'make', 'driver', 'adapter', 'provider',
  'cameraType', 'camera_type', 'deviceType', 'device_type'
]);

const NON_EVIDENCE_KEYS = new Set([
  ...CLASSIFICATION_KEYS,
  'url', 'uri', 'path', 'endpoint', 'probe', 'probeUrl', 'probe_url',
  'requestUrl', 'request_url', 'xaddr', 'serviceUrl', 'service_url',
  'method', 'methods', 'detectionMethod', 'detection_method',
  'detectionMethods', 'detection_methods', 'detectedBy', 'detected_by',
  'source', 'sources', 'protocol', 'kind', 'type', 'status', 'statusText'
]);

function isAxisValue(value) {
  return typeof value === 'string' && /^axis(?:\s+communications)?$/i.test(value.trim());
}

function collectContent(value, key = '', out = [], seen = new WeakSet()) {
  if (value == null) return out;
  if (typeof value !== 'object') {
    if (!NON_EVIDENCE_KEYS.has(String(key))) out.push(String(value));
    return out;
  }
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectContent(item, key, out, seen);
    return out;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    if (NON_EVIDENCE_KEYS.has(childKey)) continue;
    collectContent(childValue, childKey, out, seen);
  }
  return out;
}

function explicitAxisHeader(value) {
  if (!value || typeof value !== 'object') return false;
  const headers = value.headers && typeof value.headers === 'object' ? value.headers : value;
  for (const [key, headerValue] of Object.entries(headers)) {
    if (/^(?:server|x-axis-[a-z0-9-]+)$/i.test(key) && /^(?:AXIS(?:\/|\s|$)|.+)$/i.test(String(headerValue))) {
      if (/axis/i.test(key) || /^AXIS(?:\/|\s|$)/i.test(String(headerValue).trim())) return true;
    }
  }
  return false;
}

function verifiedEvidenceRecord(value) {
  if (!value || typeof value !== 'object') return false;
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  return evidence.some((item) => item && typeof item === 'object' && item.verified === true && /^(?:axis|vapix)$/i.test(String(item.type || item.kind || item.protocol || item.method || '')));
}

function isVerifiedAxisIdentity(value) {
  if (!value) return false;
  if (typeof value === 'object') {
    if (value.axisVerified === true || value.axis_verified === true || value.vapixVerified === true || value.vapix_verified === true) return true;
    if (verifiedEvidenceRecord(value) || explicitAxisHeader(value)) return true;
  }
  const text = (typeof value === 'object' ? collectContent(value).join('\n') : String(value)).slice(0, 1024 * 1024);
  if (!text) return false;
  return (
    /\bAXIS\s+Communications\b/i.test(text) ||
    /(?:^|[\r\n;&])\s*(?:root\.)?(?:Brand\.Brand|Properties\.System\.(?:ProdFullName|ProdShortName)|ProdFullName|ProdShortName|Manufacturer)\s*=\s*AXIS(?:\s+Communications)?\b/im.test(text) ||
    /(?:manufacturer|vendor|brand)\s*[:=]\s*["']?AXIS(?:\s+Communications)?\b/i.test(text) ||
    /<[^>]*(?:manufacturer|vendor|brand)[^>]*>\s*AXIS(?:\s+Communications)?\s*</i.test(text) ||
    /<title[^>]*>\s*AXIS\s+[A-Z0-9][^<]{0,100}<\/title>/i.test(text) ||
    /\bVAPIX\b/i.test(text)
  );
}

function hasOnvifEvidence(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.onvif === true || value.onvifVerified === true || value.onvif_verified === true) return true;
  if (value.onvifUrl || value.onvif_url || value.xaddr || value.deviceServiceUrl || value.device_service_url) return true;
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  return evidence.some((item) => {
    if (typeof item === 'string') return /^onvif$/i.test(item.trim());
    return item && typeof item === 'object' && item.verified === true && /onvif/i.test(String(item.type || item.kind || item.protocol || item.method || ''));
  });
}

function sanitizeObject(obj, seen) {
  if (!obj || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return obj;
  seen.add(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') sanitizeObject(value, seen);
  }

  const claimsAxis = Object.entries(obj).some(([key, value]) => CLASSIFICATION_KEYS.has(key) && isAxisValue(value));
  if (!claimsAxis) return obj;
  if (isVerifiedAxisIdentity(obj)) {
    obj.axisVerified = true;
    return obj;
  }

  const onvif = hasOnvifEvidence(obj);
  for (const key of ['manufacturer', 'vendor', 'brand', 'make']) {
    if (isAxisValue(obj[key])) obj[key] = null;
  }
  for (const key of ['driver', 'adapter', 'provider', 'cameraType', 'camera_type', 'deviceType', 'device_type']) {
    if (isAxisValue(obj[key])) obj[key] = onvif ? 'onvif' : 'generic';
  }
  for (const key of ['detectionMethod', 'detection_method', 'detectedBy', 'detected_by']) {
    if (isAxisValue(obj[key])) obj[key] = onvif ? 'onvif' : 'http-probe';
  }
  for (const key of ['methods', 'detectionMethods', 'detection_methods', 'sources']) {
    if (Array.isArray(obj[key])) obj[key] = obj[key].filter((item) => !isAxisValue(item));
  }
  obj.axisVerified = false;
  obj.axisHintRejected = true;
  return obj;
}

function sanitizeAxisHints(value) {
  if (!value || typeof value !== 'object') return value;
  return sanitizeObject(value, new WeakSet());
}

function createAxisEvidenceGuardMiddleware() {
  return function axisEvidenceGuard(req, res, next) {
    const route = String(req.originalUrl || req.url || req.path || '');
    const relevant = /\/(?:api\/)?(?:camera|cameras|discovery|discover|scan|setup|onvif|profiles?)(?:\/|\?|$)/i.test(route);
    if (!relevant) return next();

    // Remove weak discovery/manufacturer hints before camera setup chooses a driver.
    if (req.body && typeof req.body === 'object') sanitizeAxisHints(req.body);

    // Also clean discovery responses so the browser never carries a false Axis hint forward.
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(sanitizeAxisHints(payload));
    next();
  };
}

export { isVerifiedAxisIdentity, sanitizeAxisHints, createAxisEvidenceGuardMiddleware };

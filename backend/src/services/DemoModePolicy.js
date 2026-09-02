const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const SAFE_MUTATIONS = Object.freeze([
  { method: 'POST', pattern: /^\/internal\/go2rtc-auth$/ },
  { method: 'POST', pattern: /^\/api\/auth\/login$/ },
  { method: 'POST', pattern: /^\/api\/auth\/ws-token$/ },
  { method: 'POST', pattern: /^\/api\/streams\/[^/]+\/(?:session|heartbeat|client-event)$/ },
  { method: 'POST', pattern: /^\/api\/recordings\/\d+\/token$/ },
  { method: 'POST', pattern: /^\/api\/recordings\/cameras\/[^/]+\/plans\/preview$/ },
  { method: 'POST', pattern: /^\/api\/recordings\/export\/preview$/ },
  // Authentication and admin authorization are enforced by systemRouter after this policy.
  { method: 'PUT', pattern: /^\/api\/system\/demo-mode$/ },
]);

export function demoModePolicyAllowsRequest(method, pathname, runtime = {}) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = String(pathname || '').split('?')[0];
  if (!runtime.demoMode || SAFE_METHODS.has(normalizedMethod)) return true;
  if (runtime.allowExports && normalizedMethod === 'POST' && normalizedPath === '/api/recordings/export') return true;
  return SAFE_MUTATIONS.some((rule) => rule.method === normalizedMethod && rule.pattern.test(normalizedPath));
}

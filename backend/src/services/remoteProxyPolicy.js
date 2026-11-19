export function allowedProxyRequest(method, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') ||
      pathname.startsWith('//') || pathname.includes('\\') ||
      /%2f|%5c|%00|\.\./i.test(pathname)) return false;
  let path;
  try {
    const parsed = new URL(pathname, 'http://camera.internal');
    if (parsed.origin !== 'http://camera.internal') return false;
    path = parsed.pathname;
  } catch { return false; }
  if (method === 'GET') {
    // Cloud archive: list/segments/short transcoded clips only. Reject writes,
    // raw recordings, privileged exports, arbitrary filters and token URLs.
    if (path === '/api/recordings') {
      return pathname === '/api/recordings?limit=100'
        || /^\/api\/recordings\?cameraId=[A-Za-z0-9_-]{1,90}&limit=100$/.test(pathname);
    }
    if (/^\/api\/recordings\/[1-9][0-9]{0,9}\/segments$/.test(path)) return parsed.search === '';
    if (/^\/api\/recordings\/[1-9][0-9]{0,9}\/cloud\/(?:file|[1-9][0-9]{0,9})\/clip\/(?:0|[1-9][0-9]{0,3})\.ts$/.test(path)) return parsed.search === '';
  }
  if (method === 'POST') return path === '/api/auth/login';
  if (method !== 'GET') return false;
  return path === '/api/cameras'
    || /^\/api\/streams\/[A-Za-z0-9_-]{1,90}\/preview$/.test(path)
    || /^\/api\/cameras\/[A-Za-z0-9_-]{1,90}\/thumbnail$/.test(path)
    || /^\/live-hls\/[A-Za-z0-9_.-]{1,180}\/(?:index\.m3u8|seg_[0-9]+\.ts)$/.test(path);
}

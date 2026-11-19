/**
 * Send large camera/HLS responses in Plesk-safe ordered chunks.
 * The PHP portal may enforce a ~1 MiB client_max_body_size; the legacy result
 * endpoint is retained for smaller replies and older portal versions.
 */
export const REMOTE_PROXY_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const REMOTE_PROXY_BASE64_CHUNK_CHARS = 480_000;

export function encodeRemoteProxyResult(jobId, code, type, bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Expected a Buffer for the media response');
  if (bytes.byteLength > REMOTE_PROXY_MAX_RESPONSE_BYTES) throw new RangeError('RESPONSE_TOO_LARGE');
  const base64 = bytes.toString('base64');
  const base = { id: jobId, code, type };
  if (base64.length <= REMOTE_PROXY_BASE64_CHUNK_CHARS) {
    return [{ kind: 'result', payload: { ...base, data: base64 } }];
  }
  const total = Math.ceil(base64.length / REMOTE_PROXY_BASE64_CHUNK_CHARS);
  return Array.from({ length: total }, (_, part) => ({
    kind: 'result-chunk',
    payload: { ...base, part, total, data: base64.slice(part * REMOTE_PROXY_BASE64_CHUNK_CHARS, (part + 1) * REMOTE_PROXY_BASE64_CHUNK_CHARS) },
  }));
}

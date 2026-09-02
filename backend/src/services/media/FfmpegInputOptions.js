/**
 * FFmpeg input options shared by live streaming, probing and snapshot fallback.
 *
 * Deliberately no `-rw_timeout`, `-stimeout` or generic `-timeout` is added.
 * These private/protocol AVOptions differ between FFmpeg builds and can make the
 * process abort before the input is opened. Time limits are enforced by the
 * Node.js process watchdogs in the calling services instead.
 */
export function normalizeRtspTransport(transport = 'tcp') {
  if (transport === 'udp') return 'udp';
  if (transport === 'http') return 'http';
  return 'tcp';
}

export function buildMediaInputArgs(uri, transport = 'tcp', { threadQueueSize = null, reconnectAtEof = true } = {}) {
  const protocol = new URL(uri).protocol.toLowerCase();
  const args = [];

  if (threadQueueSize) args.push('-thread_queue_size', String(threadQueueSize));
  if (['rtsp:', 'rtsps:'].includes(protocol)) args.push('-rtsp_transport', normalizeRtspTransport(transport));
  if (['http:', 'https:'].includes(protocol)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1');
    if (reconnectAtEof) args.push('-reconnect_at_eof', '1');
    args.push('-reconnect_delay_max', '3');
  }

  return args;
}

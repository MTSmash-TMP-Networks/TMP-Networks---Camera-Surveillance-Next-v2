import { api } from './api.js';

export function connectEventSocket({ onEvent, onState = () => {} } = {}) {
  let socket = null;
  let stopped = false;
  let retryTimer = null;
  let attempts = 0;

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    const delay = Math.min(15_000, 1000 * (2 ** Math.min(attempts, 4)));
    retryTimer = globalThis.setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (stopped) return;
    onState('connecting');
    try {
      const grant = await api.websocketToken();
      if (stopped) return;
      const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${globalThis.location.host}/ws/events?token=${encodeURIComponent(grant.token)}`);
      socket.addEventListener('open', () => {
        attempts = 0;
        onState('connected');
      });
      socket.addEventListener('message', (message) => {
        try { onEvent?.(JSON.parse(message.data)); } catch { /* invalid event ignored */ }
      });
      socket.addEventListener('close', () => {
        socket = null;
        if (!stopped) {
          attempts += 1;
          onState('disconnected');
          scheduleReconnect();
        }
      });
      socket.addEventListener('error', () => socket?.close());
    } catch {
      attempts += 1;
      onState('disconnected');
      scheduleReconnect();
    }
  };

  void connect();
  return () => {
    stopped = true;
    if (retryTimer) globalThis.clearTimeout(retryTimer);
    retryTimer = null;
    socket?.close();
    socket = null;
  };
}

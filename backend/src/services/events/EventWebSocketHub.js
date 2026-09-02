import crypto from 'node:crypto';
import { config } from '../../config.js';
import { authService } from '../authService.js';
import { domainEventBus } from './DomainEventBus.js';
import { logger } from '../../utils/logger.js';

const roleRank = { viewer: 1, operator: 2, admin: 3 };

function frame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const header = [];
  header.push(0x80 | opcode);
  if (data.length < 126) header.push(data.length);
  else if (data.length <= 0xffff) header.push(126, (data.length >>> 8) & 0xff, data.length & 0xff);
  else {
    const length = BigInt(data.length);
    header.push(127, 0, 0, 0, 0, Number((length >> 24n) & 0xffn), Number((length >> 16n) & 0xffn), Number((length >> 8n) & 0xffn), Number(length & 0xffn));
  }
  return Buffer.concat([Buffer.from(header), data]);
}

function parseFrames(client, chunk, onFrame) {
  if (client.buffer.length + chunk.length > config.websocketMaxMessageBytes + 14) {
    throw new Error('websocket-buffer-too-large');
  }
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const final = Boolean(first & 0x80);
    const reserved = first & 0x70;
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    if (!final || reserved) throw new Error('websocket-fragmentation-not-supported');
    // RFC 6455 requires all client-to-server frames to be masked.
    if (!masked) throw new Error('websocket-client-frame-not-masked');
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const value = client.buffer.readBigUInt64BE(2);
      if (value > BigInt(config.websocketMaxMessageBytes)) throw new Error('websocket-message-too-large');
      length = Number(value);
      offset = 10;
    }
    if (length > config.websocketMaxMessageBytes) throw new Error('websocket-message-too-large');
    if (opcode >= 0x8 && length > 125) throw new Error('websocket-control-frame-too-large');
    const maskBytes = 4;
    if (client.buffer.length < offset + maskBytes + length) return;
    let payload = client.buffer.subarray(offset + maskBytes, offset + maskBytes + length);
    const mask = client.buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    client.buffer = client.buffer.subarray(offset + maskBytes + length);
    onFrame(opcode, payload);
  }
}

function sameOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  if (config.websocketAllowedOrigins.length) return config.websocketAllowedOrigins.includes(origin);
  try { return new URL(origin).host === String(req.headers.host || ''); }
  catch { return false; }
}

class EventWebSocketHub {
  constructor() {
    this.clients = new Set();
    this.server = null;
    this.closed = false;
    this.upgradeHandler = this.handleUpgrade.bind(this);
    this.eventHandler = (event) => this.broadcast(event);
    this.heartbeatTimer = null;
    domainEventBus.on('event', this.eventHandler);
  }

  attach(server) {
    if (this.server || this.closed) return;
    this.server = server;
    server.on('upgrade', this.upgradeHandler);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), config.websocketHeartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  reject(socket, status, message) {
    if (socket.destroyed) return;
    const text = String(message || 'WebSocket request rejected');
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
  }

  handleUpgrade(req, socket, head) {
    let url;
    try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); }
    catch { this.reject(socket, '400 Bad Request', 'Invalid WebSocket URL'); return; }
    if (url.pathname !== '/ws/events') { this.reject(socket, '404 Not Found', 'WebSocket endpoint not found'); return; }
    if (this.closed || this.clients.size >= config.websocketMaxClients) {
      this.reject(socket, '503 Service Unavailable', 'WebSocket capacity reached');
      return;
    }
    if (!sameOrigin(req)) {
      this.reject(socket, '403 Forbidden', 'Origin is not allowed');
      return;
    }
    const key = String(req.headers['sec-websocket-key'] || '');
    if (!key
      || String(req.headers.upgrade || '').toLowerCase() !== 'websocket'
      || String(req.headers['sec-websocket-version'] || '') !== '13') {
      this.reject(socket, '400 Bad Request', 'Invalid WebSocket handshake');
      return;
    }
    let user;
    try { user = authService.verifyWebSocketToken(url.searchParams.get('token') || ''); }
    catch { this.reject(socket, '401 Unauthorized', 'Invalid WebSocket token'); return; }
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'));
    const client = { socket, user, alive: true, buffer: Buffer.alloc(0), connectedAt: Date.now() };
    this.clients.add(client);
    socket.setNoDelay(true);
    socket.on('data', (chunk) => {
      client.alive = true;
      try {
        parseFrames(client, chunk, (opcode, payload) => {
          if (opcode === 0x8) this.closeClient(client);
          else if (opcode === 0x9) this.write(client, payload, 0xA);
          else if (opcode === 0xA) client.alive = true;
        });
      } catch (error) {
        logger.warn({ err: error, userId: user.sub }, 'Ungueltige WebSocket-Nachricht wurde verworfen');
        this.closeClient(client);
      }
    });
    socket.on('error', () => this.removeClient(client));
    socket.on('close', () => this.removeClient(client));
    if (head?.length) socket.emit('data', head);
    this.send(client, {
      id: crypto.randomUUID(), sequence: domainEventBus.status().sequence, type: 'system.hello', source: 'websocket',
      minRole: 'viewer', createdAt: new Date().toISOString(), payload: { user: user.username, role: user.role },
    });
  }

  write(client, payload, opcode = 0x1) {
    if (client.socket.destroyed || !client.socket.writable) return false;
    if (client.socket.writableLength > config.websocketMaxBufferedBytes) {
      this.closeClient(client);
      return false;
    }
    try { return client.socket.write(frame(payload, opcode)); }
    catch { this.closeClient(client); return false; }
  }

  send(client, event) {
    return this.write(client, JSON.stringify(event), 0x1);
  }

  broadcast(event) {
    for (const client of this.clients) {
      if ((roleRank[client.user.role] || 0) < (roleRank[event.minRole] || 0)) continue;
      this.send(client, event);
    }
  }

  heartbeat() {
    for (const client of this.clients) {
      if (!client.alive) { this.closeClient(client); continue; }
      try {
        client.user = authService.revalidateWebSocketUser(client.user);
      } catch {
        this.closeClient(client);
        continue;
      }
      client.alive = false;
      this.write(client, Buffer.alloc(0), 0x9);
    }
  }

  closeClient(client) {
    if (!client || client.socket.destroyed) { this.removeClient(client); return; }
    try { this.write(client, Buffer.alloc(0), 0x8); } catch { /* ignore */ }
    client.socket.destroy();
    this.removeClient(client);
  }

  removeClient(client) {
    if (client) this.clients.delete(client);
  }

  status() {
    return { clients: this.clients.size, maxClients: config.websocketMaxClients, eventBus: domainEventBus.status() };
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.server) this.server.off('upgrade', this.upgradeHandler);
    for (const client of [...this.clients]) this.closeClient(client);
    this.clients.clear();
    domainEventBus.off('event', this.eventHandler);
    this.server = null;
  }
}

export const eventWebSocketHub = new EventWebSocketHub();

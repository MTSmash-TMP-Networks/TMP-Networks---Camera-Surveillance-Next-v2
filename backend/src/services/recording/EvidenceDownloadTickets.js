import crypto from 'node:crypto';
import { authService } from '../authService.js';
import { AppError } from '../../utils/errors.js';

const TTL_MS = 5 * 60_000;
const MAX_TICKETS = 32;
const MAX_ACTIVE = 2;

/**
 * Each ticket is scoped to one recording-evidence export and bound to an
 * authenticated operator's current auth_version. A query token can therefore
 * never be used to request arbitrary files or a second export.
 */
export class EvidenceDownloadTickets {
  constructor() {
    this.tickets = new Map();
    this.active = 0;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(id);
    }
  }

  create(input, session) {
    this.cleanup();
    authService.requireRole(session?.role, 'operator');
    if (this.tickets.size >= MAX_TICKETS) {
      throw new AppError(429, 'EXPORT_TICKETS_BUSY', 'Zu viele vorbereitete Exporte. Bitte etwas spaeter erneut versuchen.');
    }
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + TTL_MS;
    this.tickets.set(id, { input: structuredClone(input), userId: session.sub,
      version: session.ver, expiresAt });
    const token = authService.signMediaToken({
      userId: session.sub, path: `evidence-export:${id}`, action: 'read', expiresIn: 300,
    });
    return {
      downloadUrl: `/api/recordings/export/download/${id}?token=${encodeURIComponent(token)}`,
      filename: 'TMP_Behoerdenexport_' + input.date + '_' +
        input.startTime.replace(':', '') + '-' + input.endTime.replace(':', '') + '.zip',
      expiresInSeconds: 300,
    };
  }

  take(id, token) {
    this.cleanup();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id))) {
      throw new AppError(404, 'EXPORT_TICKET_NOT_FOUND', 'Exportfreigabe wurde nicht gefunden');
    }
    const payload = authService.verifyMediaToken(String(token || ''), {
      path: `evidence-export:${id}`, action: 'read',
    });
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.userId !== payload.sub || ticket.expiresAt <= Date.now()) {
      throw new AppError(404, 'EXPORT_TICKET_EXPIRED', 'Exportfreigabe abgelaufen. Export erneut starten.');
    }
    const account = authService.revalidateWebSocketUser({
      sub: ticket.userId, ver: ticket.version,
    });
    authService.requireRole(account.role, 'operator');
    if (this.active >= MAX_ACTIVE) {
      throw new AppError(429, 'EXPORT_STREAM_BUSY', 'Es laufen bereits zwei Behoerdenexporte. Bitte nach Abschluss erneut versuchen.');
    }
    this.tickets.delete(id); // no replay of a private evidence URL
    this.active += 1;
    let closed = false;
    return {
      input: ticket.input,
      requestedBy: ticket.userId,
      release: () => {
        if (closed) return;
        closed = true;
        this.active = Math.max(0, this.active - 1);
      },
    };
  }
}

export const evidenceDownloadTickets = new EvidenceDownloadTickets();

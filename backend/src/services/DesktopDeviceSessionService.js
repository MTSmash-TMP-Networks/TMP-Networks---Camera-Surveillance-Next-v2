import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { AppError } from '../utils/errors.js';

// An opaque, revocable device grant. No password or bearer access token is
// written to disk. Electron's persistent Chromium cookie jar stores the
// HttpOnly cookie; the database only stores a SHA-256 digest.
export const DESKTOP_COOKIE_NAME = 'tmp_camera_desktop';
export const DESKTOP_COOKIE_PATH = '/api/auth/desktop';
export const DESKTOP_IDLE_DAYS = 90;
const IDLE_MS = DESKTOP_IDLE_DAYS * 24 * 60 * 60 * 1000;
const MAX_DEVICES_PER_USER = 12;
const digest = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const nowIso = () => new Date().toISOString();

function lookup(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AppError(401, 'DESKTOP_SESSION_INVALID', 'Geraetesitzung ist nicht verfuegbar');
  }
  const row = db.prepare(`SELECT d.*, u.enabled, u.auth_version, u.username, u.role,
    u.password_hash, u.created_at AS user_created_at, u.updated_at AS user_updated_at,
    u.last_login_at
    FROM desktop_sessions d INNER JOIN users u ON u.id=d.user_id WHERE d.token_hash=?`).get(digest(token));
  if (!row || !row.enabled || Number(row.auth_version) !== Number(row.user_auth_version) ||
      row.expires_at <= nowIso()) {
    throw new AppError(401, 'DESKTOP_SESSION_INVALID', 'Geraetesitzung ist abgelaufen oder wurde widerrufen');
  }
  return row;
}

export const desktopDeviceSessionService = {
  issue(userId, label = 'Linux Kiosk') {
    const user = db.prepare('SELECT id, auth_version FROM users WHERE id=? AND enabled=1').get(userId);
    if (!user) throw new AppError(401, 'DESKTOP_SESSION_INVALID', 'Benutzer ist nicht aktiv');
    const token = crypto.randomBytes(32).toString('base64url');
    const now = nowIso();
    const expiresAt = new Date(Date.now() + IDLE_MS).toISOString();
    const name = String(label || 'Linux Kiosk').trim().slice(0, 80) || 'Linux Kiosk';
    db.prepare('DELETE FROM desktop_sessions WHERE expires_at <= ?').run(now);
    const previous = db.prepare('SELECT id FROM desktop_sessions WHERE user_id=? ORDER BY last_seen_at DESC').all(userId);
    for (const old of previous.slice(MAX_DEVICES_PER_USER - 1)) {
      db.prepare('DELETE FROM desktop_sessions WHERE id=?').run(old.id);
    }
    db.prepare(`INSERT INTO desktop_sessions
      (id,user_id,token_hash,user_auth_version,label,created_at,last_seen_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), userId, digest(token), Number(user.auth_version || 1),
      name, now, now, expiresAt);
    return { token, expiresAt, maxAgeSeconds: Math.floor(IDLE_MS / 1000) };
  },

  renew(token) {
    const row = lookup(token);
    const now = nowIso();
    const expiresAt = new Date(Date.now() + IDLE_MS).toISOString();
    db.prepare('UPDATE desktop_sessions SET last_seen_at=?,expires_at=? WHERE id=?').run(now, expiresAt, row.id);
    const user = db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(row.user_id);
    return { user, token, expiresAt, maxAgeSeconds: Math.floor(IDLE_MS / 1000) };
  },

  revoke(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    return db.prepare('DELETE FROM desktop_sessions WHERE token_hash=?').run(digest(token)).changes > 0;
  },
};

export function parseDesktopCookie(req) {
  const raw = String(req.headers.cookie || '');
  for (const pair of raw.split(';')) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(`${DESKTOP_COOKIE_NAME}=`)) {
      return trimmed.slice(DESKTOP_COOKIE_NAME.length + 1);
    }
  }
  return null;
}

// Same-origin cookie renewal must never accept a cross-site POST, including
// reverse-proxy installations. Browsers send Origin for POST fetch requests.
export function requireDesktopSameOrigin(req) {
  const origin = req.get('origin');
  const host = req.get('host');
  try {
    if (!origin || !host || new URL(origin).host !== host) throw new Error('cross-site');
    const protocol = new URL(origin).protocol;
    if (!['http:', 'https:'].includes(protocol) || (req.secure && protocol !== 'https:')) {
      throw new Error('wrong-protocol');
    }
  } catch {
    throw new AppError(403, 'DESKTOP_ORIGIN_FORBIDDEN', 'Desktop-Session nur von demselben Server erlaubt');
  }
}

export function setDesktopCookie(req, res, token, maxAgeSeconds) {
  // The Origin header is verified against Host by requireDesktopSameOrigin.
  // HTTPS may terminate at an nginx proxy even when req.secure is false.
  const secure = req.secure || /^https:\/\//i.test(String(req.get('origin') || '')) ? '; Secure' : '';
  res.set('Set-Cookie', `${DESKTOP_COOKIE_NAME}=${token || ''}; Path=${DESKTOP_COOKIE_PATH}; HttpOnly; SameSite=Strict${secure}; Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`);
  res.set('Cache-Control', 'private, no-store, max-age=0');
}

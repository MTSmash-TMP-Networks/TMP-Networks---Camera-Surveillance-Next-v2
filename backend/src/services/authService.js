import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/database.js';
import { config } from '../config.js';
import { demoModeSettingsService } from './DemoModeSettingsService.js';
import { AppError } from '../utils/errors.js';

const roleRank = { viewer: 1, operator: 2, admin: 3 };

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    enabled: Boolean(user.enabled),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at || null,
  };
}

function enabledAdminCount(excludeId = null) {
  if (excludeId) return Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE enabled=1 AND role='admin' AND id<>?").get(excludeId)?.count || 0);
  return Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE enabled=1 AND role='admin'").get()?.count || 0);
}

function assertLastAdminSafe(user, changes) {
  if (!user || user.role !== 'admin' || !user.enabled) return;
  const remainsAdmin = (changes.role ?? user.role) === 'admin';
  const remainsEnabled = changes.enabled === undefined ? Boolean(user.enabled) : Boolean(changes.enabled);
  if ((!remainsAdmin || !remainsEnabled) && enabledAdminCount(user.id) < 1) {
    throw new AppError(409, 'LAST_ADMIN_REQUIRED', 'Der letzte aktive Administrator darf nicht deaktiviert oder herabgestuft werden');
  }
}

export const authService = {
  authenticate(username, password) {
    const user = db.prepare('SELECT * FROM users WHERE username=? AND enabled=1').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Benutzername oder Kennwort ist falsch');
    }
    if (demoModeSettingsService.status().demoMode) return this.issueAccessToken(user);
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at=?, updated_at=? WHERE id=?').run(now, now, user.id);
    return this.issueAccessToken({ ...user, last_login_at: now, updated_at: now });
  },

  issueAccessToken(user) {
    const authVersion = Number(user.auth_version || 1);
    const token = jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
      ver: authVersion,
      type: 'access',
    }, config.jwtSecret, {
      expiresIn: config.accessTokenTtl,
      issuer: 'tmp-camera-server',
      audience: 'tmp-camera-ui',
    });
    return { token, user: publicUser(user) };
  },

  verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret, { issuer: 'tmp-camera-server', audience: 'tmp-camera-ui' });
      if (payload.type !== 'access' || !payload.sub) throw new Error('token-type');
      const user = db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(payload.sub);
      if (!user || Number(payload.ver || 1) !== Number(user.auth_version || 1)) throw new Error('session-revoked');
      return {
        sub: user.id,
        username: user.username,
        role: user.role,
        ver: Number(user.auth_version || 1),
        type: 'access',
        iat: payload.iat,
        exp: payload.exp,
      };
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Sitzung ist ungueltig, abgelaufen oder wurde widerrufen');
    }
  },

  requireRole(userRole, neededRole) {
    if ((roleRank[userRole] || 0) < (roleRank[neededRole] || 0)) {
      throw new AppError(403, 'FORBIDDEN', 'Fuer diese Aktion fehlen Berechtigungen');
    }
  },

  changePassword(userId, currentPassword, newPassword) {
    const user = db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(userId);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      throw new AppError(401, 'INVALID_CURRENT_PASSWORD', 'Das aktuelle Kennwort ist falsch');
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash=?, auth_version=auth_version+1, updated_at=? WHERE id=?')
      .run(bcrypt.hashSync(newPassword, 12), now, userId);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    return { ok: true, ...this.issueAccessToken(updated) };
  },

  createUser({ username, password, role }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    try {
      db.prepare(`INSERT INTO users(id,username,password_hash,role,enabled,created_at,updated_at,auth_version) VALUES(?,?,?,?,1,?,?,1)`)
        .run(id, username, bcrypt.hashSync(password, 12), role, now, now);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new AppError(409, 'USER_EXISTS', 'Benutzername existiert bereits');
      throw error;
    }
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  },

  updateUser(userId, changes = {}) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Benutzer wurde nicht gefunden');
    assertLastAdminSafe(user, changes);
    const updates = [];
    const values = [];
    if (changes.role !== undefined) { updates.push('role=?'); values.push(changes.role); }
    if (changes.enabled !== undefined) { updates.push('enabled=?'); values.push(changes.enabled ? 1 : 0); }
    if (changes.password) { updates.push('password_hash=?'); values.push(bcrypt.hashSync(changes.password, 12)); }
    if (!updates.length) return publicUser(user);
    updates.push('auth_version=auth_version+1');
    updates.push('updated_at=?');
    values.push(new Date().toISOString(), userId);
    db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...values);
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(userId));
  },

  listUsers() {
    return db.prepare('SELECT * FROM users ORDER BY username').all().map(publicUser);
  },

  signWebSocketToken(userId) {
    const user = db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(userId);
    if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Sitzung ist ungueltig oder wurde widerrufen');
    const token = jwt.sign({ sub: user.id, role: user.role, ver: Number(user.auth_version || 1), type: 'websocket' }, config.jwtSecret, {
      expiresIn: 60,
      issuer: 'tmp-camera-server',
      audience: 'tmp-camera-events',
    });
    return { token, expiresInSeconds: 60 };
  },

  verifyWebSocketToken(token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret, { issuer: 'tmp-camera-server', audience: 'tmp-camera-events' });
      if (payload.type !== 'websocket' || !payload.sub) throw new Error('token-type');
      const user = db.prepare('SELECT * FROM users WHERE id=? AND enabled=1').get(payload.sub);
      if (!user || Number(payload.ver || 1) !== Number(user.auth_version || 1)) throw new Error('session-revoked');
      return {
        sub: user.id,
        username: user.username,
        role: user.role,
        ver: Number(user.auth_version || 1),
      };
    } catch {
      throw new AppError(401, 'INVALID_WEBSOCKET_TOKEN', 'WebSocket-Freigabe ist ungueltig oder abgelaufen');
    }
  },

  revalidateWebSocketUser(session) {
    const user = db.prepare('SELECT id,username,role,enabled,auth_version FROM users WHERE id=?').get(session?.sub);
    if (!user || !user.enabled || Number(user.auth_version || 1) !== Number(session?.ver || 1)) {
      throw new AppError(401, 'WEBSOCKET_SESSION_REVOKED', 'WebSocket-Sitzung wurde widerrufen');
    }
    return {
      sub: user.id,
      username: user.username,
      role: user.role,
      ver: Number(user.auth_version || 1),
    };
  },

  signMediaToken({ userId, path, action, expiresIn = config.mediaTokenTtlSeconds }) {
    return jwt.sign({ sub: userId, path, action, type: 'media' }, config.mediaTokenSecret, {
      expiresIn,
      issuer: 'tmp-camera-server',
      audience: 'stream-broker',
    });
  },

  verifyMediaToken(token, { path, action }) {
    try {
      const payload = jwt.verify(token, config.mediaTokenSecret, { issuer: 'tmp-camera-server', audience: 'stream-broker' });
      if (payload.type !== 'media' || payload.path !== path || payload.action !== action) throw new Error('scope');
      return payload;
    } catch {
      throw new AppError(401, 'INVALID_MEDIA_TOKEN', 'Medienfreigabe ist ungueltig oder abgelaufen');
    }
  },

  verifyAnyMediaToken(token, { action = 'read' } = {}) {
    try {
      const payload = jwt.verify(token, config.mediaTokenSecret, { issuer: 'tmp-camera-server', audience: 'stream-broker' });
      if (payload.type !== 'media' || payload.action !== action || !payload.path) throw new Error('scope');
      return payload;
    } catch {
      throw new AppError(401, 'INVALID_MEDIA_TOKEN', 'Medienfreigabe ist ungueltig oder abgelaufen');
    }
  },
};

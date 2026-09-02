import crypto from 'node:crypto';

export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'demo';
export const DEMO_ROLE = 'viewer';

function publicDemoUser(row) {
  if (!row) return { exists: false, username: DEMO_USERNAME, role: DEMO_ROLE, enabled: false };
  return {
    exists: true,
    id: row.id,
    username: row.username,
    role: row.role,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at || null,
  };
}

export class DemoUserService {
  constructor(database, { hashPassword, randomUUID = () => crypto.randomUUID() } = {}) {
    if (!database) throw new TypeError('database is required');
    if (typeof hashPassword !== 'function') throw new TypeError('hashPassword is required');
    this.db = database;
    this.hashPassword = hashPassword;
    this.randomUUID = randomUUID;
  }

  get() {
    return publicDemoUser(this.db.prepare('SELECT id,username,role,enabled,updated_at FROM users WHERE username=?').get(DEMO_USERNAME));
  }

  enable() {
    const now = new Date().toISOString();
    const passwordHash = this.hashPassword(DEMO_PASSWORD);
    const existing = this.db.prepare('SELECT id FROM users WHERE username=?').get(DEMO_USERNAME);
    if (existing) {
      this.db.prepare(`UPDATE users
        SET password_hash=?, role=?, enabled=1, auth_version=auth_version+1, updated_at=?
        WHERE id=?`)
        .run(passwordHash, DEMO_ROLE, now, existing.id);
    } else {
      this.db.prepare(`INSERT INTO users(id,username,password_hash,role,enabled,created_at,updated_at,auth_version)
        VALUES(?,?,?,?,1,?,?,1)`)
        .run(this.randomUUID(), DEMO_USERNAME, passwordHash, DEMO_ROLE, now, now);
    }
    return this.get();
  }

  disable() {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE users
      SET enabled=0, auth_version=auth_version+1, updated_at=?
      WHERE username=? AND enabled=1`)
      .run(now, DEMO_USERNAME);
    return this.get();
  }
}

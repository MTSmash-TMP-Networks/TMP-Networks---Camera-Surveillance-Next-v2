import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DemoUserService, DEMO_USERNAME, DEMO_PASSWORD, DEMO_ROLE } from '../src/services/DemoUserService.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    auth_version INTEGER NOT NULL DEFAULT 1
  )`);
  const service = new DemoUserService(db, { hashPassword: (password) => `hash:${password}`, randomUUID: () => 'demo-user-id' });
  return { db, service };
}

test('demo user is created as enabled viewer with demo/demo credentials', () => {
  const { db, service } = fixture();
  const user = service.enable();
  assert.equal(user.username, DEMO_USERNAME);
  assert.equal(user.role, DEMO_ROLE);
  assert.equal(user.enabled, true);
  const stored = db.prepare('SELECT * FROM users WHERE username=?').get(DEMO_USERNAME);
  assert.equal(stored.password_hash, `hash:${DEMO_PASSWORD}`);
  db.close();
});

test('enabling demo mode reactivates and normalizes an existing demo account', () => {
  const { db, service } = fixture();
  service.enable();
  const before = db.prepare('SELECT auth_version FROM users WHERE username=?').get(DEMO_USERNAME).auth_version;
  db.prepare("UPDATE users SET enabled=0, role='admin', password_hash='hash:different' WHERE username=?").run(DEMO_USERNAME);
  service.enable();
  const stored = db.prepare('SELECT * FROM users WHERE username=?').get(DEMO_USERNAME);
  assert.equal(stored.enabled, 1);
  assert.equal(stored.role, DEMO_ROLE);
  assert.equal(stored.password_hash, `hash:${DEMO_PASSWORD}`);
  assert.ok(stored.auth_version > before);
  db.close();
});

test('disabling demo user revokes sessions and prevents login eligibility', () => {
  const { db, service } = fixture();
  service.enable();
  const before = db.prepare('SELECT auth_version FROM users WHERE username=?').get(DEMO_USERNAME).auth_version;
  const user = service.disable();
  const stored = db.prepare('SELECT * FROM users WHERE username=?').get(DEMO_USERNAME);
  assert.equal(user.enabled, false);
  assert.equal(stored.enabled, 0);
  assert.ok(stored.auth_version > before);
  db.close();
});

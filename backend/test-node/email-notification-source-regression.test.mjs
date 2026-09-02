import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const service = readFileSync(resolve(root, 'backend/src/services/notifications/EmailNotificationService.js'), 'utf8');
const settings = readFileSync(resolve(root, 'backend/src/services/notifications/NotificationSettingsService.js'), 'utf8');
const smtp = readFileSync(resolve(root, 'backend/src/services/notifications/SmtpClient.js'), 'utf8');
const systemRoute = readFileSync(resolve(root, 'backend/src/routes/system.js'), 'utf8');
const health = readFileSync(resolve(root, 'backend/src/services/healthMonitor.js'), 'utf8');
const app = readFileSync(resolve(root, 'frontend/src/App.jsx'), 'utf8');
const navigation = readFileSync(resolve(root, 'frontend/src/config/navigation.js'), 'utf8');
const page = readFileSync(resolve(root, 'frontend/src/pages/NotificationsPage.jsx'), 'utf8');

test('notification engine covers operational NVR event classes with cooldown and recovery', () => {
  assert.match(service, /MOTION_DETECTED/); assert.match(service, /CAMERA_OFFLINE/); assert.match(service, /STREAM_START_FAILED/); assert.match(service, /RECORDING_STALLED/); assert.match(service, /streamRecovered/); assert.match(service, /recordingRecovered/); assert.match(service, /cooldownSeconds/); assert.match(service, /handled_by_camera_event/); assert.match(service, /cameraName/);
});
test('SMTP password remains encrypted at rest and is not returned as plaintext', () => {
  assert.match(settings, /encryptSecret\(input\.password\)/); assert.match(settings, /decryptSecret\(encrypted\)/); assert.match(settings, /passwordConfigured/); assert.doesNotMatch(settings, /password:\s*decryptSecret/);
});
test('SMTP transport supports plain relay, STARTTLS and implicit TLS without third-party mail library', () => {
  assert.match(smtp, /security === 'tls'/); assert.match(smtp, /security === 'starttls'/); assert.match(smtp, /AUTH PLAIN/); assert.match(smtp, /AUTH LOGIN/);
});
test('admin routes expose settings, test delivery and delivery history', () => {
  assert.match(systemRoute, /\/notifications\/email'/); assert.match(systemRoute, /\/notifications\/email\/test/); assert.match(systemRoute, /\/notifications\/email\/deliveries/);
});
test('camera health transitions produce stable notification event codes', () => {
  assert.match(health, /CAMERA_ONLINE/); assert.match(health, /CAMERA_OFFLINE/); assert.match(health, /camera\.status !== nextStatus/);
});
test('notification center is reachable from the administration navigation', () => {
  assert.match(app, /NotificationsPage/); assert.match(app, /\/system\/notifications/); assert.match(navigation, /nav\.notifications/); assert.match(page, /emailNotificationSettings/); assert.match(page, /testEmailNotification/);
});

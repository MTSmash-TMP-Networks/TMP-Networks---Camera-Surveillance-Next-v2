import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const service = readFileSync(resolve(root, 'backend/src/services/ai/AiEventAnalysisService.js'), 'utf8');
const settings = readFileSync(resolve(root, 'backend/src/services/ai/AiEventAnalysisSettingsService.js'), 'utf8');
const email = readFileSync(resolve(root, 'backend/src/services/notifications/EmailNotificationService.js'), 'utf8');
const route = readFileSync(resolve(root, 'backend/src/routes/system.js'), 'utf8');
const events = readFileSync(resolve(root, 'frontend/src/pages/EventsPage.jsx'), 'utf8');
const recordings = readFileSync(resolve(root, 'frontend/src/pages/RecordingsPage.jsx'), 'utf8');
const notifications = readFileSync(resolve(root, 'frontend/src/pages/NotificationsPage.jsx'), 'utf8');

test('AI event analysis captures event snapshots and requests structured vision output', () => {
  assert.match(service, /snapshotService\.capture\(cameraId\)/);
  assert.match(service, /input_image/);
  assert.match(service, /json_schema/);
  assert.match(service, /camera_event_analysis/);
  assert.match(service, /notification_recommended/);
  assert.match(service, /Do not identify or guess the identity/);
  assert.match(service, /Do not perform face recognition/);
});

test('OpenAI and compatible providers use separate controlled transport modes', () => {
  assert.match(settings, /provider: 'openai'/);
  assert.match(settings, /https:\/\/api\.openai\.com\/v1/);
  assert.match(settings, /gpt-5\.6-luna/);
  assert.match(settings, /apiMode: provider === 'openai' \? 'responses'/);
  assert.match(service, /chat\/completions/);
  assert.match(service, /OpenAI-kompatibler KI-Endpunkt wird ohne Structured-Output-Erweiterung erneut versucht/);
});

test('AI key is encrypted and never exposed through public settings', () => {
  assert.match(settings, /encryptSecret\(input\.apiKey\.trim\(\)\)/);
  assert.match(settings, /decryptSecret\(encrypted\)/);
  assert.match(settings, /apiKeyConfigured/);
  assert.match(settings, /delete next\.apiKey/);
});

test('motion analysis is shared with email notification and relevant-only filter fails open', () => {
  assert.match(email, /analyzeMotionPayload/);
  assert.match(email, /includeInEmail/);
  assert.match(email, /onlyRelevantNotifications/);
  assert.match(email, /aiResult\.analyzed && aiSettings\.onlyRelevantNotifications/);
  assert.match(service, /notificationRecommended: .* !== false/);
});

test('AI routes, UI settings, events and recordings expose the integrated feature', () => {
  assert.match(route, /\/notifications\/ai'/);
  assert.match(route, /\/notifications\/ai\/test/);
  assert.match(notifications, /aiEventAnalysisSettings/);
  assert.match(notifications, /testAiEventAnalysis/);
  assert.match(events, /event-ai-analysis/);
  assert.match(recordings, /metadata\?\.aiAnalysis/);
});

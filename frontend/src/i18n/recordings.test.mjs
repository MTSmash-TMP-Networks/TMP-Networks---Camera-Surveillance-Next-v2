import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from './languages.js';
import { recordingMessages } from './recordingMessages.js';
import { translate } from './messages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..');
const recordingSources = [
  'pages/RecordingsPage.jsx',
  'components/RecordingPlanEditor.jsx',
  'components/RetentionPolicyEditor.jsx',
  'components/RecordingArchivePlayer.jsx',
  'services/scheduleValidation.js',
].map((file) => path.join(frontendRoot, file));

function referencedRecordingKeys() {
  const result = new Set();
  for (const file of recordingSources) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`](recordings\.[A-Za-z0-9_.]+)['"`]/g)) {
      if (!match[1].endsWith('.')) result.add(match[1]);
    }
  }
  return [...result].sort();
}

describe('recordings localization', () => {
  it('provides a complete English source pack for every referenced recording key', () => {
    const missing = referencedRecordingKeys().filter((key) => !recordingMessages.en[key]);
    expect(missing).toEqual([]);
  });

  it('resolves every referenced recording key in every supported language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      for (const key of referencedRecordingKeys()) {
        expect(translate(language.code, key), `${language.code}: ${key}`).not.toBe(key);
      }
    }
  });

  it('keeps the main Recordings navigation native in all supported languages', () => {
    const nativeKeys = [
      'recordings.title', 'recordings.tabs.archive', 'recordings.tabs.export', 'recordings.tabs.planning',
      'recordings.timeline.title', 'recordings.export.title', 'recordings.plan.title', 'recordings.retention.title',
      'recordings.workflow.archive.description', 'recordings.timeline.description', 'recordings.export.description',
      'recordings.guide.typeDescription', 'recordings.retention.description', 'recordings.player.networkError',
      'recordings.error.API_NETWORK_ERROR',
    ];
    for (const language of SUPPORTED_LANGUAGES) {
      if (language.code === 'en') continue;
      for (const key of nativeKeys) {
        expect(translate(language.code, key), `${language.code}: ${key}`).not.toBe(translate('en', key));
      }
    }
  });

  it('contains no hard-coded German Recordings UI fragments in React source', () => {
    const forbidden = [
      'AUFNAHMEZENTRALE', 'Aufnahme-Archiv', 'Behördenexport', 'Aufnahmeplan & Aufbewahrung',
      'Laufende Aufnahmen', 'Zeitraum exportieren', 'Ausgewählte Kamera', 'Bereinigungsvorschau',
      'Bewegung testen', 'Planung speichern', 'Noch keine Aufnahme vorhanden',
    ];
    for (const file of recordingSources.filter((item) => item.endsWith('.jsx'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const fragment of forbidden) expect(source, `${path.basename(file)} contains ${fragment}`).not.toContain(fragment);
    }
  });
});

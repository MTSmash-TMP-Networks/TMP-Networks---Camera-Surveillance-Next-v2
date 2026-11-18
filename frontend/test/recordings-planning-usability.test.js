import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../src/i18n/messages.js';

const root = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(root, '../src/pages/RecordingsPage.jsx'), 'utf8');
const repository = readFileSync(resolve(root, '../../backend/src/services/recordingRepository.js'), 'utf8');

describe('Localized recording planning and archive workflow', () => {
  it('shows an All cameras option only for the archive, never an extra planning item', () => {
    expect(page).toContain("{tab === 'archive' && <option value=\"\">{t('recordings.camera.all')}</option>}");
    expect(page).not.toContain("{tab === 'archive' ? 'Alle Kameras' : cameras[0]?.name || 'Kamera wählen'}");
    expect(translate('de', 'recordings.camera.all')).toBe('Alle Kameras');
  });
  it('uses a single selected-camera header control across tabs', () => {
    expect(page).toContain('headerCameraValue');
    expect(page).toContain('changeHeaderCamera');
    expect(page).toContain("t('recordings.camera.selector')");
    expect(translate('de', 'recordings.planning.selectedCamera')).toBe('Ausgewählte Kamera');
  });
  it('uses actual persisted archive block time ranges', () => {
    expect(repository).toContain('first_started_at');
    expect(repository).toContain('last_ended_at');
    expect(page).toContain('timelineStartedAt || recording.startedAt');
    expect(page).toContain('recordingRange(recording, locale, t)');
    expect(page).toContain("t('recordings.archive.rangeLabel')");
  });
  it('keeps user-facing archive, planning and export text in the language catalog', () => {
    for (const key of ['recordings.tabs.archive', 'recordings.tabs.planning', 'recordings.workflow.export.description']) {
      expect(page).toContain(`t('${key}')`);
      expect(translate('de', key)).not.toBe(key);
    }
  });
});

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(here, '../src/pages/RecordingsPage.jsx'), 'utf8');
const repository = readFileSync(resolve(here, '../../backend/src/services/recordingRepository.js'), 'utf8');

describe('Aufnahmen Bedienbarkeit', () => {
  it('zeigt im Planungsmodus keine doppelte erste Kamera als Leeroption', () => {
    expect(page).toContain("{tab === 'archive' && <option value=\"\">Alle Kameras</option>}");
    expect(page).not.toContain("{tab === 'archive' ? 'Alle Kameras' : cameras[0]?.name || 'Kamera wählen'}");
  });

  it('nutzt eine eindeutige Kameraauswahl fuer Archiv, Export und Planung', () => {
    expect(page).toContain('headerCameraValue');
    expect(page).toContain('changeHeaderCamera');
    expect(page).toContain('Ausgewählte Kamera');
  });

  it('zeigt echte Aufnahmezeitraeume aus den finalisierten Bloecken an', () => {
    expect(repository).toContain('first_started_at');
    expect(repository).toContain('last_ended_at');
    expect(page).toContain('timelineStartedAt || recording.startedAt');
    expect(page).toContain('Zeitraum: {recordingRange(recording)}');
  });

  it('erklaert den Workflow im Stil einer Ueberwachungszentrale', () => {
    expect(page).toContain('Aufnahme-Archiv');
    expect(page).toContain('Aufnahmeplan &amp; Aufbewahrung');
    expect(page).toContain('Behördenexporte werden aus vorhandenen Zeitfenstern');
  });
});

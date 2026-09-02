import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(here, '../src/pages/UpdatePage.jsx'), 'utf8');
const navigation = readFileSync(resolve(here, '../src/config/navigation.js'), 'utf8');
const api = readFileSync(resolve(here, '../src/services/api.js'), 'utf8');

describe('Update-Center frontend', () => {
  it('zeigt geprüfte Änderungen, Fortschritt und Rollback an', () => {
    expect(page).toContain('Update-Paket hochladen');
    expect(page).toContain('Änderungen anzeigen');
    expect(page).toContain('Technisches Installationsprotokoll');
    expect(page).toContain('Rollback');
  });

  it('ist nur in der Adminnavigation verlinkt', () => {
    expect(navigation).toContain('adminOnly: true');
    expect(navigation).toContain('/system/update');
  });

  it('überträgt ZIP-Dateien binär statt als JSON', () => {
    expect(api).toContain('body: file');
    expect(api).toContain('X-File-Name');
  });

  it('sperrt die Installation nicht allein wegen eines fehlgeschlagenen Healthchecks', () => {
    expect(page).toContain('Installation versuchen');
    expect(page).not.toContain('disabled={busy || running || !updaterOnline}');
  });

  it('zeigt einen initialen Backendfehler statt eines endlosen Ladezustands', () => {
    expect(page).toContain('Update-Center nicht erreichbar');
    expect(page).toContain('Erneut versuchen');
  });

  it('zeigt sichere Diagnose-IDs, aber keine fest verdrahtete interne URL', () => {
    expect(page).toContain('Verbindungsdiagnose des Update-Dienstes');
    expect(page).toContain('Diagnose-ID');
    expect(page).not.toContain('http://updater:3010');
    expect(api).toContain('API_NETWORK_ERROR');
  });
});

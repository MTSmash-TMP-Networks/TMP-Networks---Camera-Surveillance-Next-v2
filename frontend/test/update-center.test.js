import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '../src/i18n/messages.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(resolve(here, '../src/pages/UpdatePage.jsx'), 'utf8');
const navigation = readFileSync(resolve(here, '../src/config/navigation.js'), 'utf8');
const api = readFileSync(resolve(here, '../src/services/api.js'), 'utf8');

describe('Localized update center', () => {
  it('shows checked changes, progress, rollback and binary uploads', () => {
    for (const marker of ["t('update.upload.title')", "t('update.package.showChanges')", "t('update.log.technical')", "t('update.backups.title')"]) {
      // The package action key is referenced in the conditional label helper.
      expect(page).toContain(marker);
    }
    expect(translate('de', 'update.log.technical')).toBe('Technisches Installationsprotokoll');
  });
  it('is restricted to admin navigation', () => {
    expect(navigation).toContain('adminOnly: true');
    expect(navigation).toContain('/system/update');
  });
  it('uploads a ZIP as raw bytes instead of JSON', () => {
    expect(api).toContain('body: file');
    expect(api).toContain('X-File-Name');
  });
  it('allows an installation attempt even when the updater health state is degraded', () => {
    expect(page).toContain('updaterActionLabel');
    expect(page).toContain("t('update.action.installTry')");
    expect(page).toContain('disabled={busy || running || updaterRestarting}');
    expect(page).not.toContain('disabled={busy || running || !updaterOnline}');
  });
  it('shows a recoverable backend error instead of spinning forever', () => {
    expect(page).toContain("t('update.load.unreachable')");
    expect(page).toContain("t('update.load.retry')");
    expect(translate('de', 'update.load.unreachable')).toBe('Update-Center nicht erreichbar');
  });
  it('shows diagnostic IDs without exposing internal service addresses', () => {
    expect(page).toContain("t('update.diagnostics.title')");
    expect(page).toContain("t('update.diagnostics.id')");
    expect(page).not.toContain('http://updater:3010');
    expect(api).toContain('API_NETWORK_ERROR');
  });
});

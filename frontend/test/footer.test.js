import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translate } from '../src/i18n/messages.js';

const here = dirname(fileURLToPath(import.meta.url));
const footer = readFileSync(resolve(here, '../src/components/AppFooter.jsx'), 'utf8');
const app = readFileSync(resolve(here, '../src/App.jsx'), 'utf8');

describe('Globaler Footer', () => {
  it('uses runtime year, localized version and correct company branding', () => {
    expect(footer).toContain('new Date().getFullYear()');
    expect(footer).toContain('TMP-SYSTEM-SERVICE GmbH');
    expect(footer).toContain("t('common.version')");
    expect(translate('de', 'common.version')).toBe('Version');
    expect(footer).toContain('__APP_VERSION__');
  });
  it('renders the desktop footer after routes but leaves room for mobile bottom navigation', () => {
    expect(app).toContain('<RouteAwareFooter />');
    expect(app.indexOf('<RouteAwareFooter />')).toBeGreaterThan(app.indexOf('</Routes>'));
    expect(app).toContain("pathname.startsWith('/mobile') ? null : <AppFooter />");
  });
});

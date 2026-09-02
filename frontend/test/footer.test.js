import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const footer = readFileSync(resolve(here, '../src/components/AppFooter.jsx'), 'utf8');
const app = readFileSync(resolve(here, '../src/App.jsx'), 'utf8');

describe('Globaler Footer', () => {
  it('verwendet das Laufzeitjahr und den korrekten Firmenvermerk', () => {
    expect(footer).toContain('new Date().getFullYear()');
    expect(footer).toContain('TMP-SYSTEM-SERVICE GmbH');
    expect(footer).toContain('Version');
    expect(footer).toContain('__APP_VERSION__');
  });

  it('wird außerhalb der Routen auf allen Seiten gerendert', () => {
    expect(app).toContain('<AppFooter />');
    expect(app.indexOf('<AppFooter />')).toBeGreaterThan(app.indexOf('</Routes>'));
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const component = readFileSync(resolve(root, 'src/components/BrandIcon.jsx'), 'utf8');
const shell = readFileSync(resolve(root, 'src/components/AppShell.jsx'), 'utf8');
const login = readFileSync(resolve(root, 'src/pages/LoginPage.jsx'), 'utf8');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/site.webmanifest'), 'utf8'));

describe('TMP-Networks-App-Icon', () => {
  it('stellt optimierte Browser- und App-Icons bereit', () => {
    for (const size of [32, 180, 192, 512, 1024]) {
      expect(existsSync(resolve(root, `public/icons/tmp-camera-icon-${size}.png`))).toBe(true);
    }
    expect(existsSync(resolve(root, 'public/favicon.ico'))).toBe(true);
  });

  it('verwendet dieselbe Markenkomponente in Navigation, Login und Ladezustand', () => {
    expect(component).toContain('TMP Networks Camera Surveillance');
    expect(component).toContain("../assets/tmp-camera-icon-192.png");
    expect(component).toContain("../assets/tmp-camera-icon-512.png");
    expect(component).toContain("../assets/tmp-camera-icon-1024.png");
    expect(component).not.toContain("const ICON_BASE = '/icons/");
    expect(shell).toContain('<BrandIcon size="sidebar" />');
    expect(login).toContain('<BrandIcon size="hero" decorative={false}/>');
    expect(login).toContain('<BrandIcon size="login"/>');
    expect(shell).not.toContain('brand-mark">TMP');
  });

  it('bindet Favicon, Apple-Touch-Icon und Webmanifest ein', () => {
    expect(index).toContain('/favicon.ico');
    expect(index).toContain('/icons/tmp-camera-icon-180.png');
    expect(index).toContain('/site.webmanifest');
    expect(manifest.name).toBe('TMP Networks Camera Surveillance');
    expect(manifest.icons).toHaveLength(2);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Updater-Containerstart', () => {
  it('umgeht den docker-CLI-Entrypoint und startet die Node-Anwendung explizit', () => {
    const dockerfile = fs.readFileSync(path.resolve('../updater/Dockerfile'), 'utf8');
    expect(dockerfile).toContain('ENTRYPOINT []');
    expect(dockerfile).toContain('CMD ["/usr/bin/node", "src/server.js"]');
    expect(dockerfile).not.toMatch(/^CMD \["node"/m);
  });
});

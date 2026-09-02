import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/services/credentialVault.js';
describe('CredentialVault', () => {
  it('verschluesselt und entschluesselt Zugangsdaten', () => {
    const encrypted = encryptSecret('Kamera!Kennwort');
    expect(encrypted).not.toContain('Kamera!Kennwort');
    expect(decryptSecret(encrypted)).toBe('Kamera!Kennwort');
  });
  it('verwendet bei gleicher Eingabe unterschiedliche Nonces', () => {
    expect(encryptSecret('gleich')).not.toBe(encryptSecret('gleich'));
  });
});

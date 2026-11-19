import { describe, expect, it } from 'vitest';
import { isMobileDevice, chooseMobileInterface } from '../src/services/mobileRouting.js';

describe('Mobile portal selection', () => {
  it('identifies phones even when a desktop-sized viewport is reported', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Mobile Safari', viewportWidth: 1280 })).toBe(true);
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', viewportWidth: 1280 })).toBe(true);
  });
  it('recognizes touch tablets without redirecting resized desktop browsers', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5, coarsePointer: true, viewportWidth: 900 })).toBe(true);
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0, coarsePointer: false, viewportWidth: 390 })).toBe(false);
  });
  it('never hijacks the Linux kiosk, and honors explicit desktop/mobile choices', () => {
    const mobile = { userAgent: 'Android 14', viewportWidth: 390 };
    expect(chooseMobileInterface({ desktopKiosk: true, ...mobile })).toBe(false);
    expect(chooseMobileInterface({ preference: 'desktop', ...mobile })).toBe(false);
    expect(chooseMobileInterface({ preference: 'mobile', userAgent: 'Linux x86_64' })).toBe(true);
    expect(chooseMobileInterface({ ...mobile })).toBe(true);
  });
});

import { isDesktopKiosk } from './api.js';

// Interface choice is per browser tab, not an account setting. This cannot
// change authentication, roles, the kiosk layout or the server stream.
const PREFERENCE_KEY = 'tmp_camera_interface_v1';

export function isMobileDevice({ userAgent = '', maxTouchPoints = 0, coarsePointer = false, viewportWidth = 1200 } = {}) {
  if (/iPhone|iPod|iPad|Android|Windows Phone|Mobile/i.test(String(userAgent))) return true;
  // iPadOS may identify as desktop Safari. A desktop browser narrowed to 400px
  // is not enough by itself to trigger a mobile UI.
  return Number(maxTouchPoints) > 1 && Boolean(coarsePointer) && Number(viewportWidth) <= 1100;
}

export function chooseMobileInterface({ desktopKiosk = false, preference = null, ...device } = {}) {
  if (desktopKiosk) return false;
  if (preference === 'desktop') return false;
  if (preference === 'mobile') return true;
  return isMobileDevice(device);
}

export function readInterfacePreference() {
  try { return globalThis.sessionStorage?.getItem(PREFERENCE_KEY) || null; }
  catch { return null; }
}

export function setInterfacePreference(preference) {
  try {
    if (preference === 'desktop' || preference === 'mobile') {
      globalThis.sessionStorage?.setItem(PREFERENCE_KEY, preference);
    } else {
      globalThis.sessionStorage?.removeItem(PREFERENCE_KEY);
    }
  } catch { /* Browser may block web storage. Manual navigation still works. */ }
}

export function shouldOpenMobileInterface() {
  const win = typeof window === 'undefined' ? null : window;
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return chooseMobileInterface({
    desktopKiosk: isDesktopKiosk(),
    preference: readInterfacePreference(),
    userAgent: nav?.userAgent || '',
    maxTouchPoints: nav?.maxTouchPoints || 0,
    coarsePointer: Boolean(win?.matchMedia?.('(pointer: coarse)').matches),
    viewportWidth: win?.innerWidth || 1200,
  });
}

export function authenticatedLandingPath() {
  return isDesktopKiosk() ? '/kiosk' : shouldOpenMobileInterface() ? '/mobile' : '/';
}

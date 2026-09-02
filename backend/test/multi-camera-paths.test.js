import { describe, expect, it } from 'vitest';
import { findCoalescableSession, streamPathBase } from '../src/services/media/StreamOrchestrator.js';

describe('Mehrkamera-Stream-Isolation', () => {
  it('erzeugt fuer jede Kamera und Profilwahl einen eigenen go2rtc-Pfad', () => {
    const first = streamPathBase('camera-a', 'balanced', null);
    const second = streamPathBase('camera-b', 'balanced', null);
    const firstProfile = streamPathBase('camera-a', 'balanced', 'main-profile');
    expect(first).not.toBe(second);
    expect(first).not.toBe(firstProfile);
    expect(streamPathBase('camera-a', 'balanced', null, 'recording')).not.toBe(first);
    expect(streamPathBase('camera-a', 'balanced', null)).toBe(first);
    expect(streamPathBase('camera-a', 'low', null, 'ingest')).toBe('cam_camera-a_preview');
    expect(streamPathBase('camera-a', 'high', null, 'browser-fallback-live')).not.toBe(streamPathBase('camera-a', 'high', null, 'browser-fallback-kiosk'));
  });

  it('gibt lange oder problematische Profil-Tokens nicht im Pfad preis', () => {
    const path = streamPathBase('camera-a', 'high', 'Profile Token mit Leerzeichen / geheim');
    expect(path).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(path).not.toContain('geheim');
  });

  it('fuehrt nur gleichzeitig startende Sitzungen derselben Kamera und Profilwahl zusammen', () => {
    const sessions = [
      { cameraId: 'camera-a', requestedProfileToken: null, state: 'ready', quality: 'balanced' },
      { cameraId: 'camera-a', requestedProfileToken: null, state: 'starting', quality: 'low' },
      { cameraId: 'camera-b', requestedProfileToken: null, state: 'starting', quality: 'balanced' },
    ];
    expect(findCoalescableSession(sessions, 'camera-a', null)?.quality).toBe('low');
    expect(findCoalescableSession(sessions, 'camera-b', null)?.quality).toBe('balanced');
    expect(findCoalescableSession(sessions, 'camera-a', 'main-profile')).toBeNull();
    expect(findCoalescableSession(sessions, 'camera-a', null, 'recording')).toBeNull();
  });


  it('teilt gleichzeitig startende Mainstream-Sitzungen zwischen Live und Aufnahme', () => {
    const sessions = [
      { cameraId: 'camera-a', requestedProfileToken: null, state: 'starting', quality: 'high', purpose: 'mainstream', consumerPurpose: 'live' },
      { cameraId: 'camera-a', requestedProfileToken: null, state: 'starting', quality: 'high', purpose: 'browser-fallback', consumerPurpose: 'live' },
    ];
    expect(findCoalescableSession(sessions, 'camera-a', null, 'mainstream', 'recording')?.purpose).toBe('mainstream');
    expect(findCoalescableSession(sessions, 'camera-a', null, 'browser-fallback', 'kiosk')).toBeNull();
  });

});

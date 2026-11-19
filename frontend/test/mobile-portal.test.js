import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const load = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = load('../src/App.jsx');
const login = load('../src/pages/LoginPage.jsx');
const shell = load('../src/components/MobileShell.jsx');
const pages = load('../src/pages/MobilePages.jsx');
const player = load('../src/components/SeamlessLivePlayer.jsx');
const api = load('../src/services/api.js');
const css = load('../src/styles/app.css');

describe('dedicated authenticated mobile frontend', () => {
  it('registers protected routes with an isolated shell and redirects a mobile login', () => {
    expect(app).toContain('<Route element={<Protected mobile />}>');
    expect(app).toContain('path="/mobile" element={<MobileOverviewPage/>}');
    expect(app).toContain('path="/mobile/cameras/:id" element={<MobileCameraPage/>}');
    expect(app).toContain('path="/mobile/recordings" element={<MobileRecordingsPage/>}');
    expect(app).toContain('path="/mobile/more" element={<MobileMorePage/>}');
    expect(login).toContain('authenticatedLandingPath()');
    expect(app).toContain('shouldOpenMobileInterface()');
    expect(app).toContain('return mobile ? <MobileShell /> : <AppShell />;');
  });
  it('preserves desktop and kiosk, supports mobile navigation, and does not persist device layout', () => {
    expect(shell).toContain('mobile-bottom-nav');
    expect(shell).toContain("navigate('/', { replace: true })");
    expect(shell).not.toContain('saveKioskLayouts');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toContain('.login-page-mobile');
  });
  it('renders cached camera thumbnails until one camera is deliberately opened', () => {
    expect(pages).toContain('<SnapshotBackdrop cameraId={camera.id} refreshMs={60000}/>');
    expect(pages).toContain('/mobile/cameras/');
    expect(pages).toContain('transportMode="local-hls" compact isolateFailure');
    expect(pages).toContain('quality="low"');
    expect((pages.match(/<SeamlessLivePlayer/g) || [])).toHaveLength(1);
    expect(player).toContain("const requestedQuality = compact ? 'low'");
    expect(api).toContain("thumbnail: (id, options = {}) => requestBlob(");
  });
  it('reuses authenticated recording playback without adding video ingest or admin APIs', () => {
    expect(pages).toContain('api.recordings(selectedCamera)');
    expect(pages).toContain('api.recordingToken(recording.id)');
    expect(pages).toContain('<RecordingArchivePlayer source={playing}/>');
    expect(pages).not.toContain('api.streamSession(');
    expect(pages).not.toContain('api.saveRecordingPlanning(');
    expect(pages).not.toContain('api.deleteRecording(');
  });
});

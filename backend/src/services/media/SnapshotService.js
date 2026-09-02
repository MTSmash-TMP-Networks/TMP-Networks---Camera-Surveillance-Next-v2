import { spawn } from 'node:child_process';
import DigestClient from 'digest-fetch';
import { cameraRepository } from '../cameraRepository.js';
import { OnvifClient } from '../onvif/OnvifClient.js';
import { injectCredentials } from '../../utils/url.js';
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import { buildMediaInputArgs } from './FfmpegInputOptions.js';
import { mediaSourceService } from './MediaSourceService.js';

async function fetchSnapshot(uri, username, password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const client = new DigestClient(username || '', password || '', { basic: true });
    const response = await client.fetch(uri, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return { contentType, buffer: Buffer.from(await response.arrayBuffer()) };
  } finally { clearTimeout(timer); }
}

function ffmpegFrame(uri, transport) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      ...buildMediaInputArgs(uri, transport),
      '-i', uri, '-frames:v', '1', '-vf', 'scale=min(1280\\,iw):-2',
      '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    ];
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error('Snapshot-Zeitlimit ueberschritten'));
    }, 12000);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1000); });
    child.once('exit', (code) => {
      if (code === 0 && chunks.length) finish(resolve, { contentType: 'image/jpeg', buffer: Buffer.concat(chunks) });
      else finish(reject, new Error(stderr || `FFmpeg ${code}`));
    });
    child.once('error', (error) => finish(reject, error));
  });
}

export const snapshotService = {
  async capture(cameraId, profileToken = null) {
    const camera = cameraRepository.getWithCredentials(cameraId);
    if (!camera) throw new AppError(404, 'CAMERA_NOT_FOUND', 'Kamera nicht gefunden');
    const profiles = cameraRepository.profiles(cameraId);
    if (profileToken && !profiles.some((profile) => profile.token === profileToken)) {
      throw new AppError(400, 'INVALID_PROFILE', 'Das angeforderte ONVIF-Profil gehoert nicht zu dieser Kamera');
    }
    const storedPreferredToken = camera.preferredProfile?.startsWith('source:') ? null : camera.preferredProfile;
    const selectedProfile = profiles.find((profile) => profile.token === (profileToken || storedPreferredToken)) || profiles[0] || null;
    const token = selectedProfile?.token || null;
    const mediaService = selectedProfile?.mediaService || null;
    const directStream = camera.connectionType === 'stream';
    const onvif = directStream ? null : new OnvifClient(camera);
    let lastError;
    for (const source of mediaSourceService.snapshotSources(cameraId)) {
      try {
        return await mediaSourceService.fetchSnapshot(source.url, camera.username, camera.password);
      } catch (error) { lastError = error; }
    }
    if (onvif) {
      try {
        const uri = await onvif.snapshotUri(token, mediaService);
        if (uri) return await fetchSnapshot(uri, camera.username, camera.password);
      } catch (error) { lastError = error; }
    }
    const manualStreams = cameraRepository.mediaSources(cameraId).filter((source) => source.enabled && source.kind !== 'snapshot');
    for (const source of manualStreams) {
      try {
        return await ffmpegFrame(injectCredentials(source.url, camera.username, camera.password), source.kind === 'rtsp' ? 'tcp' : source.kind);
      } catch (error) { lastError = error; }
    }
    if (onvif) {
      try {
        const candidates = await onvif.streamCandidates(token, undefined, mediaService);
        for (const candidate of candidates) {
          try {
            return await ffmpegFrame(injectCredentials(candidate.uri, camera.username, camera.password), candidate.transport);
          } catch (error) { lastError = error; }
        }
      } catch (error) { lastError = error; }
    }
    throw new AppError(502, 'SNAPSHOT_FAILED', 'Snapshot konnte nicht erzeugt werden', String(lastError?.message || lastError || 'Unbekannter Fehler'));
  },
};

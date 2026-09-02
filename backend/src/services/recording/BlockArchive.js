import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PLAYABLE_STATUSES = new Set(['ready', 'recovered']);

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function blockName(index) {
  return `block-${String(Number(index)).padStart(6, '0')}.ts`;
}

export function blockPaths(sessionDir, index) {
  const filename = blockName(index);
  return {
    filename,
    finalPath: path.join(sessionDir, filename),
    tempPath: path.join(sessionDir, `${filename}.partial`),
    damagedPath: path.join(sessionDir, `${filename}.damaged`),
  };
}

export function blockIndexFromName(filename) {
  const match = String(filename).match(/^block-(\d{6})\.ts(?:\.partial|\.damaged)?$/);
  return match ? Number(match[1]) : null;
}

export function isPlayableBlock(segment) {
  return PLAYABLE_STATUSES.has(String(segment?.status || '').toLowerCase()) && safeNumber(segment?.size_bytes ?? segment?.sizeBytes) > 0;
}

export function summarizeBlocks(segments = []) {
  const playable = segments.filter(isPlayableBlock);
  const damaged = segments.filter((segment) => ['damaged', 'corrupt', 'empty', 'failed'].includes(String(segment?.status || '').toLowerCase()));
  return {
    blockCount: segments.length,
    playableBlockCount: playable.length,
    damagedBlockCount: damaged.length,
    fileSizeBytes: playable.reduce((sum, segment) => sum + safeNumber(segment.size_bytes ?? segment.sizeBytes), 0),
    mediaDurationSeconds: playable.reduce((sum, segment) => sum + safeNumber(segment.duration_seconds ?? segment.durationSeconds), 0),
  };
}

export function assessProbe(probe, sizeBytes, { minimumBytes = 1880, minimumDurationSeconds = 0.15, fallbackDurationSeconds = 0 } = {}) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const hasVideo = streams.some((stream) => stream.codec_type === 'video');
  const probedDurations = [
    safeNumber(probe?.format?.duration),
    ...streams.map((stream) => safeNumber(stream?.duration)),
  ].filter((value) => value > 0);
  const probedDurationSeconds = probedDurations.length ? Math.max(...probedDurations) : 0;
  const durationSeconds = Math.max(0, probedDurationSeconds || safeNumber(fallbackDurationSeconds));
  const formatName = String(probe?.format?.format_name || 'mpegts').split(',')[0] || 'mpegts';
  const largeEnough = safeNumber(sizeBytes) >= minimumBytes;
  const durationKnown = durationSeconds > 0;
  const durationOkay = !durationKnown || durationSeconds >= minimumDurationSeconds;
  return {
    playable: Boolean(hasVideo && largeEnough && durationOkay),
    hasVideo,
    durationSeconds,
    durationEstimated: probedDurationSeconds <= 0 && durationSeconds > 0,
    formatName,
    sizeBytes: safeNumber(sizeBytes),
    reason: !largeEnough ? 'block_too_small' : !hasVideo ? 'video_stream_missing' : !durationOkay ? 'duration_too_short' : null,
  };
}

export function probeMedia(filePath, { ffprobePath = 'ffprobe', timeoutMs = 12_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, [
      '-v', 'error',
      '-analyzeduration', '20000000', '-probesize', '20000000',
      '-show_entries', 'format=duration,size,format_name:stream=index,codec_type,codec_name,duration',
      '-of', 'json',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      finish(new Error('Zeitlimit bei der Blockprüfung überschritten'));
    }, timeoutMs);
    timer.unref?.();

    function finish(error = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        try { resolve(JSON.parse(stdout || '{}')); }
        catch { reject(new Error('FFprobe lieferte ungültige Prüfdaten')); }
      }
    }

    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-1_000_000); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
    child.once('error', finish);
    child.once('exit', (code) => {
      if (code === 0) finish();
      else finish(new Error((stderr || `FFprobe beendet (${code})`).trim().slice(-2000)));
    });
  });
}

function syncFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch {
    // Some network filesystems do not support fsync. Atomic rename is still used.
  }
}

function syncDirectory(directory) {
  try {
    const fd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch {
    // Directory fsync is unavailable on some filesystems/platforms.
  }
}

export async function finalizeBlock({ tempPath, finalPath, damagedPath, ffprobePath, probeTimeoutMs, minimumBytes, fallbackDurationSeconds = 0 }) {
  const sizeBytes = (() => { try { return fs.statSync(tempPath).size; } catch { return 0; } })();
  if (!sizeBytes) {
    fs.rmSync(tempPath, { force: true });
    return { playable: false, status: 'empty', sizeBytes: 0, durationSeconds: 0, mediaFormat: 'mpegts', error: 'Der Block enthält keine Mediendaten.' };
  }

  let assessment;
  let lastProbeError = null;
  for (const delayMs of [0, 250, 750]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const probe = await probeMedia(tempPath, { ffprobePath, timeoutMs: probeTimeoutMs });
      assessment = assessProbe(probe, sizeBytes, { minimumBytes, fallbackDurationSeconds });
      if (assessment.playable) break;
    } catch (error) {
      lastProbeError = error;
    }
  }
  if (!assessment) {
    assessment = {
      playable: false,
      status: 'damaged',
      sizeBytes,
      durationSeconds: Math.max(0, safeNumber(fallbackDurationSeconds)),
      mediaFormat: 'mpegts',
      reason: 'probe_failed',
      error: lastProbeError?.message || 'FFprobe konnte den Aufnahmeblock nicht lesen.',
    };
  }

  if (assessment.playable) {
    fs.rmSync(finalPath, { force: true });
    syncFile(tempPath);
    fs.renameSync(tempPath, finalPath);
    syncDirectory(path.dirname(finalPath));
    return {
      playable: true,
      status: 'ready',
      filePath: finalPath,
      sizeBytes,
      durationSeconds: assessment.durationSeconds,
      mediaFormat: assessment.formatName || 'mpegts',
      error: null,
    };
  }

  fs.rmSync(damagedPath, { force: true });
  try { fs.renameSync(tempPath, damagedPath); } catch { fs.rmSync(tempPath, { force: true }); }
  syncDirectory(path.dirname(damagedPath));
  return {
    playable: false,
    status: 'damaged',
    filePath: fs.existsSync(damagedPath) ? damagedPath : tempPath,
    sizeBytes,
    durationSeconds: assessment.durationSeconds || 0,
    mediaFormat: assessment.formatName || 'mpegts',
    error: assessment.error || assessment.reason || 'Der Block ist nicht abspielbar.',
  };
}

export function scanSessionBlocks(sessionDir) {
  if (!fs.existsSync(sessionDir)) return [];
  return fs.readdirSync(sessionDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const index = blockIndexFromName(entry.name);
      if (!index) return null;
      const filePath = path.join(sessionDir, entry.name);
      const stat = fs.statSync(filePath);
      const kind = entry.name.endsWith('.partial') ? 'partial' : entry.name.endsWith('.damaged') ? 'damaged' : 'final';
      return { index, filePath, filename: entry.name, kind, sizeBytes: stat.size, mtime: stat.mtime };
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index || left.filename.localeCompare(right.filename));
}

export function writeJournal(sessionDir, payload) {
  fs.mkdirSync(sessionDir, { recursive: true });
  const target = path.join(sessionDir, 'session.json');
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  syncFile(temporary);
  fs.renameSync(temporary, target);
  syncDirectory(sessionDir);
}

export function buildVodPlaylist(segments, uriForSegment) {
  const playable = segments.filter(isPlayableBlock);
  if (!playable.length) return null;
  const targetDuration = Math.max(1, Math.ceil(Math.max(...playable.map((segment) => safeNumber(segment.duration_seconds ?? segment.durationSeconds, 1)))));
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  playable.forEach((segment, position) => {
    const gapSeconds = safeNumber(segment.gap_seconds ?? segment.gapSeconds);
    if (position > 0 && (gapSeconds > 0 || segment.status === 'recovered' || segment.is_discontinuity)) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${Math.max(0.001, safeNumber(segment.duration_seconds ?? segment.durationSeconds, 1)).toFixed(3)},`);
    lines.push(uriForSegment(segment));
  });
  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

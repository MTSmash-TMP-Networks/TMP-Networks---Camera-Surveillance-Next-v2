import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const RESERVE = 512 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code, status: 422 });

async function checkSpace(dir, required) {
  const stat = await fs.promises.statfs(dir);
  if (stat.bavail * stat.bsize < required + RESERVE) {
    throw fail('EXPORT_DISK_SPACE', 'Nicht genug freier Speicher fuer die MP4-Erstellung.');
  }
}

function run(binary, args, { signal, timeoutMs, workDir } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal, cwd: workDir });
    let stdout = '', stderr = '', failure;
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-1_000_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', (error) => { failure = error; });
    const timer = setTimeout(() => { failure = new Error('Zeitlimit bei MP4-Erstellung erreicht'); child.kill('SIGKILL'); }, timeoutMs);
    timer.unref?.();
    let checking = false;
    const guard = workDir && setInterval(async () => {
      if (checking) return;
      checking = true;
      try { await checkSpace(workDir, 0); }
      catch (error) { failure = error; child.kill('SIGKILL'); }
      finally { checking = false; }
    }, 3000);
    guard?.unref?.();
    child.once('close', (code) => {
      clearTimeout(timer); clearInterval(guard);
      if (failure) reject(failure);
      else if (code !== 0) reject(fail('EXPORT_MP4_FAILED', 'MP4-Erstellung fehlgeschlagen.'));
      else resolve(stdout);
    });
  });
}

async function probe(file, ffprobePath, signal) {
  return JSON.parse(await run(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,time_base,sample_rate,channels,channel_layout',
    '-of', 'json', file,
  ], { signal, timeoutMs: 30000 }));
}

function streamSignature(streams) {
  return JSON.stringify(streams.map(({ codec_type, codec_name, width, height, pix_fmt, time_base, sample_rate, channels, channel_layout }) =>
    [codec_type, codec_name, width, height, pix_fmt, time_base, sample_rate, channels, channel_layout]));
}

/** Build a complete ordinary MP4, with a seekable sample table, before download.
 * Input blocks remain untouched. Hardlinks pin cached/retention-managed blocks;
 * copy only when a different filesystem does not permit hardlinks.
 */
export async function prepareEvidenceMp4({ blocks, workDir, resolveBlock, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal }) {
  if (!blocks.length) throw fail('EXPORT_NO_RECORDINGS', 'Keine Aufnahmebloecke vorhanden.');
  const required = Math.ceil(blocks.reduce((sum, b) => sum + Number(b.sizeBytes || 0), 0) * 1.1);
  await checkSpace(workDir, required);
  const pins = path.join(workDir, 'inputs');
  await fs.promises.mkdir(pins, { mode: 0o700 });
  const list = ['ffconcat version 1.0'];
  const sources = [];
  let signature, audioCodec, videoCodec, expected = 0;
  try {
    for (const [index, block] of blocks.entries()) {
      signal?.throwIfAborted();
      await checkSpace(workDir, required);
      const source = await resolveBlock(block);
      signal?.throwIfAborted();
      const name = 'inputs/block-' + index + '.ts';
      const pin = path.join(workDir, name);
      try { await fs.promises.link(source, pin); }
      catch (error) {
        if (!['EXDEV', 'EPERM', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw error;
        await checkSpace(workDir, required + (await fs.promises.stat(source)).size);
        await fs.promises.copyFile(source, pin, fs.constants.COPYFILE_EXCL);
      }
      const stat = await fs.promises.stat(pin);
      if (!stat.isFile() || stat.size <= 0 || (block.sizeBytes > 0 && stat.size !== block.sizeBytes)) {
        throw fail('EXPORT_MP4_FAILED', 'Aufnahmeblock fehlt oder hat sich geaendert.');
      }
      const metadata = await probe(pin, ffprobePath, signal);
      const streams = metadata.streams || [];
      const video = streams.find((s) => s.codec_type === 'video');
      const audio = streams.find((s) => s.codec_type === 'audio');
      const duration = Number(metadata.format?.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0) throw fail('EXPORT_MP4_FAILED', 'Aufnahmeblock ist nicht lesbar.');
      const current = streamSignature(streams);
      if (signature !== undefined && current !== signature) throw fail('EXPORT_MP4_FORMAT_CHANGED', 'Streamformat hat sich im Exportzeitraum geaendert. Bitte einen kleineren Zeitraum waehlen.');
      signature = current; videoCodec = video.codec_name; audioCodec = audio?.codec_name;
      list.push('file ' + name, 'duration ' + duration.toFixed(6));
      sources.push({ ...block, sourcePath: undefined, playbackStartSeconds: expected, playbackDurationSeconds: duration });
      expected += duration;
    }
    await checkSpace(workDir, required);
    const listPath = path.join(workDir, 'inputs.ffconcat');
    await fs.promises.writeFile(listPath, list.join('\n') + '\n', { mode: 0o600 });
    const filePath = path.join(workDir, 'export.mp4');
    await run(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-xerror', '-n',
      '-f', 'concat', '-safe', '1', '-i', listPath, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy', '-c:a', audioCodec && audioCodec !== 'aac' ? 'aac' : 'copy',
      ...(videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
      '-avoid_negative_ts', 'make_zero', '-f', 'mp4', filePath,
    ], { signal, timeoutMs: 2 * 3600_000, workDir });
    const result = await probe(filePath, ffprobePath, signal);
    const durationSeconds = Number(result.format?.duration);
    if (!result.streams?.some((s) => s.codec_type === 'video') || !Number.isFinite(durationSeconds) ||
        Math.abs(durationSeconds - expected) > Math.max(2, blocks.length * 0.1) ||
        (audioCodec && !result.streams.some((s) => s.codec_type === 'audio'))) {
      throw fail('EXPORT_MP4_INCOMPLETE', 'MP4 hat nicht die erwartete Laufzeit oder Tonspur.');
    }
    return { filePath, durationSeconds, videoCodec, audioCodec: audioCodec ? 'aac' : null, sources };
  } finally {
    await fs.promises.rm(pins, { recursive: true, force: true });
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildArchivePlayback, ArchivePlaybackSessions } from '../src/services/recording/ArchivePlayback.js';
import { normalizeArchiveTimeline, seekArchiveWallTime, archiveWallTimeAtMedia, timelinePercent } from '../../frontend/src/services/archivePlaybackTimeline.js';
import { demoModePolicyAllowsRequest } from '../src/services/DemoModePolicy.js';

const base = Date.parse('2026-11-24T00:00:00Z');
const iso = (seconds) => new Date(base + seconds * 1000).toISOString();
const block = (recordingId, segmentIndex, start, end, duration = end - start, status = 'ready') => ({
  recordingId, segmentIndex, startedAt: iso(start), endedAt: iso(end), durationSeconds: duration,
  sizeBytes: 1880, status,
});
const url = (b) => 'recording-' + b.recordingId + '-block-' + b.segmentIndex + '.ts';
const make = (blocks, options = {}) => buildArchivePlayback(blocks, { uriForBlock: url, ...options });

test('a fixed day timeline includes earlier and later sessions; jumps map within blocks to exact seconds', () => {
  const { playlist, timeline } = make([block(2,1,7200,7500), block(1,1,3600,3900),
    block(1,2,3900,4200), block(3,1,9000,9300,300,'recording')], {
    scope: 'day', timezone: 'UTC', startIso: iso(0), endIso: iso(86400),
  });
  assert.deepEqual(playlist.split('\n').filter(s => s.endsWith('.ts')), ['recording-1-block-1.ts','recording-1-block-2.ts','recording-2-block-1.ts']);
  assert.equal((playlist.match(/#EXT-X-DISCONTINUITY/g) || []).length, 2);
  const model = normalizeArchiveTimeline(timeline);
  assert.equal(model.duration, 86400);
  assert.equal(model.coverage.length, 2);
  const later = seekArchiveWallTime(model, base + 7273_000);
  assert.equal(later.mediaSeconds, 673);
  assert.equal(later.gap, false);
  const earlier = seekArchiveWallTime(model, base + 3673_000);
  assert.equal(earlier.mediaSeconds, 73);
  assert.equal(archiveWallTimeAtMedia(model, 373).wallMs, base + 3973_000);
  assert.equal(archiveWallTimeAtMedia(model, 673).wallMs, base + 7273_000);
  assert.equal(timelinePercent(model, base + 43200_000), 50);
  assert.equal(seekArchiveWallTime(model, base + 5000_000).mediaSeconds, 600);
  assert.equal(seekArchiveWallTime(model, base + 5000_000).gap, true);
  assert.ok(seekArchiveWallTime(model, base + 86400_000).mediaSeconds < 900);
});

test('civil day clipping preserves real media offsets including overlapping blocks and 25h DST windows', () => {
  const { timeline } = make([block(1,1,-30,30), block(1,2,20,80), block(1,3,35,45),
    block(2,1,89990,90010)], { scope:'day', startIso:iso(0), endIso:iso(90000) });
  const model = normalizeArchiveTimeline(timeline);
  assert.equal(model.duration, 90000);
  assert.equal(model.spans.length, 3);
  assert.equal(seekArchiveWallTime(model, base + 5000).mediaSeconds, 35);
  assert.equal(seekArchiveWallTime(model, base + 40000).mediaSeconds, 80);
  assert.equal(archiveWallTimeAtMedia(model, 65).skipTo, 70);
  assert.equal(archiveWallTimeAtMedia(model, 129).wallMs, base + 89999_000);
  assert.equal(archiveWallTimeAtMedia(model, 130).ended, true);
});

test('one recording uses its complete finalized block time range and not the full calendar day', () => {
  const { timeline } = make([block(8,1,100,400,300), block(8,2,400,700,300)]);
  const model = normalizeArchiveTimeline(timeline);
  assert.equal(model.duration, 600);
  assert.equal(seekArchiveWallTime(model, base + 555_000).mediaSeconds, 455);
  assert.equal(seekArchiveWallTime(model, base + 150_000).mediaSeconds, 50);
});

test('playlist snapshots are scoped to their owner, expiring and releasable', () => {
  let now = 0;
  const store = new ArchivePlaybackSessions({ now: () => now });
  const id = store.create({ playlist:'#EXTM3U\n', user:{sub:1,ver:3},scope:'day',expiresIn:60 });
  assert.equal(store.get(id, 1).version,3);
  assert.throws(() => store.get(id,2), /abgelaufen/);
  store.release(id,2);
  assert.equal(store.get(id,1).scope,'day');
  now=60000;
  assert.throws(() => store.get(id,1), /abgelaufen/);
  const next = store.create({ playlist:'#EXTM3U\n', user:{sub:1,ver:3},scope:'recording',expiresIn:60 });
  store.release(next,1);
  assert.throws(() => store.get(next,1), /abgelaufen/);
  assert.equal(demoModePolicyAllowsRequest('POST','/api/recordings/archive/playback',{demoMode:true}),true);
  assert.equal(demoModePolicyAllowsRequest('DELETE','/api/recordings/archive/playback/'+next,{demoMode:true}),true);
  assert.equal(demoModePolicyAllowsRequest('DELETE','/api/recordings/1',{demoMode:true}),false);
});

test('actual multi-session HLS decodes independent reset-timestamp color blocks in the right order', (t) => {
  if (spawnSync('ffmpeg',['-version']).status !== 0) {
    if (process.env.REQUIRE_FFMPEG === '1') assert.fail('FFmpeg required');
    t.skip('FFmpeg unavailable'); return;
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tmp-archive-global-timeline-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const blocks=[block(1,1,100,102),block(1,2,102,104),block(2,1,600,602)];
  for (const [i,color] of ['red','green','blue'].entries()) {
    const generated=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color='+color+':size=160x90:rate=15',
      '-t','2','-an','-c:v','libx264','-g','15','-pix_fmt','yuv420p','-f','mpegts',path.join(dir,url(blocks[i]))],
      {encoding:'utf8',timeout:15000});
    assert.equal(generated.status,0,generated.stderr);
  }
  const {playlist,timeline}=make(blocks,{scope:'day',startIso:iso(0),endIso:iso(86400)});
  const manifest=path.join(dir,'index.m3u8');
  fs.writeFileSync(manifest,playlist);
  const decoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',manifest,
    '-vf','scale=1:1','-pix_fmt','rgb24','-vsync','0','-f','rawvideo','pipe:1'],
    {timeout:30000,maxBuffer:1024*1024});
  assert.equal(decoded.status,0,String(decoded.stderr));
  assert.ok(decoded.stdout.length>=85*3);
  const model=normalizeArchiveTimeline(timeline);
  for(const [i,wall] of [101,103,601].entries()){
    const target=seekArchiveWallTime(model,base+wall*1000);
    const offset=Math.floor(target.mediaSeconds*15)*3;
    const rgb=[...decoded.stdout.subarray(offset,offset+3)];
    assert.ok(rgb[i]>90 && rgb[i]>Math.max(...rgb.filter((_,j)=>j!==i))+40,'Correct frame at wall '+wall);
  }
});

test('archive route is authenticated, manifest is scoped and day player does not keep a future-only queue', () => {
  const route=fs.readFileSync(new URL('../src/routes/recordings.js',import.meta.url),'utf8');
  const page=fs.readFileSync(new URL('../../frontend/src/pages/RecordingsPage.jsx',import.meta.url),'utf8');
  const player=fs.readFileSync(new URL('../../frontend/src/components/RecordingArchivePlayer.jsx',import.meta.url),'utf8');
  assert.ok(route.indexOf("recordingsRouter.post('/archive/playback'")>route.indexOf('recordingsRouter.use(authenticate)'));
  assert.match(route,/path: 'archive-playback:' \+ id, action: 'read'/);
  assert.match(route,/archivePlaybackSessions\.get\(id, payload\.sub\)/);
  assert.match(route,/authService\.requireRole\(req\.user\.role, 'operator'\)/);
  assert.match(page,/api\.recordingArchivePlayback\(\{ cameraId: entry\.camera\.id, date: archiveDate/);
  assert.doesNotMatch(page,/futureBlocks|playbackQueue/);
  assert.match(player,/startPosition: requestedStart/);
  assert.match(player,/video\.currentTime = Math\.min\(seconds, max\)/);
});

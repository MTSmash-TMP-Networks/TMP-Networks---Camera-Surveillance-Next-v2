import { db } from '../db/database.js';

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function blockSummary(recordingId) {
  const row = db.prepare(`SELECT
    COUNT(*) AS block_count,
    SUM(CASE WHEN status IN ('ready','recovered') AND size_bytes > 0 THEN 1 ELSE 0 END) AS playable_count,
    SUM(CASE WHEN status IN ('damaged','corrupt','empty','failed') THEN 1 ELSE 0 END) AS damaged_count,
    SUM(CASE WHEN status IN ('ready','recovered') THEN COALESCE(size_bytes,0) ELSE 0 END) AS playable_bytes,
    SUM(CASE WHEN status IN ('ready','recovered') THEN COALESCE(duration_seconds,0) ELSE 0 END) AS media_duration,
    MIN(CASE WHEN status IN ('ready','recovered') AND started_at IS NOT NULL THEN started_at ELSE NULL END) AS first_started_at,
    MAX(CASE WHEN status IN ('ready','recovered') AND ended_at IS NOT NULL THEN ended_at ELSE NULL END) AS last_ended_at
    FROM recording_segments WHERE recording_id=?`).get(recordingId);
  return {
    blockCount: Number(row?.block_count || 0),
    playableBlockCount: Number(row?.playable_count || 0),
    damagedBlockCount: Number(row?.damaged_count || 0),
    blockBytes: Number(row?.playable_bytes || 0),
    mediaDurationSeconds: Number(row?.media_duration || 0),
    firstStartedAt: row?.first_started_at || null,
    lastEndedAt: row?.last_ended_at || null,
  };
}

function publicRecording(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata_json, {});
  const blocks = blockSummary(row.id);
  return {
    id: row.id,
    cameraId: row.camera_id,
    filename: row.filename,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    status: row.status,
    fileSizeBytes: row.file_size_bytes,
    createdAt: row.created_at,
    profileToken: row.recording_group_id || null,
    triggerType: row.trigger_type || 'manual',
    planId: row.plan_id || null,
    eventId: row.event_id || null,
    interruptions: Number(row.interruption_count || 0),
    gapSeconds: Number(row.gap_seconds || 0),
    metadata,
    protectedUntil: row.protected_until || null,
    retentionClass: row.retention_class || 'standard',
    archiveFormat: metadata.storageFormat || 'legacy_file',
    timelineStartedAt: blocks.firstStartedAt || row.started_at,
    timelineEndedAt: blocks.lastEndedAt || row.ended_at,
    ...blocks,
  };
}

function publicSegment(row) {
  if (!row) return null;
  return {
    id: row.id,
    recordingId: row.recording_id,
    segmentIndex: row.segment_index,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    finalizedAt: row.finalized_at || null,
    durationSeconds: Number(row.duration_seconds || 0),
    sizeBytes: Number(row.size_bytes || 0),
    mediaFormat: row.media_format || 'mpegts',
    status: row.status,
    error: row.error,
    gapSeconds: Number(row.gap_seconds || 0),
    discontinuity: Boolean(row.is_discontinuity),
    storageState: row.storage_state || 'local',
    remoteUploadedAt: row.remote_uploaded_at || null,
    storageError: row.storage_error || null,
    playable: ['ready', 'recovered'].includes(row.status) && Number(row.size_bytes || 0) > 0,
  };
}

export const recordingRepository = {
  create({
    cameraId, filename, filePath, profileToken = null, triggerType = 'manual', planId = null,
    eventId = null, metadata = {}, protectedUntil = null, retentionClass = 'standard', segmentSeconds = 0,
  }) {
    const now = new Date().toISOString();
    const result = db.prepare(`INSERT INTO recordings(
      camera_id,filename,file_path,started_at,status,created_at,recording_group_id,segment_index,segment_seconds,
      trigger_type,plan_id,event_id,metadata_json,protected_until,retention_class
    ) VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`).run(
      cameraId, filename, filePath, now, 'recording', now, profileToken, Number(segmentSeconds || 0),
      triggerType, planId, eventId, JSON.stringify(metadata || {}), protectedUntil, retentionClass,
    );
    return this.get(Number(result.lastInsertRowid));
  },

  get(id) {
    return publicRecording(db.prepare('SELECT * FROM recordings WHERE id=?').get(id));
  },

  getInternal(id) {
    return db.prepare('SELECT * FROM recordings WHERE id=?').get(id) || null;
  },

  list({ cameraId = null, limit = 200 } = {}) {
    const rows = cameraId
      ? db.prepare('SELECT * FROM recordings WHERE camera_id=? ORDER BY started_at DESC LIMIT ?').all(cameraId, limit)
      : db.prepare('SELECT * FROM recordings ORDER BY started_at DESC LIMIT ?').all(limit);
    return rows.map(publicRecording);
  },

  active(cameraId = null) {
    const rows = cameraId
      ? db.prepare("SELECT * FROM recordings WHERE status='recording' AND camera_id=? ORDER BY started_at DESC").all(cameraId)
      : db.prepare("SELECT * FROM recordings WHERE status='recording' ORDER BY started_at DESC").all();
    return rows.map(publicRecording);
  },

  mergeMetadata(id, patch = {}) {
    const row = this.getInternal(id);
    if (!row) return null;
    const metadata = { ...parseJson(row.metadata_json, {}), ...(patch || {}) };
    db.prepare('UPDATE recordings SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata), id);
    return this.get(id);
  },

  mergeMetadataByEventId(eventId, patch = {}) {
    if (!eventId) return [];
    const rows = db.prepare('SELECT id,metadata_json FROM recordings WHERE event_id=?').all(eventId);
    const update = db.prepare('UPDATE recordings SET metadata_json=? WHERE id=?');
    for (const row of rows) {
      const metadata = { ...parseJson(row.metadata_json, {}), ...(patch || {}) };
      update.run(JSON.stringify(metadata), row.id);
    }
    return rows.map((row) => this.get(row.id)).filter(Boolean);
  },

  finish(id, {
    filename, filePath, endedAt, durationSeconds, fileSizeBytes, status = 'ready', interruptions = 0,
    gapSeconds = 0, metadata = null,
  }) {
    const row = this.getInternal(id);
    const mergedMetadata = metadata === null ? row?.metadata_json : JSON.stringify({ ...parseJson(row?.metadata_json, {}), ...metadata });
    db.prepare(`UPDATE recordings SET filename=?,file_path=?,ended_at=?,duration_seconds=?,file_size_bytes=?,status=?,
      interruption_count=?,gap_seconds=?,metadata_json=? WHERE id=?`)
      .run(filename, filePath, endedAt, durationSeconds, fileSizeBytes, status, interruptions, gapSeconds, mergedMetadata, id);
    return this.get(id);
  },

  fail(id, endedAt = new Date().toISOString(), metadata = null) {
    const row = this.getInternal(id);
    const mergedMetadata = metadata === null ? row?.metadata_json : JSON.stringify({ ...parseJson(row?.metadata_json, {}), ...metadata });
    db.prepare("UPDATE recordings SET ended_at=?,status='failed',metadata_json=? WHERE id=?").run(endedAt, mergedMetadata, id);
    return this.get(id);
  },

  updateRecovery(id, { interruptions, gapSeconds, metadata = null, status = null }) {
    const row = this.getInternal(id);
    const mergedMetadata = metadata === null ? row?.metadata_json : JSON.stringify({ ...parseJson(row?.metadata_json, {}), ...metadata });
    if (status) {
      db.prepare('UPDATE recordings SET interruption_count=?,gap_seconds=?,metadata_json=?,status=? WHERE id=?')
        .run(Number(interruptions || 0), Number(gapSeconds || 0), mergedMetadata, status, id);
    } else {
      db.prepare('UPDATE recordings SET interruption_count=?,gap_seconds=?,metadata_json=? WHERE id=?')
        .run(Number(interruptions || 0), Number(gapSeconds || 0), mergedMetadata, id);
    }
  },

  upsertSegment(recordingId, segment) {
    db.prepare(`INSERT INTO recording_segments(
      recording_id,segment_index,file_path,started_at,ended_at,size_bytes,status,error,gap_seconds,
      duration_seconds,media_format,finalized_at,is_discontinuity
    ) VALUES(@recordingId,@segmentIndex,@filePath,@startedAt,@endedAt,@sizeBytes,@status,@error,@gapSeconds,
      @durationSeconds,@mediaFormat,@finalizedAt,@isDiscontinuity)
      ON CONFLICT(recording_id,segment_index) DO UPDATE SET
        file_path=excluded.file_path,
        started_at=COALESCE(excluded.started_at,recording_segments.started_at),
        ended_at=excluded.ended_at,
        size_bytes=excluded.size_bytes,
        status=excluded.status,
        error=excluded.error,
        gap_seconds=excluded.gap_seconds,
        duration_seconds=excluded.duration_seconds,
        media_format=excluded.media_format,
        finalized_at=excluded.finalized_at,
        is_discontinuity=excluded.is_discontinuity`)
      .run({
        recordingId,
        segmentIndex: Number(segment.segmentIndex),
        filePath: segment.filePath,
        startedAt: segment.startedAt || null,
        endedAt: segment.endedAt || null,
        sizeBytes: Number(segment.sizeBytes || 0),
        status: segment.status || 'ready',
        error: segment.error || null,
        gapSeconds: Number(segment.gapSeconds || 0),
        durationSeconds: Number(segment.durationSeconds || 0),
        mediaFormat: segment.mediaFormat || 'mpegts',
        finalizedAt: segment.finalizedAt || null,
        isDiscontinuity: segment.discontinuity || segment.isDiscontinuity ? 1 : 0,
      });
  },

  segments(recordingId) {
    return db.prepare('SELECT * FROM recording_segments WHERE recording_id=? ORDER BY segment_index').all(recordingId).map(publicSegment);
  },

  segmentsInternal(recordingId) {
    return db.prepare('SELECT * FROM recording_segments WHERE recording_id=? ORDER BY segment_index').all(recordingId);
  },


  assignNetworkStorage(recordingId, segmentIndex, { profileId, remotePath }) {
    db.prepare(`UPDATE recording_segments SET storage_profile_id=?,remote_path=?,storage_state='pending',storage_error=NULL
      WHERE recording_id=? AND segment_index=?`).run(profileId, remotePath, Number(recordingId), Number(segmentIndex));
    return this.segmentInternal(recordingId, segmentIndex);
  },

  markStorageState(recordingId, segmentIndex, { state, error = null, uploadedAt = null }) {
    db.prepare(`UPDATE recording_segments SET storage_state=?,storage_error=?,remote_uploaded_at=COALESCE(?,remote_uploaded_at)
      WHERE recording_id=? AND segment_index=?`).run(state, error, uploadedAt, Number(recordingId), Number(segmentIndex));
    return this.segmentInternal(recordingId, segmentIndex);
  },

  updateSegmentAfterCompression(recordingId, segmentIndex, { sizeBytes, durationSeconds, mediaFormat = 'mpegts' }) {
    db.prepare(`UPDATE recording_segments SET size_bytes=?,duration_seconds=?,media_format=?,finalized_at=?
      WHERE recording_id=? AND segment_index=?`).run(
      Number(sizeBytes || 0), Number(durationSeconds || 0), mediaFormat, new Date().toISOString(), recordingId, segmentIndex,
    );
    return this.segment(recordingId, segmentIndex);
  },

  recalculateSize(recordingId) {
    const summary = db.prepare(`SELECT COALESCE(SUM(size_bytes),0) AS bytes
      FROM recording_segments WHERE recording_id=? AND status IN ('ready','recovered')`).get(recordingId);
    db.prepare('UPDATE recordings SET file_size_bytes=? WHERE id=?').run(Number(summary?.bytes || 0), recordingId);
    return Number(summary?.bytes || 0);
  },

  exportCandidates({ cameraId, startedBefore, endedAfter, limit = 10000 }) {
    const rows = db.prepare(`SELECT * FROM recordings
      WHERE camera_id=?
        AND status IN ('ready','ready_with_gaps','recording')
        AND started_at < ?
        AND (ended_at IS NULL OR ended_at > ?)
      ORDER BY started_at ASC
      LIMIT ?`).all(cameraId, startedBefore, endedAfter, Math.max(1, Math.min(100000, Number(limit) || 10000)));
    return rows.map(publicRecording);
  },

  playableSegmentsInternal(recordingId) {
    return db.prepare("SELECT * FROM recording_segments WHERE recording_id=? AND status IN ('ready','recovered') AND size_bytes > 0 ORDER BY segment_index").all(recordingId);
  },

  segment(recordingId, segmentIndex) {
    return publicSegment(db.prepare('SELECT * FROM recording_segments WHERE recording_id=? AND segment_index=?').get(recordingId, segmentIndex));
  },

  segmentInternal(recordingId, segmentIndex) {
    return db.prepare('SELECT * FROM recording_segments WHERE recording_id=? AND segment_index=?').get(recordingId, segmentIndex) || null;
  },

  retentionRows(cameraId) {
    return db.prepare(`SELECT * FROM recordings WHERE camera_id=? AND status IN ('ready','ready_with_gaps','recording','failed') ORDER BY started_at ASC`).all(cameraId);
  },

  failedWithPotentialSegments(limit = 100) {
    return db.prepare("SELECT * FROM recordings WHERE status='failed' ORDER BY started_at DESC LIMIT ?").all(limit);
  },

  recoverableSessions(limit = 100) {
    return db.prepare("SELECT * FROM recordings WHERE status IN ('recording','interrupted','failed') ORDER BY started_at ASC LIMIT ?").all(limit);
  },

  remove(id) {
    return db.prepare('DELETE FROM recordings WHERE id=?').run(id).changes > 0;
  },
};

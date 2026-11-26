// Network archival must not depend indefinitely on optional recompression.
// All claims are synchronous SQLite transactions; a compression job in
// 'processing' is never eligible, even with compression disabled or disk full.
export const NETWORK_UPLOAD_BYPASS_REASON = 'Netzwerkarchivierung hat Vorrang vor Hintergrundkomprimierung';
const MiB = 1024 * 1024;

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? fallback :
    Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

export function networkUploadPolicy({ env = process.env, freeBytes = Infinity, pendingBytes = 0,
  minimumFreeBytes = 0, compressionEnabled = true, nowMs = Date.now() } = {}) {
  const reserve = Math.max(2 * 1024 * MiB, 2 * minimumFreeBytes,
    boundedInteger(env.NETWORK_RECORDING_UPLOAD_RESERVE_BYTES, 2 * 1024 * MiB, 256 * MiB, Number.MAX_SAFE_INTEGER));
  const backlogLimit = boundedInteger(env.NETWORK_RECORDING_UPLOAD_BACKLOG_BYTES, 512 * MiB, 64 * MiB, Number.MAX_SAFE_INTEGER);
  const maxWaitMs = boundedInteger(env.NETWORK_RECORDING_COMPRESSION_MAX_WAIT_MS, 600_000, 0, 86_400_000);
  const regular = boundedInteger(env.NETWORK_RECORDING_UPLOAD_CONCURRENCY, 2, 1, 4);
  const accelerated = Math.max(regular, boundedInteger(env.NETWORK_RECORDING_UPLOAD_PRESSURE_CONCURRENCY, 4, 1, 4));
  const pressure = freeBytes < reserve || pendingBytes >= backlogLimit;
  return { pressure, concurrency: pressure ? accelerated : regular,
    bypass: !compressionEnabled || pressure, cutoffMs: nowMs - maxWaitMs, nowMs };
}

const UPLOAD_JOIN = 'FROM recording_segments s JOIN recordings r ON r.id=s.recording_id LEFT JOIN recording_compression_jobs c ON c.recording_id=s.recording_id AND c.segment_index=s.segment_index';
const UPLOAD_WHERE = "s.storage_profile_id IS NOT NULL AND s.remote_path IS NOT NULL AND s.storage_state IN ('pending','uploading','upload_failed') AND s.status IN ('ready','recovered') AND r.status IN ('recording','ready','ready_with_gaps')";
const UPLOAD_ELIGIBLE = "(c.status IN ('completed','skipped','failed') OR (COALESCE(c.status,'none') IN ('none','queued','retry') AND (s.storage_state='uploading' OR ?=1 OR COALESCE(julianday(s.finalized_at),julianday(s.ended_at),julianday(s.started_at),0)<=julianday(?))))";
const argsFor = (policy) => [policy.bypass ? 1 : 0, new Date(policy.cutoffMs).toISOString()];

export function selectNetworkUploadCandidates(db, policy, blockedProfileIds = []) {
  const allowed = blockedProfileIds.length ? ' AND s.storage_profile_id NOT IN (' + blockedProfileIds.map(() => '?').join(',') + ')' : '';
  return db.prepare('SELECT s.* ' + UPLOAD_JOIN + ' WHERE ' + UPLOAD_WHERE + ' AND ' +
    UPLOAD_ELIGIBLE + allowed + ' ORDER BY s.id ASC LIMIT ?').all(...argsFor(policy), ...blockedProfileIds, policy.concurrency * 3);
}

/** Claim and recheck immediately before reading a file. The compressor excludes
 * storage_state=uploading; neither worker yields to the event loop between
 * selecting its current job and setting the state protecting that job.
 */
export function claimNetworkUpload(db, id, policy, canClaim = () => true) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT s.*,c.status AS compression_status ' + UPLOAD_JOIN + ' WHERE s.id=? AND ' +
      UPLOAD_WHERE + ' AND ' + UPLOAD_ELIGIBLE).get(id, ...argsFor(policy));
    if (!row || !canClaim(row)) { db.exec('COMMIT'); return null; }
    db.prepare("UPDATE recording_segments SET storage_state='uploading',storage_error=NULL WHERE id=?").run(id);
    // Persist the intentional skip. A failed network transfer is retryable, but
    // must not be blocked again by the compression queue.
    if (['queued','retry'].includes(row.compression_status)) {
      const now = new Date(policy.nowMs).toISOString();
      db.prepare("UPDATE recording_compression_jobs SET status='skipped',error=?,updated_at=?,completed_at=?,next_attempt_at=NULL,started_at=NULL WHERE recording_id=? AND segment_index=? AND status IN ('queued','retry')")
        .run(NETWORK_UPLOAD_BYPASS_REASON, now, now, row.recording_id, row.segment_index);
    }
    db.exec('COMMIT');
    return row;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

/** Bound asynchronous transfer concurrency, and finish all active operations
 * before returning even if one unexpectedly throws. */
export async function runNetworkUploadBatch(rows, concurrency, upload) {
  let cursor = 0;
  const failures = [];
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try { await upload(row); } catch (error) { failures.push(error); }
    }
  }
  await Promise.all(Array.from({length: Math.min(rows.length, Math.max(1, concurrency))}, worker));
  if (failures.length) throw new AggregateError(failures, 'Network recording upload batch failed');
}

function number(value) { return Number(value || 0); }
function startedMs(row) { return new Date(row.started_at || row.startedAt || 0).getTime() || 0; }
function isEvent(row) { return (row.trigger_type || row.triggerType) === 'event' || (row.retention_class || row.retentionClass) === 'event'; }
function protectedNow(row, nowMs) {
  const value = row.protected_until || row.protectedUntil;
  return Boolean(value && new Date(value).getTime() > nowMs);
}

/**
 * Computes a deterministic deletion plan without touching the file system.
 * Event protection gives event recordings their own age limit and makes quota
 * cleanup consume ordinary recordings first. Active and explicitly protected
 * rows are never selected.
 */
export function planRetentionDeletion(rows, policy, { nowMs = Date.now(), freeBytes = Number.POSITIVE_INFINITY } = {}) {
  if (!policy?.cleanupEnabled || policy.strategy === 'none') return [];
  const chronological = [...rows].sort((a, b) => startedMs(a) - startedMs(b));
  const quotaOrder = [...chronological].sort((a, b) => {
    if (policy.protectEventRecordings) {
      const eventOrder = Number(isEvent(a)) - Number(isEvent(b));
      if (eventOrder) return eventOrder;
    }
    return startedMs(a) - startedMs(b);
  });
  const selected = new Map();
  const canDelete = (row) => !protectedNow(row, nowMs) && row.status !== 'recording' && !Boolean(row.pipeline_busy ?? row.pipelineBusy);
  const select = (row, reason) => {
    if (!canDelete(row)) return false;
    const existing = selected.get(row.id);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return false;
    }
    selected.set(row.id, { row, reasons: [reason] });
    return true;
  };
  const usesAge = ['age', 'hybrid'].includes(policy.strategy);
  const usesQuota = ['quota', 'hybrid'].includes(policy.strategy);

  if (usesAge) {
    for (const row of chronological) {
      const eventProtected = isEvent(row) && policy.protectEventRecordings;
      const days = number(eventProtected ? policy.eventMaxAgeDays : policy.maxAgeDays);
      if (days <= 0) continue; // Zero disables age deletion for this class.
      if (nowMs - startedMs(row) >= days * 86_400_000) select(row, eventProtected ? 'event-age' : 'age');
    }
  }

  if (usesQuota && number(policy.maxRecordings) > 0) {
    const retained = chronological.filter((row) => !selected.has(row.id));
    let required = Math.max(0, retained.length - number(policy.maxRecordings));
    for (const row of quotaOrder) {
      if (required <= 0) break;
      if (selected.has(row.id)) continue;
      if (select(row, 'count')) required -= 1;
    }
  }

  if (usesQuota && number(policy.maxStorageBytes) > 0) {
    let total = chronological.filter((row) => !selected.has(row.id)).reduce((sum, row) => sum + number(row.file_size_bytes ?? row.fileSizeBytes), 0);
    for (const row of quotaOrder) {
      if (total <= number(policy.maxStorageBytes)) break;
      if (selected.has(row.id) || !canDelete(row)) continue;
      if (select(row, 'camera-quota')) total -= number(row.file_size_bytes ?? row.fileSizeBytes);
    }
  }

  if (usesQuota && Number.isFinite(freeBytes) && freeBytes < number(policy.minFreeBytes)) {
    let projected = freeBytes;
    for (const row of quotaOrder) {
      if (projected >= number(policy.minFreeBytes)) break;
      if (selected.has(row.id) || !canDelete(row)) continue;
      // Remote recordings do not free local spool space. Only count bytes that
      // still physically exist on the recording host. This prevents low local
      // disk pressure from deleting valid NAS/SFTP archive rows without freeing
      // the disk that triggered retention in the first place.
      const localBytes = number(row.local_file_bytes ?? row.localFileBytes);
      // A recording that already belongs to a remote archive must not be
      // deleted wholesale just to clean an unexpected local residue. Startup
      // reconciliation owns those duplicates and verifies the remote object
      // before removing local bytes. This avoids deleting valid NAS/SFTP media
      // to solve pressure on the wrong filesystem.
      const remoteBacked = Boolean(row.remote_backed ?? row.remoteBacked);
      if (localBytes <= 0 || remoteBacked) continue;
      if (select(row, 'minimum-free-space')) projected += localBytes;
    }
  }

  return [...selected.values()].map(({ row, reasons }) => ({
    id: row.id,
    filePath: row.file_path || row.filePath,
    sizeBytes: number(row.file_size_bytes ?? row.fileSizeBytes),
    localBytes: number(row.local_file_bytes ?? row.localFileBytes),
    reasons,
  }));
}

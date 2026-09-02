const NUMERIC_PROGRESS_KEYS = new Set(['frame', 'out_time_us', 'out_time_ms', 'total_size']);

export function createStreamProgressTracker() {
  return { values: new Map(), updates: 0 };
}

export function consumeFfmpegProgress(tracker, lines = []) {
  const target = tracker || createStreamProgressTracker();
  let advanced = false;
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    if (!NUMERIC_PROGRESS_KEYS.has(key)) continue;
    const value = Number(line.slice(separator + 1));
    if (!Number.isFinite(value)) continue;
    const previous = target.values.get(key);
    if (previous === undefined || value > previous) advanced = true;
    if (previous === undefined || value >= previous) target.values.set(key, value);
  }
  if (advanced) target.updates += 1;
  return advanced;
}

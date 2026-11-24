const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function normalizeArchiveTimeline(timeline) {
  const startMs = Date.parse(timeline?.startIso || '');
  const endMs = Date.parse(timeline?.endIso || '');
  if (!Number.isFinite(startMs) || !(endMs > startMs)) return null;
  const spans = (timeline.spans || []).map((item) => ({
    ...item, startMs: Date.parse(item.startIso), endMs: Date.parse(item.endIso),
    mediaStart: Number(item.mediaStartSeconds), mediaEnd: Number(item.mediaEndSeconds),
  })).filter((s) => Number.isFinite(s.startMs) && s.endMs > s.startMs &&
    Number.isFinite(s.mediaStart) && s.mediaEnd > s.mediaStart)
    .sort((a,b) => a.startMs - b.startMs);
  if (!spans.length) return null;
  const coverage = [];
  for (const span of spans) {
    const previous = coverage.at(-1);
    if (previous && span.startMs <= previous.endMs + 100) previous.endMs = Math.max(previous.endMs, span.endMs);
    else coverage.push({ startMs: span.startMs, endMs: span.endMs });
  }
  return { ...timeline, startMs, endMs, spans, coverage, duration: (endMs - startMs) / 1000 };
}

/** Jump to any second of recorded wall time, not just the beginning of a file.
 * In an unrecorded gap select the next playable block; past the final block
 * select its last playable instant instead of inventing footage.
 */
export function seekArchiveWallTime(model, targetMs) {
  if (!model) return null;
  const requested = clamp(Number.isFinite(targetMs) ? targetMs : model.startMs, model.startMs, model.endMs);
  const next = model.spans.find((span) => span.endMs > requested);
  const span = next || model.spans.at(-1);
  const wallMs = next ? Math.max(span.startMs, requested) : Math.max(span.startMs, span.endMs - Math.min(100, (span.endMs - span.startMs) / 2));
  const ratio = clamp((wallMs - span.startMs) / (span.endMs - span.startMs), 0, 1);
  return { wallMs, mediaSeconds: span.mediaStart + ratio * (span.mediaEnd - span.mediaStart),
    gap: requested < span.startMs || requested >= span.endMs };
}

/** Map media time back to real recording time. Prefixes/suffixes from blocks
 * that cross midnight or overlap other blocks are not part of the day view.
 */
export function archiveWallTimeAtMedia(model, seconds) {
  if (!model || !Number.isFinite(seconds)) return null;
  const first = model.spans[0], last = model.spans.at(-1);
  if (seconds >= last.mediaEnd) return { wallMs: last.endMs, ended: true };
  const span = model.spans.find((s) => seconds < s.mediaEnd);
  if (!span) return { wallMs: last.endMs, ended: true };
  if (seconds < span.mediaStart) return { wallMs: span.startMs,
    skipTo: span.mediaStart - seconds > 0.25 ? span.mediaStart : null };
  const ratio = clamp((seconds - span.mediaStart) / (span.mediaEnd - span.mediaStart), 0, 1);
  return { wallMs: span.startMs + ratio * (span.endMs - span.startMs), ended: false };
}

export function timelinePercent(model, wallMs) {
  return clamp((wallMs - model.startMs) / (model.endMs - model.startMs) * 100, 0, 100);
}

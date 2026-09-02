/** Accepts both synchronous and asynchronous teardown callbacks. */
export async function runStreamCleanup(cleanup) {
  if (typeof cleanup !== 'function') return;
  try { await cleanup(); } catch { /* Teardown must never block recovery. */ }
}

function finiteUptime(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function serviceRestartObserved({ baselineUptime, currentStatus, observedOffline = false }) {
  const before = finiteUptime(baselineUptime);
  const current = finiteUptime(currentStatus?.system?.serviceUptimeSeconds);
  if (current === null) return false;
  if (observedOffline) return true;
  if (before !== null && current + 2 < before) return true;
  return false;
}

export async function waitForSystemRestart({
  fetchStatus,
  baselineUptime,
  signal,
  timeoutMs = 180_000,
  intervalMs = 2_000,
  initialDelayMs = 2_500,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof fetchStatus !== 'function') throw new TypeError('fetchStatus muss eine Funktion sein');
  const startedAt = Date.now();
  let observedOffline = false;
  await wait(initialDelayMs);

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new DOMException('Neustartbeobachtung abgebrochen', 'AbortError');
    try {
      const currentStatus = await fetchStatus();
      if (serviceRestartObserved({ baselineUptime, currentStatus, observedOffline })) {
        return { status: currentStatus, observedOffline };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      observedOffline = true;
    }
    await wait(intervalMs);
  }

  const error = new Error('Der Wiederanlauf konnte nicht innerhalb des Zeitlimits bestätigt werden.');
  error.code = 'SYSTEM_RESTART_CONFIRMATION_TIMEOUT';
  throw error;
}

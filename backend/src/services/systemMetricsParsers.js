function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampPercent(value) {
  const number = finite(value, 0);
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

export function calculateFilesystemUsagePercent(usedBytes, availableBytes, totalBytes = 0) {
  const used = Math.max(0, finite(usedBytes, 0));
  const available = Math.max(0, finite(availableBytes, 0));
  // Match the semantics of `df`: reserved filesystem blocks are not counted as
  // space available to normal processes. This keeps the UI percentage aligned
  // with the host while still showing the raw filesystem total separately.
  const allocatable = used + available;
  if (allocatable > 0) return clampPercent((used / allocatable) * 100);
  const total = Math.max(0, finite(totalBytes, 0));
  return total > 0 ? clampPercent((used / total) * 100) : null;
}

export function filesystemCapacityMatches(leftBytes, rightBytes, toleranceRatio = 0.02) {
  const left = Math.max(0, finite(leftBytes, 0));
  const right = Math.max(0, finite(rightBytes, 0));
  if (!left || !right) return false;
  const tolerance = Math.max(128 * 1024 * 1024, Math.max(left, right) * Math.max(0, finite(toleranceRatio, 0.02)));
  return Math.abs(left - right) <= tolerance;
}

function bytesFromKb(value) {
  return Math.max(0, finite(value, 0) * 1024);
}

export function parseCpuStat(contents) {
  const cpus = {};
  for (const line of String(contents || '').split(/\r?\n/)) {
    const match = line.match(/^(cpu\d*)\s+(.+)$/);
    if (!match) continue;
    const values = match[2].trim().split(/\s+/).slice(0, 8).map((value) => finite(value, 0));
    if (values.length < 4) continue;
    const total = values.reduce((sum, value) => sum + value, 0);
    const idle = (values[3] || 0) + (values[4] || 0);
    cpus[match[1]] = { total, idle };
  }
  return cpus;
}

export function calculateCpuUsage(previous, current) {
  const output = {};
  for (const [name, sample] of Object.entries(current || {})) {
    const before = previous?.[name];
    if (!before) {
      output[name] = null;
      continue;
    }
    const totalDelta = sample.total - before.total;
    const idleDelta = sample.idle - before.idle;
    output[name] = totalDelta > 0 ? clampPercent(((totalDelta - idleDelta) / totalDelta) * 100) : null;
  }
  return output;
}

export function parseMemInfo(contents) {
  const values = {};
  for (const line of String(contents || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)/);
    if (match) values[match[1]] = bytesFromKb(match[2]);
  }
  const totalBytes = values.MemTotal || 0;
  const availableBytes = values.MemAvailable || values.MemFree || 0;
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapTotalBytes = values.SwapTotal || 0;
  const swapFreeBytes = values.SwapFree || 0;
  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usagePercent: totalBytes ? clampPercent((usedBytes / totalBytes) * 100) : 0,
    swapTotalBytes,
    swapUsedBytes: Math.max(0, swapTotalBytes - swapFreeBytes),
    swapUsagePercent: swapTotalBytes ? clampPercent(((swapTotalBytes - swapFreeBytes) / swapTotalBytes) * 100) : 0,
  };
}

export function parseNvidiaCsv(contents) {
  return String(contents || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(',').map((item) => item.trim());
      if (fields.length < 7) return null;
      const [index, name, uuid, utilization, memoryTotal, memoryUsed, temperature] = fields;
      const totalBytes = Math.max(0, finite(memoryTotal, 0) * 1024 * 1024);
      const usedBytes = Math.max(0, finite(memoryUsed, 0) * 1024 * 1024);
      return {
        id: `nvidia-${index}`,
        index: finite(index, null),
        name: name || 'NVIDIA GPU',
        vendor: 'NVIDIA',
        utilizationPercent: utilization === '[N/A]' ? null : clampPercent(utilization),
        memoryTotalBytes: totalBytes,
        memoryUsedBytes: usedBytes,
        memoryUsagePercent: totalBytes ? clampPercent((usedBytes / totalBytes) * 100) : null,
        temperatureC: temperature === '[N/A]' ? null : finite(temperature, null),
        source: 'nvidia-smi',
      };
    })
    .filter(Boolean);
}

export function parseNetworkDev(contents) {
  const output = {};
  for (const line of String(contents || '').split(/\r?\n/)) {
    if (!line.includes(':')) continue;
    const [rawName, rawValues] = line.split(':');
    const name = rawName.trim();
    if (!name || name === 'Inter-|') continue;
    const values = rawValues.trim().split(/\s+/).map((value) => finite(value, 0));
    if (values.length < 16) continue;
    output[name] = {
      rxBytes: Math.max(0, values[0]),
      rxPackets: Math.max(0, values[1]),
      rxErrors: Math.max(0, values[2]),
      rxDropped: Math.max(0, values[3]),
      txBytes: Math.max(0, values[8]),
      txPackets: Math.max(0, values[9]),
      txErrors: Math.max(0, values[10]),
      txDropped: Math.max(0, values[11]),
    };
  }
  return output;
}

export function calculateNetworkRates(previous, current, elapsedMs) {
  const seconds = Math.max(Number(elapsedMs || 0) / 1000, 0.001);
  const output = {};
  for (const [name, sample] of Object.entries(current || {})) {
    const before = previous?.[name];
    if (!before) continue;
    const rxDelta = Math.max(0, sample.rxBytes - before.rxBytes);
    const txDelta = Math.max(0, sample.txBytes - before.txBytes);
    output[name] = {
      ...sample,
      rxBytesPerSecond: rxDelta / seconds,
      txBytesPerSecond: txDelta / seconds,
      totalBytesPerSecond: (rxDelta + txDelta) / seconds,
      rxPacketsPerSecond: Math.max(0, sample.rxPackets - before.rxPackets) / seconds,
      txPacketsPerSecond: Math.max(0, sample.txPackets - before.txPackets) / seconds,
    };
  }
  return output;
}

export function toFiniteNumber(value, fallback = null) {
  return finite(value, fallback);
}

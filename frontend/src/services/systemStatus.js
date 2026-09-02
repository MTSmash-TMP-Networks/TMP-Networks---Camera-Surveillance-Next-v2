export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / (1024 ** index);
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function formatBitRate(bytesPerSecond) {
  const bps = Math.max(0, Number(bytesPerSecond || 0) * 8);
  if (!Number.isFinite(bps) || bps <= 0) return '0 bit/s';
  const units = ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bps) / Math.log(1000)));
  const amount = bps / (1000 ** index);
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function formatDuration(value, { day = 'T', hour = 'Std', minute = 'Min' } = {}) {
  let seconds = Math.max(0, Math.floor(Number(value || 0)));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  if (days) return `${days} ${day} ${hours} ${hour}`;
  if (hours) return `${hours} ${hour} ${minutes} ${minute}`;
  return `${minutes} ${minute}`;
}

export function metricSeverity(value, { warning = 75, critical = 90 } = {}) {
  const percent = Number(value || 0);
  if (percent >= critical) return 'critical';
  if (percent >= warning) return 'warning';
  return 'normal';
}

export function appendMetricSample(history = [], value, limit = 30) {
  const next = [...history, Math.max(0, Math.min(100, Number(value || 0)))];
  return next.slice(Math.max(0, next.length - limit));
}

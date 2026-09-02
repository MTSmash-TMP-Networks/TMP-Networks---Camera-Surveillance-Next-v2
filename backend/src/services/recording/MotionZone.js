function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Motion zones are stored as normalized coordinates so the same camera setting
 * works for snapshots, substreams and full-resolution streams alike.
 */
export function normalizeMotionZone(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = clamp(finiteNumber(value.x), 0, 1);
  const y = clamp(finiteNumber(value.y), 0, 1);
  const width = clamp(finiteNumber(value.width), 0, 1 - x);
  const height = clamp(finiteNumber(value.height), 0, 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function motionZonePixelBounds(value, width, height) {
  const frameWidth = Math.max(1, Math.floor(finiteNumber(width, 1)));
  const frameHeight = Math.max(1, Math.floor(finiteNumber(height, 1)));
  const zone = normalizeMotionZone(value);
  if (!zone) {
    return {
      active: false,
      zone: null,
      xStart: 0,
      yStart: 0,
      xEnd: frameWidth,
      yEnd: frameHeight,
      pixels: frameWidth * frameHeight,
    };
  }

  const xStart = clamp(Math.floor(zone.x * frameWidth), 0, frameWidth - 1);
  const yStart = clamp(Math.floor(zone.y * frameHeight), 0, frameHeight - 1);
  const xEnd = clamp(Math.ceil((zone.x + zone.width) * frameWidth), xStart + 1, frameWidth);
  const yEnd = clamp(Math.ceil((zone.y + zone.height) * frameHeight), yStart + 1, frameHeight);
  return {
    active: true,
    zone,
    xStart,
    yStart,
    xEnd,
    yEnd,
    pixels: Math.max(1, (xEnd - xStart) * (yEnd - yStart)),
  };
}

export function motionZoneKey(value) {
  const zone = normalizeMotionZone(value);
  if (!zone) return 'full-frame';
  return [zone.x, zone.y, zone.width, zone.height].map((part) => Number(part).toFixed(6)).join(':');
}

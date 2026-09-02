import { config } from '../../config.js';
import { evaluateRecordingPlans } from './RecordingSchedule.js';
import { motionZonePixelBounds } from './MotionZone.js';

export function selectMotionBaseline(previousFrame, previousSourceKey, currentSourceKey) {
  const previousKey = String(previousSourceKey || '').trim();
  const currentKey = String(currentSourceKey || '').trim();
  const sourceChanged = Boolean(previousKey && currentKey && previousKey !== currentKey);
  return { frame: sourceChanged ? null : previousFrame, sourceChanged };
}

export function clampRatio(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function emptyComparison(reason, extra = {}) {
  return {
    motion: false,
    reason,
    changedRatio: 0,
    averageDiff: 0,
    changedPixels: 0,
    pixels: 0,
    maxDiff: 0,
    activeRegions: 0,
    totalRegions: 0,
    globalBrightnessShift: 0,
    alignmentX: 0,
    alignmentY: 0,
    sceneChange: false,
    ...extra,
  };
}

function dimensionsForFrame(length, width, height) {
  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  if (Number.isInteger(parsedWidth) && Number.isInteger(parsedHeight)
      && parsedWidth > 0 && parsedHeight > 0 && parsedWidth * parsedHeight === length) {
    return { width: parsedWidth, height: parsedHeight, valid: true };
  }
  return { width: length, height: 1, valid: false };
}

function overlap(width, height, shiftX, shiftY, zoneBounds = null) {
  let xStart = Math.max(0, -shiftX);
  let xEnd = Math.min(width, width - shiftX);
  let yStart = Math.max(0, -shiftY);
  let yEnd = Math.min(height, height - shiftY);

  if (zoneBounds?.active) {
    // Both the baseline coordinate and the shifted current-frame coordinate
    // must stay inside the configured motion zone. This prevents alignment
    // from pulling pixels from outside the user's selected area into the ROI.
    xStart = Math.max(xStart, zoneBounds.xStart, zoneBounds.xStart - shiftX);
    xEnd = Math.min(xEnd, zoneBounds.xEnd, zoneBounds.xEnd - shiftX);
    yStart = Math.max(yStart, zoneBounds.yStart, zoneBounds.yStart - shiftY);
    yEnd = Math.min(yEnd, zoneBounds.yEnd, zoneBounds.yEnd - shiftY);
  }

  return { xStart, xEnd, yStart, yEnd };
}

function alignmentScore(previous, current, width, height, shiftX, shiftY, compensateBrightness, zoneBounds) {
  const bounds = overlap(width, height, shiftX, shiftY, zoneBounds);
  let deltaSum = 0;
  let count = 0;
  const sampleStep = width * height > 25_000 ? 2 : 1;

  for (let y = bounds.yStart; y < bounds.yEnd; y += sampleStep) {
    for (let x = bounds.xStart; x < bounds.xEnd; x += sampleStep) {
      const previousIndex = y * width + x;
      const currentIndex = (y + shiftY) * width + (x + shiftX);
      deltaSum += current[currentIndex] - previous[previousIndex];
      count += 1;
    }
  }
  if (!count) return { score: Number.POSITIVE_INFINITY, brightnessShift: 0 };

  const brightnessShift = compensateBrightness ? deltaSum / count : 0;
  let residualSum = 0;
  for (let y = bounds.yStart; y < bounds.yEnd; y += sampleStep) {
    for (let x = bounds.xStart; x < bounds.xEnd; x += sampleStep) {
      const previousIndex = y * width + x;
      const currentIndex = (y + shiftY) * width + (x + shiftX);
      residualSum += Math.abs((current[currentIndex] - previous[previousIndex]) - brightnessShift);
    }
  }

  // A small shift must improve the comparison measurably. This prevents normal
  // object movement from being incorrectly aligned away as camera jitter.
  const shiftPenalty = (Math.abs(shiftX) + Math.abs(shiftY)) * 0.15;
  return { score: residualSum / count + shiftPenalty, brightnessShift };
}

function bestAlignment(previous, current, width, height, maxShiftPixels, compensateBrightness, zoneBounds) {
  const limit = Math.max(0, Math.min(4, Number(maxShiftPixels) || 0));
  if (!limit || height < 2) return { shiftX: 0, shiftY: 0 };
  let minimum = 255;
  let maximum = 0;
  const textureBounds = overlap(width, height, 0, 0, zoneBounds);
  const texturePixels = Math.max(1, (textureBounds.xEnd - textureBounds.xStart) * (textureBounds.yEnd - textureBounds.yStart));
  const sampleStep = Math.max(1, Math.ceil(Math.sqrt(texturePixels / 2048)));
  for (let y = textureBounds.yStart; y < textureBounds.yEnd; y += sampleStep) {
    for (let x = textureBounds.xStart; x < textureBounds.xEnd; x += sampleStep) {
      const value = previous[y * width + x];
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
  }
  // Alignment is unreliable on almost textureless frames and can otherwise
  // hide a real object entering through the image border. When a motion zone
  // is configured, only texture inside that zone participates in alignment.
  if (maximum - minimum < 16) return { shiftX: 0, shiftY: 0 };
  let best = { shiftX: 0, shiftY: 0, score: Number.POSITIVE_INFINITY };
  for (let shiftY = -limit; shiftY <= limit; shiftY += 1) {
    for (let shiftX = -limit; shiftX <= limit; shiftX += 1) {
      const candidate = alignmentScore(previous, current, width, height, shiftX, shiftY, compensateBrightness, zoneBounds);
      if (candidate.score < best.score) best = { shiftX, shiftY, score: candidate.score };
    }
  }
  return best;
}

function compareAligned(previous, current, {
  width,
  height,
  shiftX,
  shiftY,
  threshold,
  compensateBrightness,
  regionSize,
  zoneBounds,
}) {
  const bounds = overlap(width, height, shiftX, shiftY, zoneBounds);
  let deltaSum = 0;
  let pixels = 0;
  for (let y = bounds.yStart; y < bounds.yEnd; y += 1) {
    for (let x = bounds.xStart; x < bounds.xEnd; x += 1) {
      const previousIndex = y * width + x;
      const currentIndex = (y + shiftY) * width + (x + shiftX);
      deltaSum += current[currentIndex] - previous[previousIndex];
      pixels += 1;
    }
  }
  if (!pixels) return emptyComparison('empty-overlap');

  const globalBrightnessShift = compensateBrightness ? deltaSum / pixels : 0;
  const cellSize = Math.max(2, Math.min(64, Number(regionSize) || 8));
  const regionColumns = Math.max(1, Math.ceil(width / cellSize));
  const regionCounts = new Map();
  const regionPixels = new Map();
  let changedPixels = 0;
  let diffSum = 0;
  let maxDiff = 0;

  for (let y = bounds.yStart; y < bounds.yEnd; y += 1) {
    for (let x = bounds.xStart; x < bounds.xEnd; x += 1) {
      const previousIndex = y * width + x;
      const currentIndex = (y + shiftY) * width + (x + shiftX);
      const diff = Math.abs((current[currentIndex] - previous[previousIndex]) - globalBrightnessShift);
      const region = Math.floor(y / cellSize) * regionColumns + Math.floor(x / cellSize);
      regionPixels.set(region, (regionPixels.get(region) || 0) + 1);
      diffSum += diff;
      if (diff > maxDiff) maxDiff = diff;
      if (diff >= threshold) {
        changedPixels += 1;
        regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
      }
    }
  }

  let activeRegions = 0;
  for (const [region, count] of regionCounts.entries()) {
    const minimum = Math.max(2, Math.ceil((regionPixels.get(region) || 1) * 0.04));
    if (count >= minimum) activeRegions += 1;
  }

  return {
    changedPixels,
    changedRatio: changedPixels / pixels,
    averageDiff: diffSum / pixels,
    pixels,
    maxDiff,
    activeRegions,
    totalRegions: regionPixels.size,
    globalBrightnessShift,
  };
}

/**
 * Compare two low-resolution grayscale frames.
 *
 * The optional stabilization compensates one or two pixels of camera shake and
 * the brightness correction removes global exposure changes. Both preserve
 * local movement while reducing false alarms caused by compression noise,
 * autofocus, day/night switching and minor PTZ settling.
 */
export function compareMotionFrames(previous, current, {
  width = null,
  height = null,
  pixelThreshold = 10,
  minChangedRatio = 0.008,
  minAverageDiff = 0.6,
  minChangedPixels = null,
  maxShiftPixels = 0,
  compensateBrightness = false,
  regionSize = 8,
  sceneChangeRatio = 0.85,
  sceneChangeMinAverageDiff = 12,
  suppressSceneChanges = false,
  motionZone = null,
} = {}) {
  if (!previous || !current || !Buffer.isBuffer(previous) || !Buffer.isBuffer(current)) {
    return emptyComparison('initializing');
  }
  if (!previous.length || !current.length) return emptyComparison('empty-frame');
  if (previous.length !== current.length) {
    return emptyComparison('frame-size-mismatch', {
      previousPixels: previous.length,
      currentPixels: current.length,
    });
  }

  const dimensions = dimensionsForFrame(previous.length, width, height);
  const zoneBounds = dimensions.valid
    ? motionZonePixelBounds(motionZone, dimensions.width, dimensions.height)
    : motionZonePixelBounds(null, dimensions.width, dimensions.height);
  const threshold = Math.max(1, Math.min(255, Number(pixelThreshold) || 10));
  const requestedPixelFloor = Number(minChangedPixels);
  const automaticPixelFloor = Math.min(18, Math.max(1, Math.ceil(zoneBounds.pixels * 0.0035)));
  const pixelFloor = Number.isFinite(requestedPixelFloor) && requestedPixelFloor > 0
    ? Math.min(zoneBounds.pixels, Math.max(1, Math.round(requestedPixelFloor)))
    : automaticPixelFloor;
  const alignment = bestAlignment(
    previous,
    current,
    dimensions.width,
    dimensions.height,
    dimensions.valid ? maxShiftPixels : 0,
    Boolean(compensateBrightness),
    zoneBounds,
  );
  const metrics = compareAligned(previous, current, {
    width: dimensions.width,
    height: dimensions.height,
    shiftX: alignment.shiftX,
    shiftY: alignment.shiftY,
    threshold,
    compensateBrightness: Boolean(compensateBrightness),
    regionSize,
    zoneBounds,
  });
  if (!metrics.pixels) return { ...metrics, motionZone: zoneBounds.zone, motionZoneActive: zoneBounds.active };

  const ratioLimit = clampRatio(minChangedRatio, 0.008);
  const averageLimit = Math.max(0, Number(minAverageDiff) || 0);
  const sceneRatioLimit = clampRatio(sceneChangeRatio, 0.85);
  const sceneAverageLimit = Math.max(0, Number(sceneChangeMinAverageDiff) || 0);
  const enoughPixels = metrics.changedPixels >= pixelFloor;
  const enoughRatio = metrics.changedRatio >= ratioLimit;
  const enoughAverage = metrics.averageDiff >= averageLimit;
  const sceneChange = metrics.changedRatio >= sceneRatioLimit && metrics.averageDiff >= sceneAverageLimit;

  // Local motion often covers only a small part of a surveillance image. An
  // absolute pixel floor therefore guards against noise while ratio OR average
  // difference may trigger the event. Scene suppression is opt-in because a
  // covered lens is also security-relevant motion.
  const rawMotion = enoughPixels && (enoughRatio || enoughAverage);
  const motion = rawMotion && !(sceneChange && suppressSceneChanges);
  let reason = 'too-few-pixels';
  if (sceneChange && suppressSceneChanges) reason = 'scene-change-suppressed';
  else if (motion) reason = sceneChange ? 'motion-scene-change' : 'motion';
  else if (enoughPixels) reason = 'below-threshold';

  return {
    ...metrics,
    motion,
    reason,
    sceneChange,
    threshold,
    minChangedPixels: pixelFloor,
    motionZone: zoneBounds.zone,
    motionZoneActive: zoneBounds.active,
    alignmentX: alignment.shiftX,
    alignmentY: alignment.shiftY,
  };
}


export function pushMotionWindow(window = [], motion = false, maxFrames = 4) {
  const limit = Math.max(1, Math.min(30, Math.round(Number(maxFrames) || 4)));
  const next = Array.isArray(window) ? window.slice(-limit + 1) : [];
  next.push(Boolean(motion));
  return next.slice(-limit);
}

export function summarizeMotionWindow(window = [], minMotionFrames = 1) {
  const values = Array.isArray(window) ? window.map(Boolean) : [];
  const required = Math.max(1, Math.min(values.length || 1, Math.round(Number(minMotionFrames) || 1)));
  const motionFrames = values.filter(Boolean).length;
  return {
    frames: values.length,
    motionFrames,
    requiredMotionFrames: required,
    active: motionFrames >= required,
  };
}

function withMotionBasis(comparison, basis, extra = {}) {
  return {
    ...comparison,
    basis,
    comparisonBasis: basis,
    ...extra,
  };
}

export function chooseMotionComparison(shortTermComparison, referenceComparison, { motionActive = false } = {}) {
  const shortTerm = shortTermComparison || emptyComparison('initializing');
  const reference = referenceComparison || null;
  const referenceExtra = {
    shortTermMotion: Boolean(shortTerm.motion),
    shortTermChangedRatio: shortTerm.changedRatio || 0,
    shortTermAverageDiff: shortTerm.averageDiff || 0,
    referenceMotion: Boolean(reference?.motion),
    referenceChangedRatio: reference?.changedRatio || 0,
    referenceAverageDiff: reference?.averageDiff || 0,
  };

  // While an event is already open, use the previous-frame comparison for
  // re-arming. A changed reference scene must not keep the detector permanently
  // latched after an object has stopped moving.
  if (motionActive) return withMotionBasis(shortTerm, 'previous-frame', referenceExtra);
  if (shortTerm.motion) return withMotionBasis(shortTerm, 'previous-frame', referenceExtra);
  if (reference?.motion) return withMotionBasis(reference, 'stable-reference', referenceExtra);

  const selected = reference && (reference.changedRatio > shortTerm.changedRatio || reference.averageDiff > shortTerm.averageDiff)
    ? withMotionBasis(reference, 'stable-reference', referenceExtra)
    : withMotionBasis(shortTerm, 'previous-frame', referenceExtra);
  return selected;
}

export function hasActiveMotionPlan(plans, date = new Date()) {
  const eventPlans = (plans || []).filter((plan) => plan.enabled !== false
    && plan.mode === 'event'
    && (plan.eventTypes || []).map((type) => String(type).toLowerCase()).includes('motion'));
  if (!eventPlans.length) return null;

  // Evaluate the calendar rules with a synthetic motion pulse. This respects
  // weekdays, date exceptions and time windows without requiring a configured
  // prebuffer. Otherwise event plans with zero seconds prebuffer would never be
  // watched for real motion.
  const syntheticEvent = {
    id: 'motion-detector-probe',
    type: 'motion',
    state: 'pulse',
    startedAt: date.toISOString(),
    expiresAt: new Date(date.getTime() + 1000).toISOString(),
    createdAt: date.toISOString(),
  };
  const decision = evaluateRecordingPlans(eventPlans, [syntheticEvent], date);
  if (!decision.shouldRecord) return null;
  const plan = eventPlans.find((item) => decision.planIds?.includes(item.id)) || eventPlans[0];
  return {
    plan,
    eventSeconds: Math.max(config.motionDetectionEventSeconds, Number(plan.postbufferSeconds || 0), 1),
    quality: decision.quality || plan.quality || 'balanced',
    profileToken: decision.profileToken || plan.profileToken || null,
  };
}

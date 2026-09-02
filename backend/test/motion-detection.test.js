import { describe, expect, it } from 'vitest';
import { chooseMotionComparison, compareMotionFrames, hasActiveMotionPlan, pushMotionWindow, selectMotionBaseline, summarizeMotionWindow } from '../src/services/recording/MotionDetectionAlgorithm.js';

function frame(values) { return Buffer.from(values); }

describe('MotionDetectionService', () => {
  it('erkennt keine Bewegung bei identischen Frames', () => {
    const result = compareMotionFrames(frame([10, 20, 30, 40]), frame([10, 20, 30, 40]), {
      pixelThreshold: 5,
      minChangedRatio: 0.25,
      minAverageDiff: 1,
    });
    expect(result.motion).toBe(false);
    expect(result.changedPixels).toBe(0);
  });

  it('erkennt sichtbare Bildveraenderung ueber Schwellwert', () => {
    const result = compareMotionFrames(frame([10, 10, 10, 10]), frame([40, 40, 10, 10]), {
      pixelThreshold: 10,
      minChangedRatio: 0.5,
      minAverageDiff: 10,
    });
    expect(result.motion).toBe(true);
    expect(result.changedPixels).toBe(2);
  });


  it('erkennt kleine lokale Bewegung auch wenn die Durchschnittsaenderung niedrig ist', () => {
    const before = Buffer.alloc(96 * 54, 20);
    const after = Buffer.from(before);
    for (let index = 0; index < 60; index += 1) after[index] = 70;
    const result = compareMotionFrames(before, after, {
      pixelThreshold: 10,
      minChangedRatio: 0.008,
      minAverageDiff: 0.6,
      minChangedPixels: 18,
    });
    expect(result.motion).toBe(true);
    expect(result.changedPixels).toBe(60);
  });

  it('behaelt lokale Objektbewegung trotz Stabilisierung und Belichtungskompensation bei', () => {
    const width = 32;
    const height = 18;
    const before = Buffer.alloc(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) before[y * width + x] = (x * 7 + y * 11 + (x * y) % 31) % 180 + 30;
    }
    const after = Buffer.from(before);
    for (let y = 6; y < 12; y += 1) {
      for (let x = 12; x < 20; x += 1) after[y * width + x] = 245;
    }
    const result = compareMotionFrames(before, after, {
      width,
      height,
      pixelThreshold: 10,
      minChangedRatio: 0.008,
      minAverageDiff: 0.6,
      minChangedPixels: 18,
      maxShiftPixels: 1,
      compensateBrightness: true,
    });
    expect(result.motion).toBe(true);
    expect(result.changedPixels).toBeGreaterThanOrEqual(18);
    expect(result.activeRegions).toBeGreaterThan(0);
  });

  it('ignoriert einen gleichmaessigen Helligkeitswechsel mit Belichtungskompensation', () => {
    const before = Buffer.alloc(12 * 8, 30);
    const after = Buffer.alloc(12 * 8, 65);
    const result = compareMotionFrames(before, after, {
      width: 12,
      height: 8,
      pixelThreshold: 10,
      minChangedRatio: 0.01,
      minAverageDiff: 1,
      minChangedPixels: 2,
      compensateBrightness: true,
    });
    expect(result.motion).toBe(false);
    expect(result.changedPixels).toBe(0);
    expect(result.globalBrightnessShift).toBeCloseTo(35, 4);
  });

  it('stabilisiert eine reine Ein-Pixel-Bildverschiebung', () => {
    const width = 16;
    const height = 10;
    const before = Buffer.alloc(width * height, 0);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 2; x += 1) before[y * width + x] = (x * 13 + y * 7) % 255;
    }
    const shifted = Buffer.alloc(width * height, 0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width - 1; x += 1) shifted[y * width + x + 1] = before[y * width + x];
    }
    const result = compareMotionFrames(before, shifted, {
      width,
      height,
      pixelThreshold: 8,
      minChangedRatio: 0.01,
      minAverageDiff: 1,
      minChangedPixels: 2,
      maxShiftPixels: 1,
    });
    expect(result.motion).toBe(false);
    expect(result.alignmentX).toBe(1);
    expect(result.changedPixels).toBe(0);
  });



  it('bestaetigt Bewegungen ueber ein Sliding Window und kann danach wieder neu ausloesen', () => {
    let window = [];
    window = pushMotionWindow(window, false, 4);
    window = pushMotionWindow(window, true, 4);
    window = pushMotionWindow(window, true, 4);
    let summary = summarizeMotionWindow(window, 2);
    expect(summary).toMatchObject({ frames: 3, motionFrames: 2, requiredMotionFrames: 2, active: true });

    window = pushMotionWindow(window, false, 4);
    window = pushMotionWindow(window, false, 4);
    window = pushMotionWindow(window, false, 4);
    summary = summarizeMotionWindow(window, 2);
    expect(summary.active).toBe(false);

    window = pushMotionWindow(window, true, 4);
    window = pushMotionWindow(window, true, 4);
    summary = summarizeMotionWindow(window, 2);
    expect(summary.active).toBe(true);
  });

  it('nutzt die stabile Referenz zum Erkennen neuer Bewegung und den Kurzzeitvergleich zum Re-Arm waehrend aktiver Bewegung', () => {
    const quietShort = { motion: false, changedRatio: 0, averageDiff: 0, changedPixels: 0, reason: 'below-threshold' };
    const referenceMotion = { motion: true, changedRatio: 0.05, averageDiff: 8, changedPixels: 80, reason: 'motion' };
    const inactive = chooseMotionComparison(quietShort, referenceMotion, { motionActive: false });
    expect(inactive.motion).toBe(true);
    expect(inactive.comparisonBasis).toBe('stable-reference');

    const active = chooseMotionComparison(quietShort, referenceMotion, { motionActive: true });
    expect(active.motion).toBe(false);
    expect(active.comparisonBasis).toBe('previous-frame');
  });

  it('setzt nach einem Wechsel der Live-Quelle eine neue Vergleichsbasis', () => {
    const frame = Buffer.alloc(20, 10);
    expect(selectMotionBaseline(frame, 'live-rtsp|stream-a', 'live-hls|stream-a')).toEqual({ frame: null, sourceChanged: true });
    expect(selectMotionBaseline(frame, 'live-rtsp|stream-a', 'live-rtsp|stream-a')).toEqual({ frame, sourceChanged: false });
  });

  it('weist unvollstaendige oder unterschiedlich grosse Frames zurueck', () => {
    const result = compareMotionFrames(Buffer.alloc(20), Buffer.alloc(19), { width: 5, height: 4 });
    expect(result).toMatchObject({ motion: false, reason: 'frame-size-mismatch' });
  });

  it('aktiviert Bewegung nur fuer aktive Ereignisplaene mit motion', () => {
    const motion = hasActiveMotionPlan([{ id: 'p1', name: 'Motion', enabled: true, mode: 'event', timezone: 'Europe/Berlin', weekdays: [0,1,2,3,4,5,6], startTime: '00:00', endTime: '23:59', includeDates: [], excludeDates: [], holidayPolicy: 'include', holidayDates: [], eventTypes: ['motion'], prebufferSeconds: 0, postbufferSeconds: 10, priority: 100, quality: 'balanced' }], new Date('2026-07-23T12:00:00Z'));
    const sensor = hasActiveMotionPlan([{ id: 'p2', name: 'Sensor', enabled: true, mode: 'event', timezone: 'Europe/Berlin', weekdays: [0,1,2,3,4,5,6], startTime: '00:00', endTime: '23:59', includeDates: [], excludeDates: [], holidayPolicy: 'include', holidayDates: [], eventTypes: ['sensor'], prebufferSeconds: 0, postbufferSeconds: 10, priority: 100, quality: 'balanced' }], new Date('2026-07-23T12:00:00Z'));
    expect(motion?.plan?.id).toBe('p1');
    expect(sensor).toBeNull();
  });
});

it('wertet bei konfigurierter Motion-Zone nur Pixel innerhalb des markierten Bereichs aus', () => {
  const width = 10;
  const height = 10;
  const before = Buffer.alloc(width * height, 20);
  const outsideChange = Buffer.from(before);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < 4; x += 1) outsideChange[y * width + x] = 90;
  }
  const options = {
    width,
    height,
    motionZone: { x: 0.5, y: 0, width: 0.5, height: 1 },
    pixelThreshold: 10,
    minChangedRatio: 0.01,
    minAverageDiff: 0.1,
    minChangedPixels: 1,
  };
  const ignored = compareMotionFrames(before, outsideChange, options);
  expect(ignored.motion).toBe(false);
  expect(ignored.changedPixels).toBe(0);
  expect(ignored.pixels).toBe(50);
  expect(ignored.motionZoneActive).toBe(true);

  const insideChange = Buffer.from(before);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 6; x < 9; x += 1) insideChange[y * width + x] = 90;
  }
  const detected = compareMotionFrames(before, insideChange, options);
  expect(detected.motion).toBe(true);
  expect(detected.changedPixels).toBe(12);
  expect(detected.pixels).toBe(50);
});

import { describe, expect, it } from 'vitest';
import { evaluateRecordingPlans, isPlanCalendarActive, matchingEventForPlan, normalizeRecordingPlan } from '../src/services/recording/RecordingSchedule.js';

const monday0900 = new Date('2026-07-20T07:00:00.000Z'); // 09:00 Europe/Berlin

function plan(patch = {}) {
  return normalizeRecordingPlan({
    id: 'plan-1', name: 'Büro', mode: 'scheduled', timezone: 'Europe/Berlin',
    weekdays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '16:00',
    quality: 'balanced', ...patch,
  });
}

describe('Aufnahmeplanung', () => {
  it('aktiviert einen Wochenplan in der lokalen Zeitzone', () => {
    expect(isPlanCalendarActive(plan(), monday0900)).toBe(true);
    expect(isPlanCalendarActive(plan(), new Date('2026-07-20T17:00:00.000Z'))).toBe(false);
  });

  it('unterstützt über Mitternacht laufende Intervalle', () => {
    const overnight = plan({ weekdays: [1], startTime: '22:00', endTime: '06:00' });
    expect(isPlanCalendarActive(overnight, new Date('2026-07-20T21:00:00.000Z'))).toBe(true);
    expect(isPlanCalendarActive(overnight, new Date('2026-07-21T03:00:00.000Z'))).toBe(true);
  });

  it('wendet Ausnahmen und Feiertagsregeln an', () => {
    expect(isPlanCalendarActive(plan({ excludeDates: ['2026-07-20'] }), monday0900)).toBe(false);
    expect(isPlanCalendarActive(plan({ holidayPolicy: 'only', holidayDates: ['2026-07-20'] }), monday0900)).toBe(true);
  });

  it('behält explizit leere Wochentage für reine Einschlusstage bei', () => {
    const dateOnly = plan({ weekdays: [], includeDates: ['2026-07-20'] });
    expect(dateOnly.weekdays).toEqual([]);
    expect(isPlanCalendarActive(dateOnly, monday0900)).toBe(true);
    expect(isPlanCalendarActive(dateOnly, new Date('2026-07-21T07:00:00.000Z'))).toBe(false);
  });

  it('lässt eine Ausnahme am Folgetag ein Nachtintervall um Mitternacht stoppen', () => {
    const overnight = plan({ weekdays: [1], startTime: '22:00', endTime: '06:00', excludeDates: ['2026-07-21'] });
    expect(isPlanCalendarActive(overnight, new Date('2026-07-21T03:00:00.000Z'))).toBe(false);
  });

  it('hält ein start-Ereignis bis zu einem stop-Ereignis aktiv', () => {
    const eventPlan = plan({ mode: 'event', eventTypes: ['motion'], postbufferSeconds: 15 });
    const event = { id: 'event-1', type: 'motion', state: 'start', startedAt: '2026-07-20T06:00:00.000Z' };
    expect(matchingEventForPlan(eventPlan, [event], monday0900)?.id).toBe('event-1');
  });

  it('hält ein beendetes Ereignis während des konfigurierten Nachlaufs aktiv', () => {
    const eventPlan = plan({ mode: 'event', eventTypes: ['motion'], postbufferSeconds: 15 });
    const event = { id: 'event-stop', type: 'motion', state: 'stop', startedAt: '2026-07-20T06:59:00.000Z', endedAt: '2026-07-20T06:59:50.000Z' };
    expect(matchingEventForPlan(eventPlan, [event], new Date('2026-07-20T07:00:00.000Z'))?.id).toBe('event-stop');
    expect(matchingEventForPlan(eventPlan, [event], new Date('2026-07-20T07:00:06.000Z'))).toBeNull();
  });

  it('meldet während eines aktiven Ereigniskalenders einen Vorlauf-Standby ohne Aufnahme', () => {
    const result = evaluateRecordingPlans([
      plan({ id: 'event-standby', mode: 'event', eventTypes: ['motion'], prebufferSeconds: 8 }),
    ], [], monday0900);
    expect(result.shouldRecord).toBe(false);
    expect(result.eventStandby).toBe(true);
    expect(result.standbyPrebufferSeconds).toBe(8);
    expect(result.standbyPlanIds).toContain('event-standby');
  });

  it('führt überlappende Pläne zu genau einer Aufnahmeentscheidung zusammen', () => {
    const events = [{ id: 'event-2', type: 'motion', state: 'pulse', startedAt: monday0900.toISOString(), expiresAt: new Date(monday0900.getTime() + 60000).toISOString() }];
    const result = evaluateRecordingPlans([
      plan({ id: 'scheduled', priority: 100, quality: 'balanced' }),
      plan({ id: 'event', mode: 'event', priority: 50, quality: 'high', eventTypes: ['motion'] }),
    ], events, monday0900);
    expect(result.shouldRecord).toBe(true);
    expect(result.mode).toBe('scheduled');
    expect(result.planIds).toEqual(expect.arrayContaining(['scheduled', 'event']));
    expect(result.eventId).toBe('event-2');
    expect(result.quality).toBe('balanced');
  });
});

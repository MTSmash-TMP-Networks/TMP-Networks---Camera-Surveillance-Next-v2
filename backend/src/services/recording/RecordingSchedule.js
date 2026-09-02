const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function uniqueSorted(values = []) {
  return [...new Set(values)].sort();
}

function isValidDateKey(value) {
  if (!DATE_RE.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function timeToMinutes(value, fallback = 0) {
  if (!TIME_RE.test(String(value || ''))) return fallback;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function safeTimeZone(value) {
  const timezone = String(value || 'Europe/Berlin');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'Europe/Berlin';
  }
}

export function localDateParts(date = new Date(), timezone = 'Europe/Berlin') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timezone),
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    year, month, day, hour, minute,
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: hour * 60 + minute,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

export function normalizeRecordingPlan(plan = {}) {
  const mode = ['continuous', 'event', 'scheduled'].includes(plan.mode) ? plan.mode : 'scheduled';
  const hasWeekdays = Array.isArray(plan.weekdays);
  const weekdays = uniqueSorted((hasWeekdays ? plan.weekdays : [0, 1, 2, 3, 4, 5, 6])
    .map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  const normalizeDates = (value) => uniqueSorted((Array.isArray(value) ? value : []).filter(isValidDateKey));
  const hasEventTypes = Array.isArray(plan.eventTypes);
  const eventTypes = uniqueSorted((hasEventTypes ? plan.eventTypes : ['motion', 'sensor', 'analytics'])
    .map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  return {
    ...plan,
    name: String(plan.name || 'Aufnahmeplan').trim().slice(0, 160),
    mode,
    enabled: plan.enabled !== false,
    timezone: safeTimeZone(plan.timezone),
    // An explicit empty list is meaningful for date-only schedules and must not become "all days".
    weekdays,
    startTime: TIME_RE.test(String(plan.startTime || '')) ? plan.startTime : '00:00',
    endTime: TIME_RE.test(String(plan.endTime || '')) ? plan.endTime : '23:59',
    validFrom: isValidDateKey(plan.validFrom) ? plan.validFrom : null,
    validUntil: isValidDateKey(plan.validUntil) ? plan.validUntil : null,
    includeDates: normalizeDates(plan.includeDates),
    excludeDates: normalizeDates(plan.excludeDates),
    holidayPolicy: ['include', 'exclude', 'only'].includes(plan.holidayPolicy) ? plan.holidayPolicy : 'include',
    holidayDates: normalizeDates(plan.holidayDates),
    eventTypes,
    prebufferSeconds: Math.max(0, Math.min(120, Number(plan.prebufferSeconds || 0))),
    postbufferSeconds: Math.max(0, Math.min(3600, Number(plan.postbufferSeconds ?? 10))),
    priority: Math.max(0, Math.min(10_000, Number(plan.priority ?? 100))),
    quality: ['high', 'balanced', 'low'].includes(plan.quality) ? plan.quality : 'balanced',
    profileToken: plan.profileToken ? String(plan.profileToken).slice(0, 300) : null,
  };
}

function shiftCalendarDay(parts, delta) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + delta));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return {
    ...parts,
    year,
    month,
    day,
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday: date.getUTCDay(),
  };
}

function dateRulesAllow(plan, parts) {
  if (plan.validFrom && parts.date < plan.validFrom) return false;
  if (plan.validUntil && parts.date > plan.validUntil) return false;
  if (plan.excludeDates.includes(parts.date)) return false;
  const holiday = plan.holidayDates.includes(parts.date);
  if (plan.holidayPolicy === 'exclude' && holiday) return false;
  if (plan.holidayPolicy === 'only' && !holiday) return false;
  return true;
}

function daySelected(plan, parts) {
  return plan.includeDates.includes(parts.date) || plan.weekdays.includes(parts.weekday);
}

function selectedCalendarDayAllows(plan, parts) {
  return dateRulesAllow(plan, parts) && daySelected(plan, parts);
}

function weekdayAndTimeActive(plan, parts) {
  if (plan.mode === 'continuous') return dateRulesAllow(plan, parts);
  const start = timeToMinutes(plan.startTime, 0);
  const end = timeToMinutes(plan.endTime, 1439);
  if (start === end) return selectedCalendarDayAllows(plan, parts);
  if (start < end) {
    return parts.minutes >= start && parts.minutes < end && selectedCalendarDayAllows(plan, parts);
  }
  if (parts.minutes >= start) return selectedCalendarDayAllows(plan, parts);
  if (parts.minutes >= end) return false;

  // The early-morning part belongs to the calendar day on which the overnight interval started.
  // A current-date explicit exclusion still wins, so maintenance/holiday exceptions can stop it at midnight.
  if (plan.excludeDates.includes(parts.date)) return false;
  return selectedCalendarDayAllows(plan, shiftCalendarDay(parts, -1));
}

export function isPlanCalendarActive(input, date = new Date()) {
  const plan = normalizeRecordingPlan(input);
  if (!plan.enabled) return false;
  return weekdayAndTimeActive(plan, localDateParts(date, plan.timezone));
}

function eventDeadline(event, postbufferSeconds) {
  const bufferMs = Math.max(0, Number(postbufferSeconds || 0)) * 1000;
  const explicit = event.expiresAt ? new Date(event.expiresAt).getTime() : NaN;
  if (Number.isFinite(explicit)) return explicit + bufferMs;
  const end = event.endedAt ? new Date(event.endedAt).getTime() : NaN;
  if (Number.isFinite(end)) return end + bufferMs;
  if (String(event.state || '') === 'start' && !event.endedAt && !event.expiresAt) return Number.POSITIVE_INFINITY;
  const start = new Date(event.startedAt || event.createdAt || 0).getTime();
  return Number.isFinite(start) ? start + bufferMs : 0;
}

export function matchingEventForPlan(input, events = [], date = new Date()) {
  const plan = normalizeRecordingPlan(input);
  const now = date.getTime();
  return events
    .filter((event) => plan.eventTypes.includes(String(event.type || '').toLowerCase()))
    .filter((event) => String(event.state || '') !== 'stop' || event.endedAt)
    .map((event) => ({ event, deadline: eventDeadline(event, plan.postbufferSeconds) }))
    .filter(({ deadline }) => deadline >= now)
    .sort((left, right) => right.deadline - left.deadline)[0]?.event || null;
}

export function evaluateRecordingPlans(plans = [], events = [], date = new Date()) {
  const calendarActive = plans.map(normalizeRecordingPlan).filter((plan) => isPlanCalendarActive(plan, date));
  const direct = calendarActive.filter((plan) => ['continuous', 'scheduled'].includes(plan.mode));
  const eventPlans = calendarActive.filter((plan) => plan.mode === 'event');
  const eventMatches = eventPlans
    .map((plan) => ({ plan, event: matchingEventForPlan(plan, events, date) }))
    .filter((entry) => entry.event);
  const selected = [...direct, ...eventMatches.map((entry) => entry.plan)];
  const standbyPlan = [...eventPlans].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))[0] || null;
  const standby = {
    eventStandby: Boolean(standbyPlan && eventPlans.some((plan) => plan.prebufferSeconds > 0)),
    standbyPrebufferSeconds: Math.max(...eventPlans.map((plan) => plan.prebufferSeconds), 0),
    standbyQuality: standbyPlan?.quality || 'balanced',
    standbyProfileToken: standbyPlan?.profileToken || null,
    standbyPlanIds: eventPlans.map((plan) => plan.id).filter(Boolean),
  };
  if (!selected.length) return { shouldRecord: false, mode: 'off', planIds: [], eventId: null, prebufferSeconds: 0, postbufferSeconds: 0, quality: 'balanced', profileToken: null, ...standby };
  const ordered = [...selected].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  const primary = (direct.length ? [...direct] : ordered).sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))[0];
  const matchedEvent = eventMatches.sort((left, right) => left.plan.priority - right.plan.priority)[0]?.event || null;
  return {
    shouldRecord: true,
    mode: direct.length ? (primary.mode === 'continuous' ? 'continuous' : 'scheduled') : 'event',
    planIds: ordered.map((plan) => plan.id).filter(Boolean),
    primaryPlanId: primary.id || null,
    eventId: matchedEvent?.id || null,
    eventActive: Boolean(matchedEvent),
    prebufferSeconds: Math.max(...ordered.map((plan) => plan.prebufferSeconds), 0),
    postbufferSeconds: Math.max(...ordered.map((plan) => plan.postbufferSeconds), 0),
    quality: primary.quality || 'balanced',
    profileToken: primary.profileToken || null,
    ...standby,
  };
}

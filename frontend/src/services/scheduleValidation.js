const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidIsoDate(value) {
  if (!DATE_RE.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat(globalThis.document?.documentElement?.lang || 'en', { timeZone: String(value || '') }).format(new Date());
    return Boolean(value);
  } catch {
    return false;
  }
}

export function parseDateList(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
}

function fallback(key, variables = {}) {
  const values = {
    'recordings.validation.planFallback': `Plan ${variables.index || ''}`,
    'recordings.validation.nameMissing': `${variables.label}: Name is required.`,
    'recordings.validation.modeInvalid': `${variables.label}: Recording mode is invalid.`,
    'recordings.validation.timeInvalid': `${variables.label}: Start or end time is invalid.`,
    'recordings.validation.timezoneInvalid': `${variables.label}: Time zone is invalid.`,
    'recordings.validation.startDateInvalid': `${variables.label}: Start date is invalid.`,
    'recordings.validation.endDateInvalid': `${variables.label}: End date is invalid.`,
    'recordings.validation.endBeforeStart': `${variables.label}: End date is before the start date.`,
    'recordings.validation.invalidDates': `${variables.label}: ${variables.field} contains invalid dates.`,
    'recordings.validation.weekdayRequired': `${variables.label}: At least one weekday or included date is required.`,
    'recordings.validation.eventTypeRequired': `${variables.label}: At least one event type is required.`,
    'recordings.validation.includeExcludeConflict': `${variables.label}: A date cannot be included and excluded at the same time.`,
    'recordings.validation.holidayRequired': `${variables.label}: At least one holiday is required for “Holidays only”.`,
    'recordings.validation.priorityInvalid': `${variables.label}: Priority must be between 0 and 10000.`,
    'recordings.validation.prebufferInvalid': `${variables.label}: Pre-roll must be between 0 and ${variables.max} seconds.`,
    'recordings.validation.postbufferInvalid': `${variables.label}: Post-roll must be between 0 and 3600 seconds.`,
    'recordings.validation.holidayRuleInvalid': `${variables.label}: Holiday rule is invalid.`,
    'recordings.plan.includeDates': 'Included dates',
    'recordings.plan.exceptions': 'Exceptions',
    'recordings.plan.holidays': 'Holidays',
  };
  return values[key] || key;
}

export function validateRecordingPlans(plans = [], { prebufferMaxSeconds = 120, t = fallback } = {}) {
  const errors = [];
  plans.forEach((plan, index) => {
    const label = plan.name || t('recordings.validation.planFallback', { index: index + 1 });
    if (!String(plan.name || '').trim()) errors.push(t('recordings.validation.nameMissing', { label }));
    if (!['continuous', 'event', 'scheduled'].includes(plan.mode)) errors.push(t('recordings.validation.modeInvalid', { label }));
    if (!TIME_RE.test(plan.startTime || '') || !TIME_RE.test(plan.endTime || '')) errors.push(t('recordings.validation.timeInvalid', { label }));
    if (!isValidTimeZone(plan.timezone || 'Europe/Berlin')) errors.push(t('recordings.validation.timezoneInvalid', { label }));
    if (plan.validFrom && !isValidIsoDate(plan.validFrom)) errors.push(t('recordings.validation.startDateInvalid', { label }));
    if (plan.validUntil && !isValidIsoDate(plan.validUntil)) errors.push(t('recordings.validation.endDateInvalid', { label }));
    if (plan.validFrom && plan.validUntil && plan.validUntil < plan.validFrom) errors.push(t('recordings.validation.endBeforeStart', { label }));
    for (const [field, titleKey] of [['includeDates', 'recordings.plan.includeDates'], ['excludeDates', 'recordings.plan.exceptions'], ['holidayDates', 'recordings.plan.holidays']]) {
      const invalid = parseDateList(plan[field]).filter((item) => !isValidIsoDate(item));
      if (invalid.length) errors.push(t('recordings.validation.invalidDates', { label, field: t(titleKey) }));
    }
    if (plan.mode !== 'continuous' && !(plan.weekdays || []).length && !parseDateList(plan.includeDates).length) errors.push(t('recordings.validation.weekdayRequired', { label }));
    if (plan.mode === 'event' && !(plan.eventTypes || []).filter(Boolean).length) errors.push(t('recordings.validation.eventTypeRequired', { label }));
    const includes = parseDateList(plan.includeDates);
    const excludes = parseDateList(plan.excludeDates);
    if (includes.some((entry) => excludes.includes(entry))) errors.push(t('recordings.validation.includeExcludeConflict', { label }));
    if ((plan.holidayPolicy || 'include') === 'only' && !parseDateList(plan.holidayDates).length) errors.push(t('recordings.validation.holidayRequired', { label }));
    if (!Number.isInteger(Number(plan.priority)) || Number(plan.priority) < 0 || Number(plan.priority) > 10000) errors.push(t('recordings.validation.priorityInvalid', { label }));
    if (!Number.isInteger(Number(plan.prebufferSeconds || 0)) || Number(plan.prebufferSeconds || 0) < 0 || Number(plan.prebufferSeconds || 0) > prebufferMaxSeconds) errors.push(t('recordings.validation.prebufferInvalid', { label, max: prebufferMaxSeconds }));
    if (!Number.isInteger(Number(plan.postbufferSeconds || 0)) || Number(plan.postbufferSeconds || 0) < 0 || Number(plan.postbufferSeconds || 0) > 3600) errors.push(t('recordings.validation.postbufferInvalid', { label }));
    if (!['include', 'exclude', 'only'].includes(plan.holidayPolicy || 'include')) errors.push(t('recordings.validation.holidayRuleInvalid', { label }));
  });
  return errors;
}

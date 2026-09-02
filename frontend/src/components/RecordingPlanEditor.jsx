import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { parseDateList } from '../services/scheduleValidation.js';
import { useI18n } from '../i18n/index.js';

const weekdayValues = [1, 2, 3, 4, 5, 6, 0];

export function newRecordingPlan(index = 0, name = `Recording plan ${index + 1}`) {
  return {
    name, mode: 'scheduled', enabled: true, timezone: 'Europe/Berlin',
    weekdays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '16:00', validFrom: null, validUntil: null,
    includeDates: [], excludeDates: [], holidayPolicy: 'include', holidayDates: [], eventTypes: ['motion', 'sensor'],
    prebufferSeconds: 5, postbufferSeconds: 15, priority: (index + 1) * 100, quality: 'balanced', profileToken: null,
  };
}

function dateList(value) { return (value || []).join(', '); }

function weekdayLabel(locale, weekday) {
  const reference = new Date(Date.UTC(2026, 0, 5 + ((weekday + 6) % 7)));
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(reference);
}

export function RecordingPlanEditor({ plans, onChange, disabled = false, prebufferMaxSeconds = 10 }) {
  const { t, locale } = useI18n();
  const patch = (index, values) => onChange(plans.map((plan, itemIndex) => itemIndex === index ? { ...plan, ...values } : plan));
  const remove = (index) => onChange(plans.filter((_plan, itemIndex) => itemIndex !== index));
  return <section className="planner-section">
    <header><div><CalendarDays/><span><strong>{t('recordings.plan.title')}</strong><small>{t('recordings.plan.description')}</small></span></div><button type="button" className="secondary-button" disabled={disabled} onClick={() => onChange([...plans, newRecordingPlan(plans.length, t('recordings.plan.defaultName', { index: plans.length + 1 }))])}><Plus/> {t('recordings.plan.add')}</button></header>
    <div className="plan-list">{plans.map((plan, index) => <article className="recording-plan-card" key={plan.id || index}>
      <div className="plan-card-header"><label className="switch-row"><input type="checkbox" checked={plan.enabled !== false} disabled={disabled} onChange={(event) => patch(index, { enabled: event.target.checked })}/><span>{t('recordings.plan.enabled')}</span></label><input className="plan-name" value={plan.name} disabled={disabled} onChange={(event) => patch(index, { name: event.target.value })}/><button type="button" className="icon-danger" disabled={disabled} onClick={() => remove(index)} title={t('recordings.plan.delete')}><Trash2/></button></div>
      <div className="planner-grid">
        <label>{t('recordings.plan.mode')}<select value={plan.mode} disabled={disabled} onChange={(event) => patch(index, { mode: event.target.value })}><option value="continuous">{t('recordings.plan.modeContinuous')}</option><option value="scheduled">{t('recordings.plan.modeScheduled')}</option><option value="event">{t('recordings.plan.modeEvent')}</option></select></label>
        <label>{t('recordings.plan.priority')}<input type="number" min="0" max="10000" value={plan.priority} disabled={disabled} onChange={(event) => patch(index, { priority: Number(event.target.value) })}/></label>
        <label>{t('recordings.plan.quality')}<select value={plan.quality || 'balanced'} disabled={disabled} onChange={(event) => patch(index, { quality: event.target.value })}><option value="high">{t('live.qualityHigh')}</option><option value="balanced">{t('live.qualityBalanced')}</option><option value="low">{t('live.qualityLow')}</option></select></label>
        <label>{t('recordings.plan.timezone')}<input value={plan.timezone || 'Europe/Berlin'} disabled={disabled} onChange={(event) => patch(index, { timezone: event.target.value })}/></label>
      </div>
      {plan.mode !== 'continuous' && <>
        <div className="weekday-picker">{weekdayValues.map((value) => <label key={value}><input type="checkbox" disabled={disabled} checked={(plan.weekdays || []).includes(value)} onChange={(event) => patch(index, { weekdays: event.target.checked ? [...new Set([...(plan.weekdays || []), value])] : (plan.weekdays || []).filter((day) => day !== value) })}/><span>{weekdayLabel(locale, value)}</span></label>)}</div>
        <div className="planner-grid"><label>{t('recordings.plan.from')}<input type="time" value={plan.startTime || '00:00'} disabled={disabled} onChange={(event) => patch(index, { startTime: event.target.value })}/></label><label>{t('recordings.plan.to')}<input type="time" value={plan.endTime || '23:59'} disabled={disabled} onChange={(event) => patch(index, { endTime: event.target.value })}/></label></div>
      </>}
      <details className="advanced-plan"><summary>{t('recordings.plan.calendar')}</summary><div className="planner-grid">
        <label>{t('recordings.plan.validFrom')}<input type="date" value={plan.validFrom || ''} disabled={disabled} onChange={(event) => patch(index, { validFrom: event.target.value || null })}/></label>
        <label>{t('recordings.plan.validUntil')}<input type="date" value={plan.validUntil || ''} disabled={disabled} onChange={(event) => patch(index, { validUntil: event.target.value || null })}/></label>
        <label>{t('recordings.plan.includeDates')}<input value={dateList(plan.includeDates)} disabled={disabled} placeholder="2026-12-24, 2026-12-31" onChange={(event) => patch(index, { includeDates: parseDateList(event.target.value) })}/></label>
        <label>{t('recordings.plan.exceptions')}<input value={dateList(plan.excludeDates)} disabled={disabled} placeholder="2026-08-15" onChange={(event) => patch(index, { excludeDates: parseDateList(event.target.value) })}/></label>
        <label>{t('recordings.plan.holidayRule')}<select value={plan.holidayPolicy || 'include'} disabled={disabled} onChange={(event) => patch(index, { holidayPolicy: event.target.value })}><option value="include">{t('recordings.plan.holidayNormal')}</option><option value="exclude">{t('recordings.plan.holidayExclude')}</option><option value="only">{t('recordings.plan.holidayOnly')}</option></select></label>
        <label>{t('recordings.plan.holidays')}<input value={dateList(plan.holidayDates)} disabled={disabled} placeholder="2026-01-01, 2026-12-25" onChange={(event) => patch(index, { holidayDates: parseDateList(event.target.value) })}/></label>
      </div></details>
      {plan.mode === 'event' && <div className="event-plan-options"><div className="planner-grid"><label>{t('recordings.plan.eventTypes')}<input value={(plan.eventTypes || []).join(', ')} disabled={disabled} placeholder="motion, sensor, analytics" onChange={(event) => patch(index, { eventTypes: event.target.value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean) })}/></label><label>{t('recordings.plan.prebuffer')}<input type="number" min="0" max={prebufferMaxSeconds} value={plan.prebufferSeconds || 0} disabled={disabled} onChange={(event) => patch(index, { prebufferSeconds: Number(event.target.value) })}/></label><label>{t('recordings.plan.postbuffer')}<input type="number" min="0" max="3600" value={plan.postbufferSeconds || 0} disabled={disabled} onChange={(event) => patch(index, { postbufferSeconds: Number(event.target.value) })}/></label></div><small>{t('recordings.plan.motionHelp')}</small></div>}
    </article>)}</div>
    {!plans.length && <div className="empty-mini">{t('recordings.plan.empty')}</div>}
  </section>;
}

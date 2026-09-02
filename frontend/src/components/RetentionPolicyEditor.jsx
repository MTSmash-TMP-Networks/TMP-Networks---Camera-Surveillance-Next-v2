import { Archive, DatabaseZap } from 'lucide-react';
import { useI18n } from '../i18n/index.js';

const GB = 1024 ** 3;
function toGb(bytes) { return Number((Number(bytes || 0) / GB).toFixed(2)); }

export function RetentionPolicyEditor({ policy, onChange, disabled = false, onCleanup, cleanupBusy = false }) {
  const { t } = useI18n();
  if (!policy) return null;
  const patch = (values) => onChange({ ...policy, ...values });
  return <section className="planner-section retention-editor">
    <header><div><Archive/><span><strong>{t('recordings.retention.title')}</strong><small>{t('recordings.retention.description')}</small></span></div><div className="retention-actions"><button className="secondary-button" disabled={cleanupBusy || disabled} onClick={() => onCleanup?.(true)}><DatabaseZap/> {t('recordings.retention.preview')}</button><button className="secondary-button" disabled={cleanupBusy || disabled} onClick={() => onCleanup?.(false)}>{t('recordings.retention.cleanNow')}</button></div></header>
    <label className="switch-row"><input type="checkbox" checked={policy.cleanupEnabled} disabled={disabled} onChange={(event) => patch({ cleanupEnabled: event.target.checked })}/><span>{t('recordings.retention.enabled')}</span></label>
    <div className="planner-grid">
      <label>{t('recordings.retention.blockSeconds')}<input type="number" min="30" max="3600" step="30" value={policy.blockSeconds || 300} disabled={disabled} onChange={(event) => patch({ blockSeconds: Number(event.target.value) })}/><small>{t('recordings.retention.blockHelp')}</small></label>
      <label>{t('recordings.retention.strategy')}<select value={policy.strategy} disabled={disabled} onChange={(event) => patch({ strategy: event.target.value })}><option value="none">{t('recordings.retention.strategyNone')}</option><option value="age">{t('recordings.retention.strategyAge')}</option><option value="quota">{t('recordings.retention.strategyQuota')}</option><option value="hybrid">{t('recordings.retention.strategyHybrid')}</option></select></label>
      <label>{t('recordings.retention.standardDays')}<input type="number" min="0" max="3650" value={policy.maxAgeDays} disabled={disabled} onChange={(event) => patch({ maxAgeDays: Number(event.target.value) })}/></label>
      <label>{t('recordings.retention.eventDays')}<input type="number" min="0" max="3650" value={policy.eventMaxAgeDays} disabled={disabled} onChange={(event) => patch({ eventMaxAgeDays: Number(event.target.value) })}/></label>
      <label>{t('recordings.retention.maxStorage')}<input type="number" min="0" step="0.1" value={toGb(policy.maxStorageBytes)} disabled={disabled} onChange={(event) => patch({ maxStorageBytes: Math.round(Number(event.target.value) * GB) })}/></label>
      <label>{t('recordings.retention.freeStorage')}<input type="number" min="0" step="0.1" value={toGb(policy.minFreeBytes)} disabled={disabled} onChange={(event) => patch({ minFreeBytes: Math.round(Number(event.target.value) * GB) })}/></label>
      <label>{t('recordings.retention.maxCount')}<input type="number" min="0" value={policy.maxRecordings} disabled={disabled} onChange={(event) => patch({ maxRecordings: Number(event.target.value) })}/></label>
    </div>
    <label className="switch-row"><input type="checkbox" checked={policy.protectEventRecordings} disabled={disabled} onChange={(event) => patch({ protectEventRecordings: event.target.checked })}/><span>{t('recordings.retention.protectEvents')}</span></label>
  </section>;
}

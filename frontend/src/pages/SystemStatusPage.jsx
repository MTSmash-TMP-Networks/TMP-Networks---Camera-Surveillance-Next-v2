import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Box, CheckCircle2, CircuitBoard, Cpu, Gauge, HardDrive,
  MemoryStick, Power, RefreshCw, Server, ShieldCheck, Thermometer, TimerReset,
} from 'lucide-react';
import { useDispatch } from 'react-redux';
import { useI18n } from '../i18n/index.js';
import { api } from '../services/api.js';
import { appendMetricSample, formatBitRate, formatBytes, formatDuration, metricSeverity } from '../services/systemStatus.js';
import { waitForSystemRestart } from '../services/systemRestart.js';
import { loadRuntime } from '../features/auth/authSlice.js';

function isFinitePercent(value) {
  const number = Number(value);
  return Number.isFinite(number);
}

function UsageBar({ value, label }) {
  const percent = Math.max(0, Math.min(100, Number(value || 0)));
  const severity = metricSeverity(percent);
  return <div className={`system-usage ${severity}`}>
    <div className="system-usage-head"><span>{label}</span><strong>{percent.toFixed(1)} %</strong></div>
    <div className="system-usage-track" role="progressbar" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </div>
  </div>;
}

function MetricHistory({ values, label, historyLabel }) {
  const points = values.length ? values : [0];
  return <div className="metric-history" aria-label={`${label}, ${historyLabel}`}>
    {points.map((value, index) => <span key={`${index}-${value}`} style={{ height: `${Math.max(4, value)}%` }} title={`${value.toFixed(1)} %`} />)}
  </div>;
}

function MetricCard({ icon: Icon, title, value, subtitle, percent, history, details = [], unavailable = false, usageLabel, historyLabel }) {
  const hasPercent = isFinitePercent(percent);
  const severity = unavailable ? 'unavailable' : (hasPercent ? metricSeverity(percent) : 'normal');
  return <article className={`system-metric-card ${severity}`}>
    <header><span className="system-metric-icon"><Icon /></span><div><small>{title}</small><strong>{value}</strong></div></header>
    <p>{subtitle}</p>
    {!unavailable && hasPercent && <UsageBar value={percent} label={usageLabel} />}
    {!unavailable && history?.length > 0 && <MetricHistory values={history} label={title} historyLabel={historyLabel} />}
    <dl>{details.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
  </article>;
}

function StatusPill({ status, t }) {
  if (status === 'ok') return <span className="system-status-pill ok"><CheckCircle2 /> {t('system.metrics.complete')}</span>;
  return <span className="system-status-pill warning"><AlertTriangle /> {t('system.metrics.limited')}</span>;
}

function translatedOrFallback(t, key, fallback = '') {
  const value = t(key);
  return value === key ? fallback : value;
}

function diagnosticText(item, t) {
  return translatedOrFallback(t, `system.diagnostic.${item?.code}`, item?.message || '');
}

function containerServiceName(service, t) {
  return translatedOrFallback(t, `system.containers.service.${service}`, service || t('system.containers.unknownService'));
}

function containerStateLabel(state, t) {
  return translatedOrFallback(t, `system.containers.state.${state}`, state || t('system.containers.state.unknown'));
}

function ContainerStatusSection({ containers, t, durationUnits, formatDate }) {
  const items = containers?.items || [];
  const state = containers?.status || 'unavailable';
  const unavailable = state === 'unavailable';
  const generated = containers?.generatedAt ? formatDate(containers.generatedAt, { timeStyle: 'medium' }) : '–';
  return <section className="settings-card system-detail-section container-status-section">
    <div className="section-heading container-status-heading">
      <div><h2><Box /> {t('system.containers.title')}</h2><p>{t('system.containers.description')}</p></div>
      <div className={`container-overall-pill ${state}`}>
        {state === 'ok' ? <CheckCircle2 /> : <AlertTriangle />}
        <span>{t(`system.containers.overall.${state}`)}</span>
      </div>
    </div>
    {unavailable ? <div className="container-status-unavailable"><AlertTriangle /><span>{t('system.containers.unavailable')}</span></div> : <>
      <div className="container-summary-strip">
        <span><strong>{containers?.summary?.running || 0}</strong>{t('system.containers.running')}</span>
        <span><strong>{containers?.summary?.total || items.length}</strong>{t('system.containers.total')}</span>
        <span><strong>{containers?.summary?.restarting || 0}</strong>{t('system.containers.restarting')}</span>
        <span><strong>{containers?.summary?.critical || 0}</strong>{t('system.containers.critical')}</span>
        <span className="container-status-updated">{t('system.updated')} {generated}</span>
      </div>
      <div className="container-status-grid">
        {items.map((item) => <article key={item.service || item.id} className={`container-status-card ${item.severity || 'warning'}`}>
          <header>
            <span className="container-service-icon"><Server /></span>
            <div><strong>{containerServiceName(item.service, t)}</strong><small>{item.name || t('system.containers.notCreated')}</small></div>
            <span className={`container-state-pill ${item.status || 'unknown'}`}>{containerStateLabel(item.status, t)}</span>
          </header>
          <p title={item.image || ''}>{item.image || t('system.containers.imageUnavailable')}</p>
          <dl>
            <div><dt>{t('system.containers.uptime')}</dt><dd>{item.uptimeSeconds == null ? '–' : formatDuration(item.uptimeSeconds, durationUnits)}</dd></div>
            <div><dt>{t('system.containers.restarts')}</dt><dd>{item.restartCount ?? 0}</dd></div>
            <div><dt>{t('system.containers.health')}</dt><dd>{item.health ? containerStateLabel(item.health, t) : t('system.containers.noHealthcheck')}</dd></div>
            {!item.running && item.exitCode != null && <div><dt>{t('system.containers.exitCode')}</dt><dd>{item.exitCode}</dd></div>}
            {item.oomKilled && <div><dt>{t('system.containers.memoryTermination')}</dt><dd>{t('common.yes')}</dd></div>}
          </dl>
        </article>)}
      </div>
    </>}
  </section>;
}

function storageValue(storage, t) {
  if (!storage) return t('common.unavailable');
  if (isFinitePercent(storage.usagePercent)) return `${Number(storage.usagePercent).toFixed(1)} %`;
  return formatBytes(storage.usedBytes);
}

function storageSubtitle(storage, t) {
  if (!storage) return t('system.storage.readFailed');
  if (storage.capacityTrusted && storage.totalBytes) return t('system.storage.usedOf', { used: formatBytes(storage.usedBytes), total: formatBytes(storage.totalBytes) });
  return t('system.storage.folderOnly', { label: t('system.storage.recordingFolder') });
}

export function SystemStatusPage() {
  const { t, formatDate } = useI18n();
  const dispatch = useDispatch();
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState({ cpu: [], memory: [], storage: [], network: [], gpu: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartMessage, setRestartMessage] = useState('');
  const [restartError, setRestartError] = useState('');
  const [demoSettings, setDemoSettings] = useState({ enabled: false, allowExports: false });
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [demoSaving, setDemoSaving] = useState(false);
  const [demoMessage, setDemoMessage] = useState('');
  const [demoError, setDemoError] = useState('');
  const timerRef = useRef(null);
  const restartControllerRef = useRef(null);
  const mountedRef = useRef(true);
  const durationUnits = useMemo(() => ({ day: t('unit.dayShort'), hour: t('unit.hourShort'), minute: t('unit.minuteShort') }), [t]);

  const loadDemoMode = useCallback(async () => {
    try {
      const result = await api.demoModeSettings();
      if (!mountedRef.current) return;
      setDemoSettings({ enabled: Boolean(result.settings?.enabled), allowExports: Boolean(result.settings?.allowExports) });
      setDemoLoaded(true);
      setDemoError('');
    } catch (reason) {
      if (!mountedRef.current) return;
      setDemoLoaded(true);
      setDemoError(reason.message || 'Demo mode settings could not be loaded.');
    }
  }, []);

  const load = useCallback(async ({ manual = false } = {}) => {
    if (manual) setRefreshing(true);
    try {
      const result = await api.systemStatus();
      if (!mountedRef.current) return;
      setStatus(result);
      setError('');
      const diskPercent = Number.isFinite(Number(result.storage?.[0]?.usagePercent)) ? result.storage[0].usagePercent : 0;
      const networkPercent = Number.isFinite(Number(result.network?.usagePercent)) ? result.network.usagePercent : (result.network?.relativeActivityPercent || 0);
      const gpuPercent = result.gpu?.devices?.[0]?.utilizationPercent || 0;
      setHistory((current) => ({
        cpu: appendMetricSample(current.cpu, result.cpu?.usagePercent),
        memory: appendMetricSample(current.memory, result.memory?.usagePercent),
        storage: appendMetricSample(current.storage, diskPercent),
        network: appendMetricSample(current.network, networkPercent),
        gpu: appendMetricSample(current.gpu, gpuPercent),
      }));
    } catch (reason) {
      if (mountedRef.current) setError(reason.message || t('system.loadFailed'));
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    loadDemoMode();
    return () => {
      mountedRef.current = false;
      restartControllerRef.current?.abort();
    };
  }, [load, loadDemoMode]);

  useEffect(() => {
    clearInterval(timerRef.current);
    const interval = Math.max(1000, Number(status?.refreshAfterMs || 3000));
    if (restarting) return undefined;
    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, interval);
    return () => clearInterval(timerRef.current);
  }, [load, restarting, status?.refreshAfterMs]);

  const saveDemoMode = useCallback(async () => {
    setDemoSaving(true);
    setDemoMessage('');
    setDemoError('');
    try {
      const result = await api.saveDemoModeSettings({
        enabled: Boolean(demoSettings.enabled),
        allowExports: Boolean(demoSettings.allowExports),
      });
      if (!mountedRef.current) return;
      setDemoSettings({ enabled: Boolean(result.settings?.enabled), allowExports: Boolean(result.settings?.allowExports) });
      setDemoMessage(t('demo.adminSaved'));
      void dispatch(loadRuntime());
    } catch (reason) {
      if (mountedRef.current) setDemoError(reason.message || t('demo.actionBlocked'));
    } finally {
      if (mountedRef.current) setDemoSaving(false);
    }
  }, [demoSettings.allowExports, demoSettings.enabled, dispatch, t]);

  const restartSystem = useCallback(async () => {
    const confirmed = window.confirm(`${t('system.restart.confirmTitle')}\n\n${t('system.restart.confirmBody')}`);
    if (!confirmed) return;

    restartControllerRef.current?.abort();
    const controller = new AbortController();
    restartControllerRef.current = controller;
    const baselineUptime = status?.system?.serviceUptimeSeconds;
    setRestarting(true);
    setRestartError('');
    setRestartMessage(t('system.restart.preparing'));

    try {
      await api.restartSystem();
      if (!mountedRef.current) return;
      setRestartMessage(t('system.restart.reconnecting'));
      await waitForSystemRestart({ fetchStatus: () => api.systemStatus(), baselineUptime, signal: controller.signal });
      if (!mountedRef.current) return;
      setRestartMessage(t('system.restart.reloading'));
      window.setTimeout(() => window.location.reload(), 900);
    } catch (reason) {
      if (reason?.name === 'AbortError' || !mountedRef.current) return;
      setRestartError(reason.message || t('system.restart.failed'));
      setRestartMessage('');
      setRestarting(false);
    }
  }, [status?.system?.serviceUptimeSeconds, t]);

  const primaryGpu = status?.gpu?.devices?.[0] || null;
  const disk = status?.storage?.[0] || null;
  const network = status?.network || null;
  const generated = useMemo(() => status?.generatedAt ? formatDate(status.generatedAt, { timeStyle: 'medium' }) : '–', [formatDate, status?.generatedAt]);
  const gpuSummary = primaryGpu ? (primaryGpu.utilizationPercent == null ? t('system.gpu.detectedLimited') : primaryGpu.name) : t('system.gpu.none');
  const networkSummary = network?.devices?.length
    ? t('system.network.inOut', { inbound: formatBitRate(network.totalRxBytesPerSecond), outbound: formatBitRate(network.totalTxBytesPerSecond) })
    : t('system.network.readFailed');

  if (loading && !status) return <div className="page system-status-page"><div className="loading-panel"><RefreshCw className="spin" /> {t('system.loading')}</div></div>;

  return <div className="page system-status-page">
    <header className="page-header">
      <div><span className="eyebrow">{t('system.eyebrow')}</span><h1>{t('system.title')}</h1><p>{t('system.description')}</p></div>
      <div className="header-actions"><button className="secondary-button" disabled={refreshing || restarting} onClick={() => load({ manual: true })}><RefreshCw className={refreshing ? 'spin' : ''} /> {t('common.refresh')}</button><button className="danger-button system-restart-button" disabled={restarting} onClick={restartSystem}><Power className={restarting ? 'spin' : ''} /> {restarting ? t('system.restart.running') : t('system.restart.action')}</button></div>
    </header>

    {restartMessage && <div className="system-status-alert system-restart-alert"><RefreshCw className="spin" /><div><strong>{t('system.restart.alertTitle')}</strong><span>{restartMessage}</span></div></div>}
    {restartError && <div className="system-status-alert"><AlertTriangle /><div><strong>{t('system.restart.notConfirmed')}</strong><span>{restartError}</span></div></div>}
    {error && !restarting && <div className="system-status-alert"><AlertTriangle /><div><strong>{t('system.refreshFailed')}</strong><span>{error} {t('system.lastValuesRemain')}</span></div></div>}

    <section className={`settings-card demo-admin-card ${demoSettings.enabled ? 'active' : ''}`}>
      <div className="section-heading demo-admin-heading">
        <div><h2><ShieldCheck /> {t('demo.adminTitle')}</h2><p>{t('demo.adminDescription')}</p></div>
        <span className={`demo-admin-state ${demoSettings.enabled ? 'active' : ''}`}>{demoSettings.enabled ? t('demo.badge') : 'OFF'}</span>
      </div>
      <div className="demo-admin-options">
        <label><input type="checkbox" checked={demoSettings.enabled} disabled={!demoLoaded || demoSaving} onChange={(event) => setDemoSettings((current) => ({ ...current, enabled: event.target.checked }))}/><span>{t('demo.adminEnabled')}</span></label>
        <label><input type="checkbox" checked={demoSettings.allowExports} disabled={!demoLoaded || demoSaving || !demoSettings.enabled} onChange={(event) => setDemoSettings((current) => ({ ...current, allowExports: event.target.checked }))}/><span>{t('demo.adminExports')}</span></label>
      </div>
      <div className="demo-admin-warning"><AlertTriangle /><span>{t('demo.adminWarning')}</span></div>
      {demoSettings.enabled && <div className="demo-admin-credentials"><span><strong>{t('common.username')}</strong><code>demo</code></span><span><strong>{t('common.password')}</strong><code>demo</code></span><span><strong>{t('role.viewer')}</strong></span></div>}
      <div className="demo-admin-actions"><button className="primary-button" disabled={!demoLoaded || demoSaving} onClick={saveDemoMode}><ShieldCheck /> {demoSaving ? t('common.loading') : t('demo.adminSave')}</button>{demoMessage && <span className="demo-admin-saved"><CheckCircle2 /> {demoMessage}</span>}</div>
      {demoError && <div className="form-error">{demoError}</div>}
    </section>

    {status && <>
      <section className="system-status-summary settings-card">
        <div><StatusPill status={status.status} t={t} /><span><Server /> {t('system.scope')}: {status.scope === 'host' ? t('system.scopeHost') : t('system.scopeContainer')}</span></div>
        <div><span><TimerReset /> {t('system.uptime')} {formatDuration(status.system?.uptimeSeconds, durationUnits)}</span><span><Activity /> {t('system.updated')} {generated}</span></div>
      </section>

      <ContainerStatusSection containers={status.containers} t={t} durationUnits={durationUnits} formatDate={formatDate} />

      <section className="system-metric-grid">
        <MetricCard icon={Cpu} title="CPU" value={`${Number(status.cpu?.usagePercent || 0).toFixed(1)} %`} subtitle={status.cpu?.model || t('system.cpu.processor')} percent={status.cpu?.usagePercent} history={history.cpu} usageLabel={t('system.usage', { item: 'CPU' })} historyLabel={t('system.history')} details={[
          { label: t('system.cpu.cores'), value: status.cpu?.cores || '–' },
          { label: 'Load 1 / 5 / 15', value: (status.system?.loadAverage || []).map((item) => Number(item).toFixed(2)).join(' / ') || '–' },
          { label: t('system.temperature'), value: status.cpu?.temperatureC == null ? t('common.unavailable') : `${status.cpu.temperatureC.toFixed(1)} °C` },
        ]} />
        <MetricCard icon={MemoryStick} title={t('system.memory.title')} value={`${Number(status.memory?.usagePercent || 0).toFixed(1)} %`} subtitle={t('system.storage.usedOf', { used: formatBytes(status.memory?.usedBytes), total: formatBytes(status.memory?.totalBytes) })} percent={status.memory?.usagePercent} history={history.memory} usageLabel={t('system.usage', { item: t('system.memory.title') })} historyLabel={t('system.history')} details={[
          { label: t('system.memory.available'), value: formatBytes(status.memory?.availableBytes) },
          { label: 'Swap', value: status.memory?.swapTotalBytes ? t('system.storage.usedOf', { used: formatBytes(status.memory.swapUsedBytes), total: formatBytes(status.memory.swapTotalBytes) }) : t('system.memory.swapNotConfigured') },
        ]} />
        <MetricCard icon={HardDrive} title={t('system.storage.title')} value={storageValue(disk, t)} subtitle={storageSubtitle(disk, t)} percent={disk?.usagePercent} history={isFinitePercent(disk?.usagePercent) ? history.storage : []} unavailable={!disk} usageLabel={t('system.usage', { item: t('system.storage.title') })} historyLabel={t('system.history')} details={disk ? [
          { label: t('system.source'), value: disk.capacityTrusted ? (String(disk.source || '').startsWith('host-') ? t('system.storage.hostFilesystem') : t('system.storage.containerMount')) : t('system.storage.folderSize') },
          { label: t('system.storage.free'), value: disk.availableBytes == null ? t('system.storage.notReliable') : formatBytes(disk.availableBytes) },
          { label: t('nav.recordings'), value: formatBytes(disk.recordingsUsedBytes) },
          { label: t('system.storage.dataFolder'), value: formatBytes(disk.applicationDataUsedBytes) },
          ...(disk.virtualTotalBytes ? [{ label: t('system.storage.dockerReported'), value: t('system.storage.usedOf', { used: formatBytes(disk.virtualUsedBytes), total: formatBytes(disk.virtualTotalBytes) }) }] : []),
        ] : []} />
        <MetricCard icon={Activity} title={t('system.network.title')} value={network ? formatBitRate(network.totalBytesPerSecond) : t('common.unavailable')} subtitle={networkSummary} percent={network?.usagePercent} history={history.network} unavailable={!network || network.status === 'unavailable'} usageLabel={t('system.network.linkUsage')} historyLabel={t('system.history')} details={network ? [
          { label: t('system.network.interfaces'), value: network.devices?.length || 0 },
          { label: t('system.network.linkCapacity'), value: network.totalSpeedBitsPerSecond ? formatBitRate(network.totalSpeedBitsPerSecond / 8) : t('common.unavailable') },
          { label: t('system.network.sampleWindow'), value: `${Math.max(1, Math.round((network.sampleIntervalMs || 0) / 1000))} s` },
        ] : []} />
        <MetricCard icon={CircuitBoard} title="GPU" value={primaryGpu?.utilizationPercent == null ? (primaryGpu ? t('system.gpu.detected') : t('common.unavailable')) : `${Number(primaryGpu.utilizationPercent).toFixed(1)} %`} subtitle={gpuSummary} percent={primaryGpu?.utilizationPercent} history={history.gpu} unavailable={!primaryGpu || primaryGpu.utilizationPercent == null} usageLabel={t('system.usage', { item: 'GPU' })} historyLabel={t('system.history')} details={primaryGpu ? [
          { label: t('system.gpu.vendor'), value: primaryGpu.vendor || '–' },
          { label: 'VRAM', value: primaryGpu.memoryTotalBytes ? t('system.storage.usedOf', { used: formatBytes(primaryGpu.memoryUsedBytes), total: formatBytes(primaryGpu.memoryTotalBytes) }) : t('common.unavailable') },
          { label: t('system.temperature'), value: primaryGpu.temperatureC == null ? t('common.unavailable') : `${Number(primaryGpu.temperatureC).toFixed(1)} °C` },
        ] : []} />
      </section>

      {status.cpu?.perCorePercent?.length > 0 && <section className="settings-card system-detail-section">
        <div className="section-heading"><div><h2><Gauge /> {t('system.cpu.coresTitle')}</h2><p>{t('system.cpu.coresDescription')}</p></div></div>
        <div className="cpu-core-grid">{status.cpu.perCorePercent.map((value, index) => <div key={index}><span>CPU {index + 1}</span><strong>{Number(value).toFixed(0)} %</strong><i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i></div>)}</div>
      </section>}

      {network?.devices?.length > 0 && <section className="settings-card system-detail-section">
        <div className="section-heading"><div><h2><Activity /> {t('system.network.interfacesTitle')}</h2><p>{t('system.network.interfacesDescription')}</p></div></div>
        <div className="gpu-device-list network-device-list">{network.devices.map((device) => <article key={device.name}><div><strong>{device.name}</strong><span>{translatedOrFallback(t, `system.network.state.${device.operstate}`, t('system.network.state.unknown'))}{device.speedMbps ? ` · ${device.speedMbps} Mbit/s` : ''}</span></div><div><b>{formatBitRate(device.totalBytesPerSecond)}</b><small>{t('system.network.inOut', { inbound: formatBitRate(device.rxBytesPerSecond), outbound: formatBitRate(device.txBytesPerSecond) })}</small></div></article>)}</div>
      </section>}

      {status.gpu?.devices?.length > 1 && <section className="settings-card system-detail-section">
        <div className="section-heading"><div><h2><CircuitBoard /> {t('system.gpu.additional')}</h2><p>{t('system.gpu.additionalDescription')}</p></div></div>
        <div className="gpu-device-list">{status.gpu.devices.slice(1).map((gpu) => <article key={gpu.id}><div><strong>{gpu.name}</strong><span>{gpu.vendor}</span></div><div><b>{gpu.utilizationPercent == null ? '–' : `${gpu.utilizationPercent.toFixed(1)} %`}</b><small>{gpu.temperatureC == null ? `${t('system.temperature')} –` : `${gpu.temperatureC.toFixed(1)} °C`}</small></div></article>)}</div>
      </section>}

      {(status.gpu?.message || status.diagnostics?.length > 0) && <section className="settings-card system-diagnostics">
        <div className="section-heading"><div><h2><Thermometer /> {t('system.notes.title')}</h2><p>{t('system.notes.description')}</p></div></div>
        {status.gpu?.message && <div><CircuitBoard /><span>{gpuSummary}</span></div>}
        {status.diagnostics?.map((item) => <div key={item.code}><AlertTriangle /><span><strong>{item.code}</strong> {diagnosticText(item, t)}</span></div>)}
      </section>}
    </>}
  </div>;
}

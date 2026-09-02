import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Camera, CheckCircle2, ChevronDown, Globe2, Link2, Network, Radar, Search, ShieldCheck, Video, Wifi } from 'lucide-react';
import { api } from '../services/api.js';
import { codecLabel } from '../utils/codec.js';
import { connectionModeForDiscoveredCamera } from '../utils/cameraSetup.js';
import { cameraUpserted } from '../features/cameras/camerasSlice.js';
import { liveStreamPool } from '../services/liveStreamPool.js';
import { cameraSetupAvailability, isDiscoveryRunning, mergeDiscoveredDevices } from '../services/cameraDiscoveryState.js';
import { useI18n } from '../i18n/index.js';

const defaultForm = {
  name: '', location: '', ip: '', port: 0, username: '', password: '',
  preferredProfile: '', preferredSourceUrl: '', profilePolicy: 'auto', codecPreference: 'auto', sourcePolicy: 'auto',
  connectionMode: 'auto', manufacturer: '', model: '', serialNumber: '', macAddress: '', deviceUid: '', xaddr: '', openPorts: [], discoveryEvidence: '', mediaSources: [],
  streamUrl: '', streamKind: 'auto',
};

function methodLabel(method, t) {
  return ({ onvif: 'ONVIF', sadp: 'Hikvision SADP', ssdp: 'UPnP', 'ip-range': t('addCamera.method.ipScan'), 'host-route-scan': t('addCamera.method.hostVpnScan') })[method] || method;
}
function sourceType(source) { return String(source.kind || 'stream').toUpperCase(); }
function sourceChoiceLabel(source) {
  const type = sourceType(source);
  try {
    const url = new URL(source.url);
    const endpoint = `${url.pathname || '/'}${url.search || ''}`;
    return `${type} · ${endpoint}`;
  } catch { return type; }
}
function deviceKey(device) { return device.deviceUid || device.macAddress || `${device.ip}:${device.port || 0}`; }
function decodeUrlCredential(value) { try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); } }

const DIRECT_STREAM_KINDS = [
  ['auto', 'AUTO'], ['rtsp', 'RTSP / RTSPS'], ['hls', 'HLS / M3U8'], ['mjpeg', 'MJPEG'], ['http', 'HTTP(S)'], ['rtmp', 'RTMP / RTMPS'], ['srt', 'SRT'],
];

function nextCameraNameFromItems(items = []) {
  let max = 0;
  for (const item of items) {
    const match = String(item?.name || '').trim().match(/^(?:CAM|Kamera)-(\d+)$/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > max) max = value;
  }
  return `CAM-${max + 1}`;
}

function isAutomaticCameraName(value) {
  return /^(?:CAM|Kamera)-\d+$/i.test(String(value || '').trim());
}

function scanProgress(job, t) {
  const progress = job?.progress || {};
  const stages = { queued: 'addCamera.scan.queued', broadcast: 'addCamera.scan.broadcast', routes: 'addCamera.scan.routes', ports: 'addCamera.scan.ports', fingerprint: 'addCamera.scan.fingerprint', completed: 'addCamera.scan.completed', failed: 'addCamera.scan.failed' };
  const base = t(stages[progress.stage] || 'addCamera.scan.running');
  return progress.total > 0 ? `${base} ${progress.completed || 0}/${progress.total}` : base;
}

function localizedCodecLabel(profile, t) {
  const label = codecLabel(profile);
  return label === 'Unbekannt' ? t('addCamera.unknownCodec') : label;
}

function codecPreferenceText(value, t) {
  if (value === 'h265') return t('addCamera.preferH265');
  if (value === 'h264') return t('addCamera.preferH264');
  return t('addCamera.automatic');
}

function profileRoleLabel(role, t) {
  return ({ high: t('addCamera.role.high'), balanced: t('addCamera.role.balanced'), low: t('addCamera.role.low') })[role] || role;
}

export function AddCameraPage() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const pollRefs = useRef(new Map());
  const mountedRef = useRef(true);
  const scanStartRef = useRef(false);
  const [step, setStep] = useState(1);
  const [devices, setDevices] = useState([]);
  const [expandedDevices, setExpandedDevices] = useState(() => new Set());
  const [inspection, setInspection] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [manualScanJob, setManualScanJob] = useState(null);
  const [startupScanJob, setStartupScanJob] = useState(null);
  const [scanStartBusy, setScanStartBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanWarning, setScanWarning] = useState('');
  const [scanRange, setScanRange] = useState(() => window.localStorage.getItem('tmp-camera-scan-range') || '192.168.1.0/24');
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [scannerInfo, setScannerInfo] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [defaultCameraName, setDefaultCameraName] = useState('CAM-1');
  const [nameTouched, setNameTouched] = useState(false);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const updateName = (event) => { setNameTouched(true); setForm((current) => ({ ...current, name: event.target.value })); };
  const effectiveCameraName = () => String(form.name || '').trim() || defaultCameraName;
  const manualScanning = isDiscoveryRunning(manualScanJob);
  const startupScanning = isDiscoveryRunning(startupScanJob);
  const isDirectStream = form.connectionMode === 'stream';
  const { setupBusy, manualSearchBusy } = cameraSetupAvailability({ actionBusy, scanStartBusy, manualScanJob });
  const allDevicesExpanded = devices.length > 0 && devices.every((device) => expandedDevices.has(deviceKey(device)));

  function toggleDevice(device) {
    const key = deviceKey(device);
    setExpandedDevices((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAllDevices() {
    setExpandedDevices(() => allDevicesExpanded ? new Set() : new Set(devices.map(deviceKey)));
  }

  const allChoices = useMemo(() => [
    ...(inspection?.profiles || []).map((profile) => ({ type: 'profile', token: profile.token, label: profile.name, detail: `${profile.width || '?'}×${profile.height || '?'} · ${localizedCodecLabel(profile, t)}${profile.hasPtz ? ' · PTZ' : ''}`, profile })),
    ...(inspection?.mediaSources || []).filter((source) => source.enabled !== false).map((source) => ({ type: 'source', token: source.url, label: sourceChoiceLabel(source), detail: `${sourceType(source)} · ${source.url.replace(/:\/\/[^@/]+@/, '://***@')}`, source })),
  ], [inspection, t]);

  function applyJob(job, channel = 'manual') {
    if (!job || !mountedRef.current) return;
    if (channel === 'startup') setStartupScanJob(job);
    else setManualScanJob(job);

    if (job.status === 'completed') {
      setDevices((current) => mergeDiscoveredDevices(current, job.items || []));
      if (channel === 'manual') setScannerInfo(job.diagnostics || null);
      if (channel === 'manual') {
        setScanWarning('');
        if (!(job.items || []).length) {
          setError(job.mode === 'manual-range'
            ? t('addCamera.error.noNewRange')
            : t('addCamera.error.noNewNetworks'));
        } else setError('');
      }
    } else if (job.status === 'failed' && channel === 'manual') {
      setError(t('addCamera.error.searchFailed'));
    }
  }

  function stopPolling(channel) {
    const timer = pollRefs.current.get(channel);
    if (timer) clearTimeout(timer);
    pollRefs.current.delete(channel);
  }

  function stopAllPolling() {
    for (const timer of pollRefs.current.values()) clearTimeout(timer);
    pollRefs.current.clear();
  }

  async function pollJob(id, channel = 'manual') {
    stopPolling(channel);
    try {
      const job = await api.discoveryJob(id);
      applyJob(job, channel);
      if (job.status === 'running' && mountedRef.current) {
        pollRefs.current.set(channel, setTimeout(() => pollJob(id, channel), 800));
      }
    } catch {
      // A temporary browser/proxy interruption must never cancel the backend job.
      if (!mountedRef.current) return;
      if (channel === 'manual') {
        setScanWarning(t('addCamera.error.statusInterrupted'));
      }
      pollRefs.current.set(channel, setTimeout(() => pollJob(id, channel), 1600));
    }
  }


  useEffect(() => {
    let cancelled = false;
    async function loadDefaultName() {
      try {
        const result = await api.nextCameraName();
        if (cancelled) return;
        const suggested = result?.name || 'CAM-1';
        setDefaultCameraName(suggested);
        setForm((current) => {
          if (nameTouched || (current.name && !isAutomaticCameraName(current.name))) return current;
          return { ...current, name: suggested };
        });
      } catch {
        try {
          const result = await api.cameras();
          if (cancelled) return;
          const suggested = nextCameraNameFromItems(result.items || []);
          setDefaultCameraName(suggested);
          setForm((current) => {
            if (nameTouched || (current.name && !isAutomaticCameraName(current.name))) return current;
            return { ...current, name: suggested };
          });
        } catch { /* Keep the neutral CAM-1 fallback. */ }
      }
    }
    loadDefaultName();
    return () => { cancelled = true; };
  }, [nameTouched]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    api.latestDiscoveryJob('manual').then(({ job }) => {
      if (cancelled || !job) return;
      applyJob(job, 'manual');
      if (job.status === 'running') pollJob(job.id, 'manual');
    }).catch(() => {});

    api.latestDiscoveryJob('startup').then(({ job }) => {
      if (cancelled || !job) return;
      applyJob(job, 'startup');
      if (job.status === 'running') pollJob(job.id, 'startup');
    }).catch(() => {});

    return () => { cancelled = true; mountedRef.current = false; stopAllPolling(); };
  }, []);

  async function discover({ activeScan = false } = {}) {
    if (manualSearchBusy || scanStartRef.current) return;
    scanStartRef.current = true;
    setScanStartBusy(true);
    setError(''); setScanWarning('');
    try {
      const job = await api.startDiscoveryJob({
        includeUnverified,
        activeScan,
        scanRanges: activeScan ? scanRange.split(/[\s,;]+/).filter(Boolean) : [],
        timeoutMs: activeScan ? 9000 : 6500,
      });
      if (startupScanJob?.id === job.id) {
        stopPolling('startup');
        setStartupScanJob(null);
      }
      applyJob(job, 'manual');
      pollJob(job.id, 'manual');
    } catch (e) {
      setError(e.message || t('addCamera.error.startFailed'));
    } finally {
      scanStartRef.current = false;
      setScanStartBusy(false);
    }
  }

  function chooseDevice(device) {
    setForm((current) => ({
      ...current,
      ip: device.ip,
      port: Number(device.port || 0),
      name: nameTouched && current.name ? current.name : defaultCameraName,
      manufacturer: device.manufacturer || '',
      model: device.model || '',
      serialNumber: device.serialNumber || '',
      macAddress: device.macAddress || '',
      deviceUid: device.deviceUid || device.uuid || device.urn || '',
      xaddr: device.xaddr || device.onvifXaddr || '',
      openPorts: device.openPorts || [],
      discoveryEvidence: (device.evidences || [device.evidence]).filter(Boolean).join(' · '),
      connectionMode: connectionModeForDiscoveredCamera(device),
    }));
    setStep(2);
  }

  function chooseDirectStream() {
    setInspection(null);
    setError('');
    setForm((current) => ({
      ...current,
      connectionMode: 'stream', ip: '', port: 0, openPorts: [], manufacturer: '', model: '', discoveryEvidence: '',
      mediaSources: [], preferredProfile: '', preferredSourceUrl: '', sourcePolicy: 'manual-first',
    }));
    setStep(2);
  }

  async function inspect() {
    setActionBusy(true); setError('');
    try {
      let payload;
      if (isDirectStream) {
        const streamUrl = String(form.streamUrl || '').trim();
        let parsed;
        try { parsed = new URL(streamUrl); } catch { setError(t('stream.urlRequired')); return; }
        const embeddedUsername = decodeUrlCredential(parsed.username);
        const embeddedPassword = decodeUrlCredential(parsed.password);
        parsed.username = ''; parsed.password = '';
        const cleanStreamUrl = parsed.toString();
        const directUsername = form.username || embeddedUsername;
        const directPassword = form.password || embeddedPassword;
        if (cleanStreamUrl !== form.streamUrl || directUsername !== form.username || directPassword !== form.password) {
          setForm((current) => ({ ...current, streamUrl: cleanStreamUrl, username: directUsername, password: directPassword }));
        }
        payload = {
          ...form,
          username: directUsername, password: directPassword,
          name: effectiveCameraName(), ip: '', port: 0, connectionMode: 'stream', sourcePolicy: 'manual-first',
          mediaSources: [{ label: effectiveCameraName(), kind: form.streamKind || 'auto', url: cleanStreamUrl, priority: 10, enabled: true, origin: 'manual' }],
        };
      } else {
        payload = { ...form, name: effectiveCameraName(), port: Number(form.port || 0) };
      }
      const result = await api.inspect(payload);
      const firstProfile = result.profiles?.find((profile) => profile.role === 'balanced') || result.profiles?.[0];
      const firstSource = result.mediaSources?.find((source) => source.enabled !== false && source.kind !== 'snapshot') || result.mediaSources?.[0];
      setInspection(result);
      setForm((current) => ({
        ...current,
        name: nameTouched && current.name ? current.name : defaultCameraName,
        manufacturer: result.device?.manufacturer || current.manufacturer,
        model: result.device?.model || current.model,
        serialNumber: result.device?.serialNumber || current.serialNumber,
        macAddress: result.device?.macAddress || current.macAddress,
        deviceUid: result.device?.deviceUid || result.device?.uuid || current.deviceUid,
        xaddr: result.connection?.xaddr || current.xaddr || '',
        connectionMode: result.mode || current.connectionMode,
        streamUrl: result.mode === 'stream' ? (result.mediaSources?.[0]?.url || current.streamUrl) : current.streamUrl,
        streamKind: result.mode === 'stream' ? (result.mediaSources?.[0]?.kind || current.streamKind) : current.streamKind,
        preferredProfile: firstProfile?.token || '',
        preferredSourceUrl: firstSource?.url || '',
        mediaSources: result.mediaSources || [],
        port: Number(result.connection?.port || result.device?.webPort || current.port || 0),
        openPorts: result.connection?.openPorts || current.openPorts || [],
        discoveryEvidence: result.connection?.discoveryEvidence || current.discoveryEvidence,
      }));
      setStep(3);
    } catch (e) { setError(e.message); }
    finally { setActionBusy(false); }
  }

  function selectChoice(choice) {
    if (choice.type === 'profile') setForm((current) => ({ ...current, preferredProfile: choice.token, preferredSourceUrl: '' }));
    else setForm((current) => ({ ...current, preferredProfile: '', preferredSourceUrl: choice.token }));
  }

  async function save() {
    setActionBusy(true); setError('');
    try {
      const payload = isDirectStream ? {
        ...form, name: effectiveCameraName(), ip: '', port: 0, connectionMode: 'stream', sourcePolicy: 'manual-first',
        mediaSources: form.mediaSources?.length ? form.mediaSources : [{ label: effectiveCameraName(), kind: form.streamKind || 'auto', url: form.streamUrl, priority: 10, enabled: true, origin: 'manual' }],
      } : { ...form, name: effectiveCameraName(), port: Number(form.port || 0) };
      const result = await api.addCamera(payload);
      dispatch(cameraUpserted(result.camera));
      // Start the muted stream before route navigation. The same video node and
      // transport session are then attached to Live/Kiosk without rebuilding.
      liveStreamPool.prewarm({
        cameraId: result.camera.id,
        quality: 'balanced',
        profileToken: result.camera.preferredProfile || form.preferredProfile || '',
        viewportWidth: 1280,
      });
      navigate(`/live?camera=${result.camera.id}`);
    } catch (e) { setError(e.message); }
    finally { setActionBusy(false); }
  }

  const selectedChoice = allChoices.find((choice) => choice.type === 'profile' ? choice.token === form.preferredProfile : choice.token === form.preferredSourceUrl);

  return <div className="page wizard-page">
    <header className="page-header"><div><span className="eyebrow">{t('addCamera.eyebrow')}</span><h1>{t('common.addCamera')}</h1><p>{t('addCamera.description')}</p></div></header>
    <div className="wizard-steps">{[[1, t('addCamera.step.search')], [2, t('addCamera.step.connect')], [3, t('addCamera.selectStream')], [4, t('addCamera.step.finish')]].map(([number, label]) => <div key={number} className={step >= number ? 'active' : ''}><span>{step > number ? <CheckCircle2/> : number}</span><small>{label}</small></div>)}</div>
    <section className="wizard-card">
      {step === 1 && <>
        <div className="wizard-title"><Radar/><div><h2>{t('addCamera.find.title')}</h2><p>{t('addCamera.find.description')}</p></div></div>
        <div className="camera-search-modes">
          <article><Wifi/><div><strong>{t('addCamera.autoSearch.title')}</strong><span>{t('addCamera.autoSearch.description')}</span></div><button className="primary-button" onClick={() => discover()} disabled={manualSearchBusy}>{manualScanning || scanStartBusy ? t('addCamera.autoSearch.running') : t('addCamera.autoSearch.action')}</button></article>
          <article><Network/><div><strong>{t('addCamera.rangeSearch.title')}</strong><span>{t('addCamera.rangeSearch.description')}</span></div><div className="range-scan-row"><input value={scanRange} onChange={(event) => { setScanRange(event.target.value); window.localStorage.setItem('tmp-camera-scan-range', event.target.value); }} placeholder={t('addCamera.rangeSearch.placeholder')}/><button className="primary-button" onClick={() => discover({ activeScan: true })} disabled={manualSearchBusy || !scanRange.trim()}><Search/> {t('addCamera.rangeSearch.action')}</button></div></article>
          <article><Link2/><div><strong>{t('stream.addCardTitle')}</strong><span>{t('stream.addCardDescription')}</span></div><button className="primary-button" onClick={chooseDirectStream} disabled={actionBusy}><Link2/> {t('stream.addCardAction')}</button></article>
        </div>
        {startupScanning && startupScanJob?.id !== manualScanJob?.id && <div className="scan-progress startup-scan-progress" role="status"><Radar/><div><strong>{scanProgress(startupScanJob, t)}</strong><span>{t('addCamera.startup.detail')}</span></div></div>}
        {manualScanning && <div className="scan-progress" role="status"><Radar/><div><strong>{scanProgress(manualScanJob, t)}</strong><span>{t('addCamera.manualJob', { id: manualScanJob.id?.slice(0, 8) || '–' })}</span></div></div>}
        {scanWarning && <div className="inline-warning">{scanWarning}</div>}
        {scannerInfo?.ranges?.length > 0 && <div className="detected-service-strip"><Network/><span><strong>{t('addCamera.scannedNetworks')}</strong> {scannerInfo.ranges.join(', ')}</span></div>}
        {Number(scannerInfo?.filteredExisting || 0) > 0 && <div className="detected-service-strip"><CheckCircle2/><span><strong>{t('addCamera.filteredExisting', { count: scannerInfo.filteredExisting })}</strong></span></div>}
        <label className="switch-row"><input type="checkbox" checked={includeUnverified} onChange={(event) => setIncludeUnverified(event.target.checked)}/><span>{t('addCamera.includeUnverified')} <small>{t('addCamera.includeUnverifiedHint')}</small></span></label>
        {devices.length > 0 && <div className="discovery-results-toolbar"><strong>{t('discovery.results', { count: devices.length })}</strong><button type="button" className="ghost-button" onClick={toggleAllDevices}>{allDevicesExpanded ? t('discovery.collapseAll') : t('discovery.expandAll')}</button></div>}
        <div className="device-list network-device-list">{devices.map((device) => {
          const key = deviceKey(device);
          const expanded = expandedDevices.has(key);
          const displayName = device.name || device.model || device.manufacturer || (device.verified || device.likelyCamera ? t('addCamera.networkCamera') : t('addCamera.cameraCandidate'));
          return <article className={`network-device-item ${expanded ? 'expanded' : ''}`} key={key}>
            <button type="button" className="network-device-summary" onClick={() => toggleDevice(device)} aria-expanded={expanded} aria-label={`${expanded ? t('discovery.collapse') : t('discovery.expand')}: ${device.ip}`}>
              <Camera/><span className="network-device-main"><strong>{device.ip}{device.port ? `:${device.port}` : ''}</strong><small>{displayName}</small></span><em className={device.verified || device.likelyCamera ? 'verified-chip' : 'candidate-chip'}>{device.onvifAvailable ? 'ONVIF' : device.verified || device.likelyCamera ? t('addCamera.networkCamera') : t('addCamera.cameraCandidate')}</em><ChevronDown className="network-device-chevron" />
            </button>
            {expanded && <div className="network-device-details">
              <div className="network-device-detail-grid">
                <div><small>{t('discovery.methods')}</small><span className="device-methods">{(device.discoveryMethods || []).length ? (device.discoveryMethods || []).map((method) => <em key={method}>{methodLabel(method, t)}</em>) : <em>–</em>}</span></div>
                <div><small>{t('discovery.services')}</small><strong>{(device.openPorts || []).length ? device.openPorts.join(', ') : '–'}</strong></div>
                {device.xaddr && <div><small>{t('probe.endpoint')}</small><strong className="technical-endpoint">{device.xaddr}</strong></div>}
              </div>
              <button type="button" className="primary-button network-device-use" onClick={() => chooseDevice(device)}><CheckCircle2/> {t('discovery.useCamera')}</button>
            </div>}
          </article>;
        })}</div>
        {!manualScanning && !startupScanning && devices.length === 0 && <p className="discovery-hint">{t('addCamera.vpnHint')}</p>}
        <button className="secondary-button manual-camera-button" onClick={() => setStep(2)}><Camera/> {t('addCamera.manualIpAction')}</button>
      </>}

      {step === 2 && <>{isDirectStream ? <>
        <div className="wizard-title"><Link2/><div><h2>{t('stream.setupTitle')}</h2><p>{t('stream.setupDescription')}</p></div></div>
        <div className="form-grid">
          <label className="source-url">{t('stream.url')}<input value={form.streamUrl} onChange={update('streamUrl')} placeholder="https://example.org/live/index.m3u8" autoComplete="off"/></label>
          <label>{t('stream.kind')}<select value={form.streamKind} onChange={update('streamKind')}>{DIRECT_STREAM_KINDS.map(([value, label]) => <option key={value} value={value}>{value === 'auto' ? t('stream.kindAuto') : label}</option>)}</select></label>
          <label>{t('common.username')}<input value={form.username} onChange={update('username')} autoComplete="off"/></label>
          <label>{t('common.password')}<input type="password" value={form.password} onChange={update('password')} autoComplete="new-password"/></label>
          <label>{t('addCamera.cameraName')}<input value={form.name} onChange={updateName} placeholder={defaultCameraName}/></label>
          <label>{t('addCamera.location')}<input value={form.location} onChange={update('location')}/></label>
        </div>
        <button className="primary-button" onClick={inspect} disabled={setupBusy || !form.streamUrl.trim()}>{actionBusy ? t('stream.inspecting') : t('stream.inspect')}</button>
      </> : <>
        <div className="wizard-title"><ShieldCheck/><div><h2>{t('addCamera.connection.title')}</h2><p>{t('addCamera.connection.description')}</p></div></div>
        <div className="form-grid"><label>{t('addCamera.ipAddress')}<input value={form.ip} onChange={(event) => setForm((current) => ({ ...current, ip: event.target.value, port: 0, xaddr: '', openPorts: [], discoveryEvidence: '' }))} placeholder="192.168.1.155" inputMode="decimal"/></label><label>{t('common.username')}<input value={form.username} onChange={update('username')}/></label><label>{t('common.password')}<input type="password" value={form.password} onChange={update('password')}/></label><label>{t('addCamera.cameraName')}<input value={form.name} onChange={updateName} placeholder={defaultCameraName}/></label><label>{t('addCamera.location')}<input value={form.location} onChange={update('location')}/></label><label>{t('addCamera.connectionType')}<select value={form.connectionMode} onChange={update('connectionMode')}><option value="auto">{t('addCamera.autoDetect')}</option><option value="onvif">{t('addCamera.onvifOnly')}</option><option value="generic">{t('addCamera.genericCamera')}</option></select></label><label>{t('addCamera.manufacturerModel')}<input value={[form.manufacturer, form.model].filter(Boolean).join(' ')} readOnly placeholder={t('addCamera.autoRecognized')}/></label><label>{t('addCamera.serviceDetection')}<input value={form.openPorts?.length ? form.openPorts.join(', ') : t('addCamera.serviceDetectionPending')} readOnly/></label></div>
        {!!form.openPorts?.length && <div className="detected-service-strip"><Globe2/><span><strong>{t('addCamera.detectedServices')}</strong> {form.openPorts.join(', ')}</span></div>}
        <div className={`onvif-ptz-probe-status ${actionBusy ? 'probing' : 'pending'}`} role="status">
          <Radar/><div><strong>{actionBusy ? t('probe.runningTitle') : t('probe.pendingTitle')}</strong><span>{actionBusy ? t('probe.runningDetail', { ports: form.openPorts?.length ? form.openPorts.join(', ') : t('probe.autoPorts') }) : t('probe.pendingDetail')}</span>{form.xaddr && <small>{t('probe.endpoint')}: <code>{form.xaddr}</code></small>}</div>
        </div>
        <button className="primary-button" onClick={inspect} disabled={setupBusy || !form.ip}>{actionBusy ? t('probe.runningButton') : t('addCamera.inspectAction')}</button>
      </>}</>}


      {step === 3 && <><div className="wizard-title"><Video/><div><h2>{inspection?.mode === 'stream' ? t('stream.verifiedTitle') : t('addCamera.selectStream')}</h2><p>{inspection?.mode === 'stream' ? t('stream.verifiedDescription') : inspection?.mode === 'onvif' ? t('addCamera.onvifProfilesLoaded') : t('addCamera.genericProfilesConfigured')}</p></div></div>
        <div className="inspection-driver"><strong>{inspection?.device?.manufacturer || form.manufacturer || t('addCamera.networkCamera')} {inspection?.device?.model || form.model || ''}</strong><span>{inspection?.mode === 'stream' ? t('stream.driver') : inspection?.mode === 'onvif' ? t('addCamera.onvifDriver') : inspection?.capabilities?.driver || t('addCamera.genericDriver')}</span></div>
        {!isDirectStream && inspection?.diagnostics && <div className="onvif-ptz-result">
          <div className={inspection.diagnostics.onvif?.detected ? 'probe-result success' : inspection.diagnostics.onvif?.searched ? 'probe-result failed' : 'probe-result neutral'}><ShieldCheck/><span><small>{t('probe.onvif')}</small><strong>{inspection.diagnostics.onvif?.detected ? t('probe.found') : inspection.diagnostics.onvif?.searched ? t('probe.notFound') : t('probe.notChecked')}</strong>{inspection.diagnostics.onvif?.endpoint && <em>{inspection.diagnostics.onvif.endpoint}</em>}</span></div>
          <div className={inspection.diagnostics.ptz?.detected ? 'probe-result success' : 'probe-result neutral'}><Camera/><span><small>{t('probe.ptz')}</small><strong>{inspection.diagnostics.ptz?.detected ? t('probe.ptzFound') : inspection.diagnostics.ptz?.searched ? t('probe.ptzNotFound') : t('probe.notChecked')}</strong>{inspection.diagnostics.ptz?.serviceUrl && <em>{inspection.diagnostics.ptz.serviceUrl}</em>}</span></div>
          {!!inspection.diagnostics.onvif?.attempts?.length && <div className="probe-attempts"><small>{t('probe.attempted')}</small><span>{inspection.diagnostics.onvif.attempts.map((attempt) => `${attempt.port}${attempt.ok ? ' ✓' : ' ×'}`).join(' · ')}</span></div>}
        </div>}
        <div className="form-grid codec-preference-grid"><label>{t('addCamera.codecPreference')}<select value={form.codecPreference} onChange={update('codecPreference')}><option value="auto">{t('addCamera.automatic')}</option><option value="h264">{t('addCamera.preferH264')}</option><option value="h265">{t('addCamera.preferH265')}</option></select></label><label>{t('addCamera.sourceStrategy')}<select value={form.sourcePolicy} onChange={update('sourcePolicy')}><option value="auto">{t('addCamera.automatic')}</option><option value="stable">{t('addCamera.sourceStable')}</option><option value="low-latency">{t('addCamera.sourceLowLatency')}</option><option value="manual-first">{t('addCamera.sourceManualFirst')}</option></select></label></div>
        <div className="profile-select">{allChoices.map((choice) => {
          const selected = choice.type === 'profile' ? form.preferredProfile === choice.token : form.preferredSourceUrl === choice.token;
          return <label key={`${choice.type}:${choice.token}`} className={selected ? 'selected' : ''}><input type="radio" name="stream-choice" checked={selected} onChange={() => selectChoice(choice)}/><span><strong>{choice.label}</strong><small>{choice.detail}</small></span><em>{choice.type === 'profile' ? profileRoleLabel(choice.profile.role, t) : sourceType(choice.source)}</em></label>;
        })}</div>
        {!allChoices.length && <div className="inline-warning">{t('addCamera.noStream')}</div>}
        <button className="primary-button" onClick={() => setStep(4)} disabled={!selectedChoice}>{t('addCamera.applySettings')}</button>
      </>}

      {step === 4 && <><div className="wizard-title"><CheckCircle2/><div><h2>{t('addCamera.readyTitle')}</h2><p>{t('addCamera.readyDescription', { name: effectiveCameraName() })}</p></div></div><dl className="summary"><div><dt>{isDirectStream ? t('stream.summaryAddress') : t('addCamera.address')}</dt><dd>{isDirectStream ? form.streamUrl : form.ip}</dd></div>{!isDirectStream && <div><dt>{t('addCamera.detectedServices')}</dt><dd>{form.openPorts?.length ? form.openPorts.join(', ') : t('addCamera.automatic')}</dd></div>}<div><dt>{t('addCamera.device')}</dt><dd>{isDirectStream ? t('stream.driver') : ([form.manufacturer, form.model].filter(Boolean).join(' ') || t('addCamera.genericCamera'))}</dd></div><div><dt>{t('addCamera.location')}</dt><dd>{form.location || t('addCamera.notSpecified')}</dd></div><div><dt>{t('addCamera.selectStream')}</dt><dd>{selectedChoice?.label}</dd></div><div><dt>{t('addCamera.codecPreference')}</dt><dd>{codecPreferenceText(form.codecPreference, t)}</dd></div><div><dt>{t('addCamera.driver')}</dt><dd>{inspection?.mode === 'stream' ? t('stream.driver') : inspection?.mode === 'onvif' ? 'ONVIF' : inspection?.capabilities?.driver || t('addCamera.vendorProfile')}</dd></div>{!isDirectStream && <div><dt>ONVIF / PTZ</dt><dd>{inspection?.diagnostics?.onvif?.detected ? `ONVIF ✓ · ${inspection?.diagnostics?.ptz?.detected ? 'PTZ ✓' : 'PTZ –'}` : inspection?.diagnostics?.onvif?.searched ? t('addCamera.onvifNotConfirmed') : t('addCamera.onvifNotChecked')}</dd></div>}</dl><button className="primary-button" onClick={save} disabled={setupBusy}>{actionBusy ? t('addCamera.saving') : t('common.addCamera')}</button></>}
      {error && <div className="form-error">{error}</div>}
    </section>
  </div>;
}

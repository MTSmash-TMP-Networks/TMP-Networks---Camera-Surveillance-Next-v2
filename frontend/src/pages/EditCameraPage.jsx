import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, CircleCheck, CircleX, Database, FlaskConical, Globe2, Link2, Network, Plus, Radar, RefreshCw, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { api } from '../services/api.js';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { codecFamily, codecLabel } from '../utils/codec.js';
import { useI18n } from '../i18n/index.js';
import { MotionZoneEditor } from '../components/MotionZoneEditor.jsx';

const SOURCE_KINDS = [
  ['auto', 'Automatisch erkennen'],
  ['rtsp', 'RTSP / RTSPS'],
  ['hls', 'HLS / M3U8'],
  ['mjpeg', 'MJPEG'],
  ['http', 'HTTP(S)-Videostream'],
  ['rtmp', 'RTMP / RTMPS'],
  ['srt', 'SRT'],
  ['snapshot', 'JPEG-Snapshot'],
];

function emptySource(index = 0) {
  return { label: `Alternative Quelle ${index + 1}`, kind: 'auto', url: '', priority: (index + 1) * 10, enabled: true, origin: 'manual' };
}

export function EditCameraPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [error, setError] = useState('');
  const [sourceResults, setSourceResults] = useState(new Map());
  const [serviceResults, setServiceResults] = useState([]);
  const [sourceNotice, setSourceNotice] = useState('');
  const [catalogMatches, setCatalogMatches] = useState([]);
  const [deviceFingerprint, setDeviceFingerprint] = useState(null);
  const [synologyCompatibility, setSynologyCompatibility] = useState(null);
  const [discoveryDiagnostics, setDiscoveryDiagnostics] = useState(null);
  const [confirmedPaths, setConfirmedPaths] = useState([]);
  const [webFingerprint, setWebFingerprint] = useState(null);
  const [onlineCatalogs, setOnlineCatalogs] = useState(true);
  const [aggressiveSearch, setAggressiveSearch] = useState(false);

  useEffect(() => {
    api.camera(id).then((result) => {
      setDetails(result);
      setForm({
        name: result.camera.name || '', location: result.camera.location || '',
        ip: result.camera.onvif.ip || '', port: result.camera.onvif.port || 80,
        username: '', password: '', preferredProfile: result.camera.preferredProfile || '',
        profilePolicy: result.camera.profilePolicy || 'auto', codecPreference: result.camera.codecPreference || 'auto',
        sourcePolicy: result.camera.sourcePolicy || 'auto', mediaSources: result.mediaSources || [],
        rotation: result.camera.rotation || 0, enabled: result.camera.enabled, motionZone: result.camera.motionZone || null,
      });
    }).catch((e) => setError(e.message));
  }, [id]);

  const sourcePayload = useMemo(() => (form?.mediaSources || [])
    .filter((source) => source.url.trim())
    .map((source, index) => ({ ...source, priority: Number(source.priority || (index + 1) * 10) })), [form?.mediaSources]);

  if (user?.role !== 'admin') return <div className="empty-panel"><Camera/><h2>Keine Berechtigung</h2></div>;
  if (!form) return <div className="loading-panel">Kameraeinstellungen werden geladen …</div>;
  const directStream = details?.camera?.connectionType === 'stream';
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  function updateSource(index, key, value) {
    setForm((current) => ({
      ...current,
      mediaSources: current.mediaSources.map((source, sourceIndex) => sourceIndex === index ? { ...source, [key]: value } : source),
    }));
  }

  function addSource() {
    setForm((current) => ({ ...current, mediaSources: [...current.mediaSources, emptySource(current.mediaSources.length)] }));
  }

  function removeSource(index) {
    setForm((current) => ({ ...current, mediaSources: current.mediaSources.filter((_, sourceIndex) => sourceIndex !== index) }));
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const patch = {
        name: form.name, location: form.location,
        preferredProfile: form.preferredProfile || null, profilePolicy: form.profilePolicy, codecPreference: form.codecPreference,
        sourcePolicy: form.sourcePolicy, mediaSources: sourcePayload,
        rotation: Number(form.rotation), enabled: Boolean(form.enabled), motionZone: form.motionZone || null,
      };
      if (form.ip !== details.camera.onvif.ip) patch.ip = form.ip;
      if (Number(form.port) !== Number(details.camera.onvif.port)) patch.port = Number(form.port);
      if (form.username) patch.username = form.username;
      if (form.password) patch.password = form.password;
      await api.updateCamera(id, patch);
      await dispatch(loadCameras());
      navigate(`/live?camera=${id}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function refreshProfiles() {
    setBusy(true); setError('');
    try {
      const result = await api.refreshProfiles(id);
      setDetails((current) => ({ ...current, profiles: result.items }));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function discoverSources() {
    setSourceBusy(true); setError(''); setSourceNotice('');
    try {
      const result = await api.discoverMediaSources(id, { onlineCatalogs, aggressive: aggressiveSearch });
      const services = result.services || [];
      setServiceResults(services);
      setCatalogMatches(result.catalogMatches || []);
      setDeviceFingerprint(result.device || null);
      setSynologyCompatibility(result.synologyCompatibility || null);
      setDiscoveryDiagnostics(result.diagnostics || null);
      setConfirmedPaths(result.confirmedPaths || []);
      setWebFingerprint(result.webFingerprint || null);
      const existing = new Set(form.mediaSources.map((source) => source.url));
      const usable = (result.items || []).filter((source) => !existing.has(source.url));
      usable.forEach((source) => existing.add(source.url));
      const pathOnly = (result.confirmedPaths || []).filter((source) => !existing.has(source.url));
      const added = [...usable, ...pathOnly];
      setForm((current) => ({ ...current, mediaSources: [...current.mediaSources, ...added] }));
      if (!usable.length) {
        const reachable = services.filter((service) => service.reachable);
        setSourceNotice(reachable.length
          ? `${reachable.map((service) => `${service.label}:${service.port}`).join(', ')} erreichbar. ${result.diagnostics?.attempted || 0} Pfade wurden mit RTSP-DESCRIBE beziehungsweise Medienprüfung getestet. ${result.confirmedPaths?.length ? `${result.confirmedPaths.length} RTSP-Pfad/Pfade wurden bestätigt, benötigen aber noch eine kompatible FFmpeg-Ausgabe.` : 'Noch kein Videostream wurde bestätigt.'}`
          : 'Auf den geprüften Standardports wurde kein erreichbarer Mediendienst gefunden.');
      } else {
        setSourceNotice(`${usable.length} nutzbare Medienquelle${usable.length === 1 ? '' : 'n'} wurde${usable.length === 1 ? '' : 'n'} ergänzt.${pathOnly.length ? ` Zusätzlich wurden ${pathOnly.length} RTSP-Pfade protokollseitig bestätigt und deaktiviert eingetragen.` : ''}`);
      }
    } catch (e) { setError(e.message); }
    finally { setSourceBusy(false); }
  }

  async function testSources() {
    setSourceBusy(true); setError('');
    try {
      await api.updateCamera(id, { sourcePolicy: form.sourcePolicy, mediaSources: sourcePayload });
      const result = await api.testMediaSources(id);
      setSourceResults(new Map(result.items.map((item) => [String(item.id), item])));
      const refreshed = await api.camera(id);
      setDetails(refreshed);
      setForm((current) => ({ ...current, mediaSources: refreshed.mediaSources || [] }));
    } catch (e) { setError(e.message); }
    finally { setSourceBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Kamera „${form.name}“ wirklich entfernen? Aufnahmen bleiben als Dateien im Datenordner erhalten, werden aber aus der Verwaltung gelöscht.`)) return;
    setBusy(true);
    try { await api.deleteCamera(id); await dispatch(loadCameras()); navigate('/'); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  return <div className="page settings-page">
    <header className="page-header"><div><span className="eyebrow">KAMERA-KONFIGURATION</span><h1>{form.name || 'Kamera bearbeiten'}</h1><p>{directStream ? t('stream.editDescription') : 'Name, Standort, ONVIF-Verbindung und sämtliche Medienquellen verwalten.'}</p></div><div className="header-actions"><button className="secondary-button" onClick={() => navigate(-1)}><ArrowLeft/> Zurück</button><button className="primary-button" onClick={save} disabled={busy}><Save/> {busy ? 'Speichern …' : 'Speichern'}</button></div></header>
    <section className="settings-card">
      <div className="settings-section"><h2>Allgemein</h2><div className="form-grid"><label>Kameraname<input value={form.name} onChange={update('name')}/></label><label>Standort<input value={form.location} onChange={update('location')} placeholder="z. B. Eingang, Lager oder Kasse 1"/></label><label>Bildrotation<select value={form.rotation} onChange={update('rotation')}><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><label className="switch-row settings-switch"><input type="checkbox" checked={form.enabled} onChange={update('enabled')}/><span>Kamera aktiv</span></label></div></div>
      {directStream ? <div className="settings-section"><div className="section-heading"><div><h2><Link2/> {t('stream.editTitle')}</h2><p>{t('stream.editDescription')}</p></div></div><div className="form-grid"><label>{t('common.username')}<input value={form.username} onChange={update('username')} autoComplete="off" placeholder="—"/></label><label>{t('common.password')}<input type="password" value={form.password} onChange={update('password')} autoComplete="new-password" placeholder="—"/></label></div></div> : <div className="settings-section"><h2>ONVIF-Verbindung</h2><p>Benutzername und Kennwort leer lassen, um die gespeicherten Zugangsdaten beizubehalten.</p><div className="form-grid"><label>IP-Adresse<input value={form.ip} onChange={update('ip')}/></label><label>ONVIF-Port<input type="number" value={form.port} onChange={update('port')}/></label><label>Neuer Benutzername<input value={form.username} onChange={update('username')} autoComplete="off"/></label><label>Neues Kennwort<input type="password" value={form.password} onChange={update('password')} autoComplete="new-password"/></label></div></div>}
      {!directStream && <><div className="settings-section"><div className="section-heading"><div><h2>ONVIF-Streamprofile und Codec</h2><p>H.264 wird direkt durchgereicht. H.265/HEVC wird automatisch für WebRTC und HLS nach H.264 transkodiert.</p></div><button className="secondary-button" onClick={refreshProfiles} disabled={busy}><RefreshCw/> Profile neu einlesen</button></div><div className="form-grid"><label>Bevorzugtes Profil<select value={form.preferredProfile} onChange={update('preferredProfile')}><option value="">Automatisch</option>{details?.profiles?.map((profile) => <option key={profile.token} value={profile.token}>{profile.name} · {profile.width || '?'}×{profile.height || '?'} · {codecLabel(profile)}</option>)}</select></label><label>Codec-Präferenz<select value={form.codecPreference} onChange={update('codecPreference')}><option value="auto">Automatisch (H.264 bevorzugt)</option><option value="h264">H.264 / AVC bevorzugen</option><option value="h265">H.265 / HEVC bevorzugen</option></select></label><label>Qualitätsrichtlinie<select value={form.profilePolicy} onChange={update('profilePolicy')}><option value="auto">Automatisch</option><option value="high">Hohe Qualität</option><option value="balanced">Ausgeglichen</option><option value="low">Geringe Bandbreite</option></select></label></div>{form.codecPreference === 'h265' && !details?.profiles?.some((profile) => codecFamily(`${profile.videoCodec || ''} ${profile.videoProfile || ''} ${profile.name || ''}`) === 'h265') && <div className="inline-warning">Die Kamera meldet aktuell kein H.265-Profil. Bitte die Profile neu einlesen oder den Encoder in der Kamera auf H.265 umstellen.</div>}</div></>}

      <div className="settings-section motion-zone-section">
        <div className="section-heading"><div><h2>Bewegungserkennung · Bereich</h2><p>Lege pro Kamera fest, welcher Bildbereich für Motion ausgewertet wird. Ohne Begrenzung bleibt das bisherige Verhalten mit dem gesamten Bild erhalten.</p></div></div>
        <MotionZoneEditor cameraId={id} value={form.motionZone} onChange={(motionZone) => setForm((current) => ({ ...current, motionZone }))} disabled={busy}/>
      </div>

      <div className="settings-section media-source-section">
        <div className="section-heading"><div><h2>{directStream ? t('stream.editTitle') : 'Intelligente Medienquellen-Suche und Alternative Medienquellen'}</h2><p>{directStream ? t('stream.verifiedDescription') : 'Die Kamera wird über ONVIF identifiziert. Danach werden von der Kamera gemeldete URLs, der lokale Hersteller-/Modellkatalog, optionale Community-Daten und erst zuletzt generische Pfade geprüft. Ein Snapshot-Fallback wird serverseitig durch FFmpeg als ruhiger H.264-Videostream ausgegeben.'}</p></div><div className="section-actions">{!directStream && <button className="secondary-button" onClick={discoverSources} disabled={sourceBusy}><Radar/> {sourceBusy ? 'Pfadsuche läuft …' : 'Intelligente Pfadsuche'}</button>}<button className="secondary-button" onClick={testSources} disabled={sourceBusy}><FlaskConical/> Speichern und prüfen</button></div></div>
        <div className="form-grid"><label>Quellenstrategie<select value={form.sourcePolicy} onChange={update('sourcePolicy')}><option value="auto">Automatisch: RTSP-TCP, HLS, HTTP, MJPEG</option><option value="stable">Stabil/VPN: HLS und HTTP bevorzugen</option><option value="low-latency">Niedrige Latenz: RTSP, SRT und RTMP bevorzugen</option><option value="manual-first">Manuelle Quellen immer zuerst</option></select></label></div>
        {!directStream && <>
        <div className="catalog-options">
          <label className="switch-row"><input type="checkbox" checked={onlineCatalogs} onChange={(event) => setOnlineCatalogs(event.target.checked)}/><span><strong>Online-Community-Katalog einbeziehen</strong><small>Überträgt nur den von ONVIF gemeldeten Hersteller an Agent DVR/iSpy. Keine IP-Adresse und keine Zugangsdaten.</small></span></label>
          <label className="switch-row"><input type="checkbox" checked={aggressiveSearch} onChange={(event) => setAggressiveSearch(event.target.checked)}/><span><strong>Aggressive OEM-Suche</strong><small>Prüft zusätzliche generische Firmware- und NVR-Pfade. Kann über VPN länger dauern.</small></span></label>
        </div>
        {deviceFingerprint && <div className="camera-fingerprint"><ShieldCheck/><div><strong>{deviceFingerprint.displayName}</strong><span>{[deviceFingerprint.firmwareVersion && `Firmware ${deviceFingerprint.firmwareVersion}`, deviceFingerprint.hardwareId && `Hardware ${deviceFingerprint.hardwareId}`, webFingerprint?.title && `Weboberfläche: ${webFingerprint.title}`, webFingerprint?.server && `Server: ${webFingerprint.server}`].filter(Boolean).join(' · ') || 'ONVIF-Geräteinformation erkannt'}</span></div></div>}
        {catalogMatches.length > 0 && <div className="catalog-match-grid">
          {catalogMatches.map((match) => <div className="catalog-match" key={`${match.provider}-${match.id}`}><Database/><div><strong>{match.title}</strong><span>{match.provider} · {match.matchedBy} · {match.candidateCount} Kandidaten</span><em>{match.confidence}% Zuordnung</em></div></div>)}
        </div>}
        {synologyCompatibility && <div className={`synology-hint ${synologyCompatibility.supported === true ? 'synology-supported' : ''}`}><Globe2/><div><strong>Synology-Kompatibilitätscenter</strong><span>{synologyCompatibility.supported === true ? 'Das Modell wurde in der öffentlichen Kompatibilitätsseite erkannt.' : synologyCompatibility.supported === false ? 'Das Modell wurde nicht eindeutig erkannt.' : 'Die öffentliche Liste ist als Referenz hinterlegt.'} Die Liste liefert Funktionsdaten, aber keine direkten RTSP-Pfade.</span></div></div>}
        {discoveryDiagnostics && <div className="discovery-summary"><strong>{discoveryDiagnostics.successful} vollständig nutzbare Quelle(n) · {discoveryDiagnostics.confirmedRtspPaths || 0} zusätzliche RTSP-Pfade bestätigt</strong><span>{discoveryDiagnostics.attempted} von {discoveryDiagnostics.candidateCount} Kandidaten geprüft · offene Ports: {discoveryDiagnostics.openPorts?.join(', ') || 'keine'}</span>{discoveryDiagnostics.rtspStatusCounts && <small>RTSP-Antworten: {Object.entries(discoveryDiagnostics.rtspStatusCounts).map(([status, count]) => `${status}: ${count}`).join(' · ')}</small>}{discoveryDiagnostics.warnings?.map((warning) => <small key={warning}>{warning}</small>)}</div>}
        {confirmedPaths.length > 0 && <div className="confirmed-paths"><div className="confirmed-paths-title"><CircleCheck/><div><strong>RTSP-Pfad durch Kamera bestätigt</strong><span>Diese URLs lieferten über RTSP-DESCRIBE eine SDP mit Videospur. Sie wurden deaktiviert ergänzt, weil die anschließende FFmpeg-Prüfung noch scheiterte.</span></div></div>{confirmedPaths.map((source) => <div className="confirmed-path-row" key={source.url}><div><strong>{source.label}</strong><code>{source.url}</code><small>{source.lastError}</small></div><button className="text-button" onClick={() => setForm((current) => ({ ...current, mediaSources: current.mediaSources.map((item) => item.url === source.url ? { ...item, enabled: true } : item) }))}>Quelle aktivieren</button></div>)}</div>}
        {discoveryDiagnostics?.recentFailures?.length > 0 && <details className="path-diagnostics"><summary>Geprüfte Pfade und Kameraantworten anzeigen</summary>{discoveryDiagnostics.rtspAuthFailures > 0 && <div className="inline-warning">Die Kamera hat {discoveryDiagnostics.rtspAuthFailures} RTSP-Anmeldeversuche abgelehnt. Nach drei Ablehnungen wurde die weitere RTSP-Suche zum Schutz vor Kontosperren beendet.</div>}<div className="path-diagnostic-list">{discoveryDiagnostics.recentFailures.map((failure, index) => <div className="path-diagnostic-row" key={`${failure.label}-${index}`}><strong>{failure.label}</strong><code>{failure.url ? `${failure.url.scheme}://${failure.url.host}:${failure.url.port}${failure.url.path}` : 'Unbekannter Endpunkt'}</code><span>{failure.error}</span></div>)}</div></details>}
        {serviceResults.length > 0 && <div className="service-results">
          {serviceResults.map((service) => <div className={`service-result service-result-${service.status}`} key={`${service.protocol}-${service.port}`}>
            <Network/><div><strong>{service.label} · Port {service.port}</strong><span>{service.message}</span><small>{service.streamFound ? 'Medienstream vollständig bestätigt' : service.pathConfirmed ? 'RTSP-Pfad und SDP-Videospur bestätigt' : service.reachable ? 'Dienst erreichbar – Stream-Pfad noch unbekannt' : 'Dienst nicht erreichbar'}</small></div>
          </div>)}
        </div>}
        </>}
        {sourceNotice && <div className="inline-notice">{sourceNotice}</div>}
        <div className="source-list">
          {form.mediaSources.map((source, index) => {
            const result = sourceResults.get(String(source.id));
            const status = result || source;
            return <div className="source-row" key={source.id || `new-${index}`}>
              <label>Bezeichnung<input value={source.label} onChange={(event) => updateSource(index, 'label', event.target.value)}/></label>
              <label>Typ<select value={source.kind} onChange={(event) => updateSource(index, 'kind', event.target.value)}>{SOURCE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="source-url">Medien-URL<input value={source.url} onChange={(event) => updateSource(index, 'url', event.target.value)} placeholder={directStream ? 'https://example.org/live/index.m3u8' : `z. B. http://${form.ip}/live.m3u8`}/></label>
              <label>Priorität<input type="number" min="0" max="9999" value={source.priority} onChange={(event) => updateSource(index, 'priority', event.target.value)}/></label>
              <label className="source-enabled"><input type="checkbox" checked={source.enabled !== false} onChange={(event) => updateSource(index, 'enabled', event.target.checked)}/><span>Aktiv</span></label>
              <div className={`source-status source-status-${status.lastStatus || (result?.ok ? 'available' : result ? 'failed' : 'unknown')}`}>{(status.lastStatus === 'available' || result?.ok) ? <CircleCheck/> : (status.lastStatus === 'failed' || result?.ok === false) ? <CircleX/> : <Radar/>}<span>{result?.ok ? `${result.kind} erreichbar` : result?.error || status.lastError || 'Noch nicht geprüft'}</span></div>
              <button className="source-remove" onClick={() => removeSource(index)} title="Quelle entfernen"><X/></button>
            </div>;
          })}
          {!form.mediaSources.length && <div className="source-empty">{directStream ? t('stream.urlRequired') : 'Keine zusätzliche Quelle hinterlegt. Die intelligente Pfadsuche kann ONVIF-, Modellkatalog- und Community-Pfade automatisch ergänzen.'}</div>}
        </div>
        <button className="text-button source-add" onClick={addSource}><Plus/> Quelle manuell hinzufügen</button>
        <p className="source-security-note">{directStream ? t('stream.editDescription') : 'Aus Sicherheitsgründen müssen alternative URLs auf dieselbe Kamera-IP zeigen. Online-Kataloge erhalten niemals IP-Adresse oder Zugangsdaten. Synologys öffentliche Liste wird nur als Kompatibilitätshinweis verwendet; direkte Pfade stammen aus ONVIF, dem lokalen Modellkatalog oder der optionalen Community-Datenbank.'}</p>
      </div>

      {error && <div className="form-error">{error}</div>}
      <div className="danger-zone"><div><strong>Kamera entfernen</strong><span>Entfernt Konfiguration, Profile und Diagnoseeinträge.</span></div><button className="danger-button" onClick={remove} disabled={busy}><Trash2/> Entfernen</button></div>
    </section>
  </div>;
}

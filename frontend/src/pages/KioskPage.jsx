import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Activity, Clock3, Copy, Expand, Grid2X2, LayoutDashboard, Minimize, Plus, Radio,
  RefreshCw, Save, Trash2, Video, WandSparkles, X,
} from 'lucide-react';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { SeamlessLivePlayer } from '../components/SeamlessLivePlayer.jsx';
import { api } from '../services/api.js';
import { buildKioskCameraStatus, summarizeKioskStatus } from '../services/kioskStatus.js';
import { useI18n } from '../i18n/index.js';
import {
  KIOSK_LAYOUT_TEMPLATES,
  applyKioskTemplate,
  autoAssignKioskLayout,
  buildAutomaticKioskLayout,
  createKioskLayout,
  loadActiveKioskLayoutId,
  loadKioskLayouts,
  saveActiveKioskLayoutId,
  saveKioskLayouts,
} from '../services/kioskLayouts.js';

function KioskClock({ locale, t }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const time = now.toLocaleTimeString(locale || 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString(locale || 'en', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

  return <div className="kiosk-clock" aria-label={t('kiosk.clock.aria', { time })}>
    <Clock3/>
    <span><strong>{time}</strong><small>{date}</small></span>
  </div>;
}

const KioskTile = memo(function KioskTile({ camera, refreshEpoch, quality, runtimeStatus, startDelayMs = 0, style, t }) {
  if (!camera) {
    return <article className="kiosk-tile kiosk-tile-empty" style={style}>
      <Grid2X2/>
      <span>{t('kiosk.tile.empty')}</span>
    </article>;
  }
  return <article className="kiosk-tile" style={style}>
    <SeamlessLivePlayer
      camera={camera}
      quality={quality}
      profileToken=""
      transportMode="local-hls"
      compact
      reconnectSignal={refreshEpoch}
      kioskStatus={runtimeStatus}
      connectDelayMs={startDelayMs}
      isolateFailure
    />
  </article>;
});

function LayoutMiniature({ template }) {
  return <span
    className="kiosk-layout-miniature"
    style={{ '--layout-cols': template.columns, '--layout-rows': template.rows }}
    aria-hidden="true"
  >
    {template.slots.map((item) => <i key={item.id} style={{
      gridColumn: `${item.column} / span ${item.columnSpan}`,
      gridRow: `${item.row} / span ${item.rowSpan}`,
    }}/>) }
  </span>;
}

function templateText(t, template, field) {
  return t(`kiosk.template.${template.id}.${field}`);
}

function KioskLayoutEditor({ cameras, layouts, initialLayout, onClose, onSave, onDelete, t }) {
  const [draft, setDraft] = useState(() => initialLayout);

  useEffect(() => { setDraft(initialLayout); }, [initialLayout]);
  if (!draft) return null;

  const isStored = layouts.some((item) => item.id === draft.id);

  function changeTemplate(templateId) {
    setDraft((current) => applyKioskTemplate(current, templateId, cameras));
  }

  function changeCamera(slotId, cameraId) {
    setDraft((current) => ({
      ...current,
      slots: current.slots.map((item) => item.id === slotId ? { ...item, cameraId } : item),
    }));
  }

  function newLayout() {
    const templateId = cameras.length >= 5 ? 'focus-five' : cameras.length >= 4 ? 'quad' : 'single';
    setDraft(createKioskLayout({ templateId, cameras, name: t('kiosk.layout.defaultName', { number: layouts.length + 1 }) }));
  }

  function duplicateLayout() {
    const copy = createKioskLayout({ templateId: draft.templateId, cameras: [], name: t('kiosk.layout.copyName', { name: draft.name }) });
    setDraft({ ...copy, columns: draft.columns, rows: draft.rows, slots: draft.slots.map((item) => ({ ...item })) });
  }

  return <div className="kiosk-layout-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="kiosk-layout-dialog" role="dialog" aria-modal="true" aria-labelledby="kiosk-layout-editor-title">
      <header>
        <div><span className="eyebrow">{t('kiosk.layouts.eyebrow')}</span><h2 id="kiosk-layout-editor-title">{t('kiosk.layouts.title')}</h2><p>{t('kiosk.layouts.subtitle')}</p></div>
        <button className="kiosk-dialog-icon" onClick={onClose} aria-label={t('kiosk.action.close')}><X/></button>
      </header>

      <div className="kiosk-layout-dialog-body">
        <aside className="kiosk-layout-saved-list">
          <div className="kiosk-layout-section-title"><strong>{t('kiosk.saved.title')}</strong><button onClick={newLayout}><Plus/> {t('kiosk.action.new')}</button></div>
          {layouts.length
            ? layouts.map((layout) => <button key={layout.id} className={layout.id === draft.id ? 'active' : ''} onClick={() => setDraft(layout)}>
              <LayoutDashboard/><span><strong>{layout.name}</strong><small>{t('kiosk.saved.meta', { count: layout.slots.filter((item) => item.cameraId).length, columns: layout.columns, rows: layout.rows })}</small></span>
            </button>)
            : <p>{t('kiosk.saved.empty')}</p>}
        </aside>

        <div className="kiosk-layout-editor-main">
          <div className="kiosk-layout-name-row">
            <label>{t('kiosk.layout.name')}<input value={draft.name} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}/></label>
            <button onClick={() => setDraft((current) => autoAssignKioskLayout(current, cameras))}><WandSparkles/> {t('kiosk.action.autoFill')}</button>
          </div>

          <div className="kiosk-layout-template-section">
            <div className="kiosk-layout-section-title"><strong>{t('kiosk.template.title')}</strong><small>{t('kiosk.template.hint')}</small></div>
            <div className="kiosk-layout-template-grid">
              {KIOSK_LAYOUT_TEMPLATES.map((template) => <button key={template.id} className={draft.templateId === template.id ? 'active' : ''} onClick={() => changeTemplate(template.id)}>
                <LayoutMiniature template={template}/>
                <span><strong>{templateText(t, template, 'name')}</strong><small>{templateText(t, template, 'description')}</small></span>
              </button>)}
            </div>
          </div>

          <div className="kiosk-layout-assignment-section">
            <div className="kiosk-layout-section-title"><strong>{t('kiosk.assignment.title')}</strong><small>{t('kiosk.assignment.hint')}</small></div>
            <div className="kiosk-layout-assignment-grid" style={{ '--layout-cols': draft.columns, '--layout-rows': draft.rows }}>
              {draft.slots.map((item, index) => <label key={item.id} style={{
                gridColumn: `${item.column} / span ${item.columnSpan}`,
                gridRow: `${item.row} / span ${item.rowSpan}`,
              }}>
                <span>{t('kiosk.assignment.tile', { number: index + 1 })}{item.columnSpan > 1 || item.rowSpan > 1 ? ` · ${t('kiosk.assignment.focus')}` : ''}</span>
                <select value={item.cameraId} onChange={(event) => changeCamera(item.id, event.target.value)}>
                  <option value="">{t('kiosk.assignment.noCamera')}</option>
                  {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}{camera.location ? ` · ${camera.location}` : ''}</option>)}
                </select>
              </label>)}
            </div>
          </div>
        </div>
      </div>

      <footer>
        <div>
          {isStored && <button className="danger-button" onClick={() => onDelete(draft.id)}><Trash2/> {t('kiosk.action.delete')}</button>}
          <button onClick={duplicateLayout}><Copy/> {t('kiosk.action.duplicate')}</button>
        </div>
        <div><button onClick={onClose}>{t('kiosk.action.cancel')}</button><button className="primary-button" disabled={!draft.name.trim()} onClick={() => onSave({ ...draft, name: draft.name.trim() })}><Save/> {t('kiosk.action.saveShow')}</button></div>
      </footer>
    </section>
  </div>;
}

export function KioskPage() {
  const { t, locale } = useI18n();
  const dispatch = useDispatch();
  const cameraItems = useSelector((state) => state.cameras.items);
  const cameras = useMemo(() => cameraItems.filter((camera) => camera.enabled !== false), [cameraItems]);
  const pageRef = useRef(null);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [streamQuality, setStreamQuality] = useState('low');
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [runtimeStatus, setRuntimeStatus] = useState({});
  const [statusError, setStatusError] = useState('');
  const [layouts, setLayouts] = useState(() => loadKioskLayouts());
  const [activeLayoutId, setActiveLayoutId] = useState(() => loadActiveKioskLayoutId());
  const [editorLayout, setEditorLayout] = useState(null);

  useEffect(() => { if (!cameras.length) dispatch(loadCameras()); }, [dispatch, cameras.length]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRuntimeStatus() {
      try {
        const result = await api.kioskStatus();
        if (cancelled) return;
        setRuntimeStatus(buildKioskCameraStatus({ ...result, cameras }));
        setStatusError('');
      } catch {
        if (!cancelled) setStatusError(t('kiosk.status.unavailable'));
      }
    }
    loadRuntimeStatus();
    const interval = window.setInterval(loadRuntimeStatus, 2500);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [cameras, t]);

  const automaticLayout = useMemo(() => buildAutomaticKioskLayout(cameras), [cameras]);
  const activeLayout = useMemo(() => activeLayoutId === 'auto'
    ? automaticLayout
    : layouts.find((layout) => layout.id === activeLayoutId) || automaticLayout, [activeLayoutId, layouts, automaticLayout]);

  useEffect(() => {
    if (activeLayoutId !== 'auto' && !layouts.some((layout) => layout.id === activeLayoutId)) {
      setActiveLayoutId('auto');
      saveActiveKioskLayoutId('auto');
    }
  }, [activeLayoutId, layouts]);

  const camerasById = useMemo(() => new Map(cameras.map((camera) => [camera.id, camera])), [cameras]);
  const assignedCameraIds = useMemo(() => [...new Set(activeLayout.slots.map((item) => item.cameraId).filter((cameraId) => camerasById.has(cameraId)))], [activeLayout, camerasById]);
  const statusSummary = useMemo(() => summarizeKioskStatus(Object.fromEntries(assignedCameraIds.map((cameraId) => [cameraId, runtimeStatus[cameraId]]).filter(([, value]) => value))), [assignedCameraIds, runtimeStatus]);
  const activeLayoutName = activeLayoutId === 'auto' ? t('kiosk.layout.automatic') : activeLayout.name;

  function selectLayout(layoutId) {
    setActiveLayoutId(layoutId);
    saveActiveKioskLayoutId(layoutId);
  }

  function openLayoutEditor() {
    const existing = activeLayoutId === 'auto' ? null : layouts.find((layout) => layout.id === activeLayoutId);
    setEditorLayout(existing || createKioskLayout({ templateId: cameras.length >= 5 ? 'focus-five' : cameras.length >= 4 ? 'quad' : 'single', cameras, name: t('kiosk.layout.defaultName', { number: layouts.length + 1 }) }));
  }

  function saveLayout(layout) {
    const nextLayouts = layouts.some((item) => item.id === layout.id)
      ? layouts.map((item) => item.id === layout.id ? layout : item)
      : [...layouts, layout];
    const safe = saveKioskLayouts(nextLayouts);
    setLayouts(safe);
    setActiveLayoutId(layout.id);
    saveActiveKioskLayoutId(layout.id);
    setEditorLayout(null);
  }

  function deleteLayout(layoutId) {
    const nextLayouts = saveKioskLayouts(layouts.filter((item) => item.id !== layoutId));
    setLayouts(nextLayouts);
    if (activeLayoutId === layoutId) selectLayout('auto');
    const replacement = nextLayouts[0] || null;
    setEditorLayout(replacement);
    if (!replacement) setEditorLayout(null);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await pageRef.current?.requestFullscreen?.();
  }

  const gridStyle = {
    '--kiosk-layout-columns': activeLayout.columns,
    '--kiosk-layout-rows': activeLayout.rows,
    aspectRatio: `${Math.max(1, activeLayout.columns) * 16} / ${Math.max(1, activeLayout.rows) * 9}`,
  };

  return <div ref={pageRef} className={`kiosk-page ${fullscreen ? 'is-fullscreen' : ''}`}>
    <header className="kiosk-toolbar">
      <div className="kiosk-toolbar-title"><span className="eyebrow">{t('kiosk.mode.eyebrow')}</span><strong>{t('kiosk.toolbar.summary', { assigned: assignedCameraIds.length, total: cameras.length, layout: activeLayoutName })}</strong></div>
      <KioskClock locale={locale} t={t}/>
      <div className="kiosk-runtime-summary" aria-label={t('kiosk.status.aria')}>
        <span className={statusSummary.motionCount ? 'is-motion' : ''}><Activity/>{statusSummary.motionCount} {t('kiosk.status.motion')}</span>
        <span className={statusSummary.recordingCount ? 'is-recording' : ''}><Video/>{statusSummary.recordingCount} {t('kiosk.status.recording')}</span>
        {statusError && <small>{statusError}</small>}
      </div>
      <div className="kiosk-actions">
        <label><Radio/><select value={streamQuality} onChange={(event) => setStreamQuality(event.target.value)}><option value="low">{t('kiosk.quality.low')}</option><option value="auto">{t('kiosk.quality.auto')}</option><option value="balanced">{t('kiosk.quality.balanced')}</option><option value="high">{t('kiosk.quality.high')}</option></select></label>
        <label><Grid2X2/><select value={activeLayoutId} onChange={(event) => selectLayout(event.target.value)}><option value="auto">{t('kiosk.layout.automatic')}</option>{layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label>
        <button onClick={openLayoutEditor}><LayoutDashboard/> {t('kiosk.action.manageGrid')}</button>
        <button onClick={() => setRefreshEpoch((value) => value + 1)}><RefreshCw/> {t('kiosk.action.reconnectAll')}</button>
        <button onClick={toggleFullscreen}>{fullscreen ? <Minimize/> : <Expand/>}{fullscreen ? t('kiosk.action.exitFullscreen') : t('kiosk.action.fullscreen')}</button>
        {!fullscreen && <Link to="/live"><Radio/> {t('kiosk.action.liveView')}</Link>}
      </div>
    </header>
    {cameras.length
      ? <section className="kiosk-grid kiosk-layout-grid" style={gridStyle}>{activeLayout.slots.map((item, index) => {
        const camera = camerasById.get(item.cameraId);
        return <KioskTile
          key={`${item.id}:${camera?.id || 'empty'}`}
          camera={camera}
          refreshEpoch={refreshEpoch}
          quality={streamQuality}
          runtimeStatus={camera ? runtimeStatus[camera.id] : null}
          startDelayMs={camera ? Math.min(index * 900, 4500) : 0}
          style={{ gridColumn: `${item.column} / span ${item.columnSpan}`, gridRow: `${item.row} / span ${item.rowSpan}` }}
          t={t}
        />;
      })}</section>
      : <div className="empty-panel"><Radio/><h2>{t('kiosk.empty.noCameras')}</h2></div>}
    {editorLayout && <KioskLayoutEditor cameras={cameras} layouts={layouts} initialLayout={editorLayout} onClose={() => setEditorLayout(null)} onSave={saveLayout} onDelete={deleteLayout} t={t}/>} 
  </div>;
}

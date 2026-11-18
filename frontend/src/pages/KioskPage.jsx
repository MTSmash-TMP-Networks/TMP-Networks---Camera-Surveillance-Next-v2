import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import {
  Activity, Clock3, Copy, Expand, Grid2X2, LayoutDashboard, Minimize, Plus, Radio,
  RefreshCw, Save, Search, Trash2, Video, WandSparkles, X,
} from 'lucide-react';
import { loadCameras } from '../features/cameras/camerasSlice.js';
import { SeamlessLivePlayer } from '../components/SeamlessLivePlayer.jsx';
import { api } from '../services/api.js';
import { buildKioskCameraStatus, summarizeKioskStatus } from '../services/kioskStatus.js';
import { createKioskThumbnailLoader } from '../services/kioskThumbnailLoader.js';
import { useI18n } from '../i18n/index.js';
import {
  KIOSK_LAYOUT_TEMPLATES,
  applyKioskTemplate,
  assignKioskCamera,
  autoAssignKioskLayout,
  buildAutomaticKioskLayout,
  createKioskLayout,
  loadActiveKioskLayoutId,
  loadKioskLayouts,
  saveActiveKioskLayoutId,
  saveKioskLayouts,
  swapKioskSlotCameras,
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

function KioskThumbnail({ cameraId, thumbnails, requestPreview }) {
  const elementRef = useRef(null);
  useEffect(() => {
    if (!cameraId) return undefined;
    const node = elementRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      requestPreview(cameraId);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        requestPreview(cameraId);
        observer.disconnect();
      }
    }, { rootMargin: '100px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cameraId, requestPreview]);
  const src = thumbnails[cameraId] || '';
  return <span className="kiosk-camera-thumb" ref={elementRef} aria-hidden="true">
    {src ? <img src={src} alt="" loading="lazy" draggable={false}/> : <Video/>}
  </span>;
}

function KioskLayoutEditor({ cameras, layouts, initialLayout, onClose, onSave, onDelete, t }) {
  const [draft, setDraft] = useState(() => initialLayout);
  const [search, setSearch] = useState('');
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [dropTargetId, setDropTargetId] = useState('');
  const [thumbnails, setThumbnails] = useState({});
  const thumbnailLoaderRef = useRef(null);

  useEffect(() => { setDraft(initialLayout); setSelectedCameraId(''); }, [initialLayout]);
  useEffect(() => {
    const loader = createKioskThumbnailLoader({
      load: (cameraId, signal) => api.snapshot(cameraId, '', { signal, timeoutMs: 12_000 }),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
      onUpdate: (cameraId, url) => setThumbnails((current) => ({ ...current, [cameraId]: url })),
      maxConcurrent: 2,
    });
    thumbnailLoaderRef.current = loader;
    return () => {
      thumbnailLoaderRef.current = null;
      loader.dispose();
    };
  }, []);
  const requestPreview = useCallback((id) => thumbnailLoaderRef.current?.request(id), []);
  const cameraById = useMemo(() => new Map(cameras.map((camera) => [String(camera.id), camera])), [cameras]);
  const filteredCameras = useMemo(() => cameras.filter((camera) =>
    `${camera.name || ''} ${camera.location || ''} ${camera.ip || ''}`.toLowerCase().includes(search.trim().toLowerCase())
  ), [cameras, search]);
  if (!draft) return null;

  const isStored = layouts.some((item) => item.id === draft.id);

  function changeTemplate(templateId) {
    setDraft((current) => applyKioskTemplate(current, templateId, cameras));
    setDropTargetId('');
  }

  function changeCamera(slotId, cameraId) {
    setDraft((current) => assignKioskCamera(current, slotId, cameraId));
  }

  function newLayout() {
    const templateId = cameras.length >= 5 ? 'focus-five' : cameras.length >= 4 ? 'quad' : 'single';
    setDraft(createKioskLayout({ templateId, cameras, name: t('kiosk.layout.defaultName', { number: layouts.length + 1 }) }));
    setSelectedCameraId('');
  }

  function duplicateLayout() {
    const copy = createKioskLayout({ templateId: draft.templateId, cameras: [], name: t('kiosk.layout.copyName', { name: draft.name }) });
    setDraft({ ...copy, columns: draft.columns, rows: draft.rows, slots: draft.slots.map((item) => ({ ...item })) });
  }

  function onCameraDragStart(event, cameraId) {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-tmp-camera-id', String(cameraId));
    event.dataTransfer.setData('text/plain', String(cameraId));
    setSelectedCameraId(String(cameraId));
  }

  function onSlotDragStart(event, slotId) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-tmp-slot-id', String(slotId));
  }

  function onDropSlot(event, slotId) {
    event.preventDefault();
    setDropTargetId('');
    const sourceSlotId = event.dataTransfer.getData('application/x-tmp-slot-id');
    if (sourceSlotId) {
      setDraft((current) => swapKioskSlotCameras(current, sourceSlotId, slotId));
      return;
    }
    const cameraId = event.dataTransfer.getData('application/x-tmp-camera-id') || event.dataTransfer.getData('text/plain');
    if (cameraById.has(cameraId)) changeCamera(slotId, cameraId);
  }

  function selectSlot(slotId) {
    if (selectedCameraId && cameraById.has(selectedCameraId)) changeCamera(slotId, selectedCameraId);
  }

  return <div className="kiosk-layout-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="kiosk-layout-dialog kiosk-layout-dialog-visual" role="dialog" aria-modal="true" aria-labelledby="kiosk-layout-editor-title">
      <header>
        <div><span className="eyebrow">{t('kiosk.layouts.eyebrow')}</span><h2 id="kiosk-layout-editor-title">{t('kiosk.layouts.title')}</h2><p>{t('kiosk.layouts.subtitle')}</p></div>
        <button className="kiosk-dialog-icon" onClick={onClose} aria-label={t('kiosk.action.close')}><X/></button>
      </header>
      <div className="kiosk-layout-dialog-body">
        <div className="kiosk-layout-saved-list">
          <div className="kiosk-layout-section-title"><strong>{t('kiosk.saved.title')}</strong><button onClick={newLayout}><Plus/> {t('kiosk.action.new')}</button></div>
          <div className="kiosk-layout-saved-scroll">
            {layouts.length
              ? layouts.map((layout) => <button key={layout.id} className={layout.id === draft.id ? 'active' : ''} onClick={() => { setDraft(layout); setSelectedCameraId(''); }}>
                <LayoutDashboard/><span><strong>{layout.name}</strong><small>{t('kiosk.saved.meta', { count: layout.slots.filter((item) => item.cameraId).length, columns: layout.columns, rows: layout.rows })}</small></span>
              </button>)
              : <p>{t('kiosk.saved.empty')}</p>}
          </div>
        </div>
        <div className="kiosk-layout-editor-workspace">
          <aside className="kiosk-camera-palette" aria-label={t('kiosk.editor.cameraList')}>
            <div className="kiosk-layout-section-title"><strong>{t('kiosk.editor.cameraList')}</strong><small>{filteredCameras.length} / {cameras.length}</small></div>
            <label className="kiosk-camera-search"><Search/><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('kiosk.editor.search')} aria-label={t('kiosk.editor.search')}/></label>
            <p className="kiosk-editor-instructions">{t('kiosk.editor.dragHint')}</p>
            <div className="kiosk-camera-palette-list">
              {filteredCameras.map((camera) => <button key={camera.id} type="button" draggable
                className={String(camera.id) === selectedCameraId ? 'kiosk-camera-palette-item selected' : 'kiosk-camera-palette-item'}
                aria-pressed={String(camera.id) === selectedCameraId}
                onClick={() => setSelectedCameraId(String(camera.id))}
                onDragStart={(event) => onCameraDragStart(event, camera.id)}
              >
                <KioskThumbnail cameraId={String(camera.id)} thumbnails={thumbnails} requestPreview={requestPreview}/>
                <span className="kiosk-camera-palette-info"><strong>{camera.name}</strong>{camera.location && <small>{camera.location}</small>}</span>
              </button>)}
              {!filteredCameras.length && <p className="kiosk-camera-palette-empty">{t('kiosk.editor.noResults')}</p>}
            </div>
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
              <div className="kiosk-layout-section-title"><strong>{t('kiosk.assignment.title')}</strong><small>{t('kiosk.editor.slotHint')}</small></div>
              <div className="kiosk-layout-assignment-grid kiosk-layout-assignment-visual" style={{ '--layout-cols': draft.columns, '--layout-rows': draft.rows }}>
                {draft.slots.map((item, index) => {
                  const camera = cameraById.get(String(item.cameraId));
                  return <div key={item.id}
                    className={`kiosk-layout-drop-slot${dropTargetId === item.id ? ' drop-target' : ''}${selectedCameraId ? ' can-assign' : ''}`}
                    style={{ gridColumn: `${item.column} / span ${item.columnSpan}`, gridRow: `${item.row} / span ${item.rowSpan}` }}
                    onDragEnter={(event) => { event.preventDefault(); setDropTargetId(item.id); }}
                    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types || []).includes('application/x-tmp-slot-id') ? 'move' : 'copy'; }}
                    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTargetId(''); }}
                    onDrop={(event) => onDropSlot(event, item.id)}
                  >
                    <button type="button" className="kiosk-layout-slot-preview"
                      draggable={Boolean(camera)}
                      onDragStart={(event) => onSlotDragStart(event, item.id)}
                      onClick={() => selectSlot(item.id)}
                      aria-label={t('kiosk.editor.assignSlot', { number: index + 1 })}
                    >
                      {camera
                        ? <KioskThumbnail cameraId={String(camera.id)} thumbnails={thumbnails} requestPreview={requestPreview}/>
                        : <Grid2X2 className="kiosk-layout-slot-empty-icon"/>}
                      <span className="kiosk-layout-slot-name">{camera?.name || t('kiosk.assignment.noCamera')}</span>
                      <span className="kiosk-layout-slot-number">{t('kiosk.assignment.tile', { number: index + 1 })}{item.columnSpan > 1 || item.rowSpan > 1 ? ` · ${t('kiosk.assignment.focus')}` : ''}</span>
                    </button>
                    <div className="kiosk-layout-slot-actions">
                      <select aria-label={t('kiosk.editor.assignSlot', { number: index + 1 })} value={item.cameraId} onChange={(event) => changeCamera(item.id, event.target.value)}>
                        <option value="">{t('kiosk.assignment.noCamera')}</option>
                        {cameras.map((available) => <option key={available.id} value={available.id}>{available.name}{available.location ? ` · ${available.location}` : ''}</option>)}
                      </select>
                      {item.cameraId && <button type="button" className="kiosk-layout-slot-clear" onClick={() => changeCamera(item.id, '')} title={t('kiosk.editor.clear')} aria-label={t('kiosk.editor.clear')}><X/></button>}
                    </div>
                  </div>;
                })}
              </div>
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
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [runtimeStatus, setRuntimeStatus] = useState({});
  const [statusError, setStatusError] = useState('');
  const kioskStatusFailures = useRef(0);
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
    let inFlight = false;
    async function loadRuntimeStatus() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result = await api.kioskStatus();
        if (cancelled) return;
        kioskStatusFailures.current = 0;
        setRuntimeStatus(buildKioskCameraStatus({ ...result, cameras }));
        setStatusError('');
      } catch {
        if (cancelled) return;
        kioskStatusFailures.current += 1;
        // A single missed backend heartbeat during recording startup is not
        // a video failure. Keep the most recent camera/motion status visible.
        if (kioskStatusFailures.current >= 3) setStatusError(t('kiosk.status.unavailable'));
      } finally {
        inFlight = false;
      }
    }
    loadRuntimeStatus();
    const interval = window.setInterval(loadRuntimeStatus, 3500);
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
        <span className="kiosk-central-preview"><Radio/> Zentraler Preview</span>
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
          quality="low"
          runtimeStatus={camera ? runtimeStatus[camera.id] : null}
          startDelayMs={camera ? Math.min(index * 120, 3000) : 0}
          style={{ gridColumn: `${item.column} / span ${item.columnSpan}`, gridRow: `${item.row} / span ${item.rowSpan}` }}
          t={t}
        />;
      })}</section>
      : <div className="empty-panel"><Radio/><h2>{t('kiosk.empty.noCameras')}</h2></div>}
    {editorLayout && <KioskLayoutEditor cameras={cameras} layouts={layouts} initialLayout={editorLayout} onClose={() => setEditorLayout(null)} onSave={saveLayout} onDelete={deleteLayout} t={t}/>} 
  </div>;
}

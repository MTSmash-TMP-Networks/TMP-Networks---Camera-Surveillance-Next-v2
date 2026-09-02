import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, Image as ImageIcon, Maximize2, RefreshCw } from 'lucide-react';
import { api } from '../services/api.js';

const FULL_FRAME = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function pointForEvent(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)),
    y: clamp((event.clientY - bounds.top) / Math.max(1, bounds.height)),
  };
}

function rectangle(start, current) {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x,
    y,
    width: Math.max(0.001, Math.abs(current.x - start.x)),
    height: Math.max(0.001, Math.abs(current.y - start.y)),
  };
}

function percent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

export function MotionZoneEditor({ cameraId, value, onChange, disabled = false }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewObjectUrl = useRef('');
  const drag = useRef(null);
  const active = Boolean(value);

  const replacePreview = useCallback((blob) => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    const next = URL.createObjectURL(blob);
    previewObjectUrl.current = next;
    setPreviewUrl(next);
  }, []);

  const loadPreview = useCallback(async () => {
    if (!cameraId) return;
    setPreviewBusy(true);
    setPreviewError('');
    try {
      replacePreview(await api.snapshot(cameraId));
    } catch (error) {
      setPreviewError(error?.message || 'Vorschaubild konnte nicht geladen werden.');
    } finally {
      setPreviewBusy(false);
    }
  }, [cameraId, replacePreview]);

  useEffect(() => {
    void loadPreview();
    return () => {
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = '';
    };
  }, [loadPreview]);

  function setLimited(enabled) {
    if (disabled) return;
    onChange(enabled ? (value || { ...FULL_FRAME }) : null);
  }

  function pointerDown(event) {
    if (!active || disabled || !previewUrl) return;
    event.preventDefault();
    const start = pointForEvent(event);
    drag.current = { start, previous: value, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    onChange(rectangle(drag.current.start, pointForEvent(event)));
  }

  function finishPointer(event) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const next = rectangle(drag.current.start, pointForEvent(event));
    const previous = drag.current.previous;
    drag.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    if (next.width < 0.02 || next.height < 0.02) onChange(previous || { ...FULL_FRAME });
    else onChange(next);
  }

  const zoneStyle = value ? {
    left: percent(value.x),
    top: percent(value.y),
    width: percent(value.width),
    height: percent(value.height),
  } : null;

  return <div className="motion-zone-editor">
    <div className="motion-zone-toolbar">
      <label className="switch-row motion-zone-switch">
        <input type="checkbox" checked={active} onChange={(event) => setLimited(event.target.checked)} disabled={disabled}/>
        <span><strong>Motion-Bereich begrenzen</strong><small>Nur Bewegungen innerhalb der markierten Fläche lösen die Motion-Erkennung aus.</small></span>
      </label>
      <div className="motion-zone-actions">
        <button type="button" className="secondary-button" onClick={loadPreview} disabled={previewBusy}><RefreshCw className={previewBusy ? 'spin' : ''}/> {previewBusy ? 'Vorschau wird geladen …' : 'Vorschau aktualisieren'}</button>
        {active && <button type="button" className="secondary-button" onClick={() => onChange(null)} disabled={disabled}><Maximize2/> Gesamtes Bild verwenden</button>}
      </div>
    </div>

    <div
      className={`motion-zone-stage ${active ? 'is-selecting' : ''} ${previewUrl ? 'has-preview' : ''}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      aria-label="Motion-Bereich im Kamerabild markieren"
    >
      {previewUrl ? <img src={previewUrl} alt="Aktuelles Kamerabild für Motion-Bereich" draggable="false"/> : <div className="motion-zone-placeholder"><ImageIcon/><strong>{previewBusy ? 'Vorschaubild wird geladen …' : 'Kein Vorschaubild verfügbar'}</strong><span>{previewError || 'Mit „Vorschau aktualisieren“ erneut versuchen.'}</span></div>}
      {active && previewUrl && <div className="motion-zone-selection" style={zoneStyle}><span><Crosshair/> Aktiver Bereich</span></div>}
    </div>

    <div className="motion-zone-footer">
      <span>{active ? <><Crosshair/> Markierten Bereich mit Maus oder Touch neu aufziehen.</> : <><Maximize2/> Motion wirkt derzeit auf das gesamte Kamerabild.</>}</span>
      {active && value && <strong>{percent(value.width)} × {percent(value.height)} · Start {percent(value.x)} / {percent(value.y)}</strong>}
    </div>
    {previewError && previewUrl && <div className="inline-warning">Die letzte Aktualisierung der Vorschau ist fehlgeschlagen: {previewError}</div>}
  </div>;
}

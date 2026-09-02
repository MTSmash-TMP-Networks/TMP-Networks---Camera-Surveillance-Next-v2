import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bug, CheckCircle2, ChevronDown, ChevronRight, Download, Eraser, FileText, RefreshCw } from 'lucide-react';
import { api } from '../services/api.js';

function iconFor(level) {
  if (level === 'error') return <AlertTriangle />;
  if (level === 'warn') return <Bug />;
  return <CheckCircle2 />;
}

function time(value) {
  try { return new Intl.DateTimeFormat(globalThis.document?.documentElement?.lang || 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)); }
  catch { return value; }
}

function detailsText(details) {
  if (!details) return '';
  try { return JSON.stringify(details, null, 2); } catch { return String(details); }
}

export function CameraLogPanel({ cameraId, canClear = false, open, onOpenChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const lastId = useRef(0);

  async function load({ reset = false } = {}) {
    if (!cameraId) return;
    setLoading(true);
    try {
      const response = await api.cameraLogs(cameraId, { limit: reset ? 250 : 150, after: reset ? 0 : lastId.current });
      const incoming = response.items || [];
      setItems((current) => reset ? incoming : [...current, ...incoming].slice(-400));
      if (incoming.length) lastId.current = incoming[incoming.length - 1].id;
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Protokoll konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !cameraId) return undefined;
    let stopped = false;
    const initialTimer = setTimeout(() => { if (!stopped) load({ reset: true }); }, 0);
    const timer = setInterval(() => { if (!stopped) load(); }, 1500);
    return () => { stopped = true; clearTimeout(initialTimer); clearInterval(timer); };
  }, [open, cameraId]);

  const newest = items[items.length - 1] || null;
  const hasErrors = useMemo(() => items.some((item) => item.level === 'error'), [items]);

  async function clearLogs() {
    await api.clearCameraLogs(cameraId);
    lastId.current = 0;
    setItems([]);
    await load({ reset: true });
  }

  function download() {
    const lines = items.map((item) => {
      const detail = detailsText(item.details);
      return `[${item.createdAt}] [${item.level.toUpperCase()}] [${item.component}] ${item.code || ''} ${item.message}${detail ? `\n${detail}` : ''}`;
    });
    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kamera_${cameraId}_diagnose_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  return <section className={`camera-log-panel ${open ? 'is-open' : ''}`}>
    <button className="camera-log-toggle" onClick={() => onOpenChange?.(!open)}>
      <span className={`diagnostic-led ${hasErrors ? 'error' : newest?.level === 'warn' ? 'warn' : 'ok'}`} />
      <span><strong>Diagnoseprotokoll</strong><small>{newest ? `${time(newest.createdAt)} · ${newest.message}` : 'Noch keine Streamereignisse'}</small></span>
      {open ? <ChevronDown /> : <ChevronRight />}
    </button>
    {open && <div className="camera-log-body">
      <div className="camera-log-toolbar">
        <span><FileText /> {items.length} Einträge</span>
        <div>
          <button title="Aktualisieren" onClick={() => load({ reset: true })} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button>
          <button title="Protokoll herunterladen" onClick={download} disabled={!items.length}><Download /></button>
          {canClear && <button title="Protokoll leeren" onClick={clearLogs}><Eraser /></button>}
        </div>
      </div>
      {error && <div className="camera-log-error">{error}</div>}
      <div className="camera-log-list">
        {!items.length && !loading && <div className="camera-log-empty">Noch keine Diagnoseeinträge vorhanden.</div>}
        {[...items].reverse().map((item) => {
          const detail = detailsText(item.details);
          const isExpanded = Boolean(expanded[item.id]);
          return <article key={item.id} className={`camera-log-entry level-${item.level}`}>
            <div className="camera-log-icon">{iconFor(item.level)}</div>
            <div className="camera-log-copy">
              <div><time>{time(item.createdAt)}</time><span>{item.component}</span>{item.code && <code>{item.code}</code>}</div>
              <p>{item.message}</p>
              {detail && <button className="log-detail-toggle" onClick={() => setExpanded((current) => ({ ...current, [item.id]: !isExpanded }))}>{isExpanded ? 'Details ausblenden' : 'Technische Details anzeigen'}</button>}
              {isExpanded && detail && <pre>{detail}</pre>}
            </div>
          </article>;
        })}
      </div>
    </div>}
  </section>;
}

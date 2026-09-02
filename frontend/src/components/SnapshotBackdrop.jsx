import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';

export function SnapshotBackdrop({ cameraId, refreshMs = 30000, className = '', enabled = true }) {
  const [url, setUrl] = useState('');
  const currentUrl = useRef('');

  useEffect(() => () => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = '';
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    async function update() {
      try {
        const blob = await api.snapshot(cameraId);
        const next = URL.createObjectURL(blob);
        if (cancelled) return URL.revokeObjectURL(next);
        const image = new Image();
        image.onload = () => {
          if (cancelled) return URL.revokeObjectURL(next);
          const old = currentUrl.current;
          currentUrl.current = next;
          setUrl(next);
          if (old) setTimeout(() => URL.revokeObjectURL(old), 500);
        };
        image.src = next;
      } catch { /* Der Liveplayer zeigt eine eigene Statusmeldung. */ }
    }
    update();
    const timer = setInterval(update, refreshMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [cameraId, enabled, refreshMs]);

  return <div className={`snapshot-backdrop ${className}`} style={url ? { backgroundImage: `url(${url})` } : undefined} aria-hidden="true" />;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Home, MapPin } from 'lucide-react';
import { api } from '../services/api.js';
import { liveStreamPool } from '../services/liveStreamPool.js';
import { cameraSupportsPtz } from '../utils/cameraCapabilities.js';

// A frozen player must never delay or block physical PTZ commands.
const MOVE_PULSE_MS = 450;
const LEASE_HEARTBEAT_MS = 900;
const CLIENT_STORAGE_KEY = 'tmp-camera-ptz-client-id';

function randomId(prefix = 'ptz') {
  const value = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function stableClientId() {
  try {
    const existing = globalThis.sessionStorage?.getItem(CLIENT_STORAGE_KEY);
    if (existing) return existing;
    const created = randomId('client');
    globalThis.sessionStorage?.setItem(CLIENT_STORAGE_KEY, created);
    return created;
  } catch {
    return randomId('client');
  }
}

export function PtzControls({ camera, profileToken, allowed }) {
  const hasPtz = cameraSupportsPtz(camera);
  const [presets, setPresets] = useState([]);
  const [preset, setPreset] = useState('');
  const [status, setStatus] = useState('Bereit');
  const activeRef = useRef(null);
  const pendingRef = useRef(null);
  const stopPromiseRef = useRef(Promise.resolve());
  const mountedRef = useRef(true);
  const clientIdRef = useRef(stableClientId());
  const cameraRef = useRef(camera.id);
  const profileRef = useRef(profileToken || null);

  cameraRef.current = camera.id;
  profileRef.current = profileToken || null;

  const updateStatus = useCallback((value) => {
    if (mountedRef.current) setStatus(value);
  }, []);

  const clearInteractionTimers = useCallback((interaction) => {
    if (!interaction) return;
    if (interaction.pulseTimer) globalThis.clearInterval(interaction.pulseTimer);
    if (interaction.heartbeatTimer) globalThis.clearInterval(interaction.heartbeatTimer);
    interaction.pulseTimer = null;
    interaction.heartbeatTimer = null;
  }, []);

  const stopInteraction = useCallback((reason = 'user-stop') => {
    const pending = pendingRef.current;
    if (pending) {
      pending.ended = true;
      pendingRef.current = null;
    }
    const interaction = activeRef.current;
    if (!interaction) return stopPromiseRef.current;
    if (interaction.stopping) return interaction.stopPromise || stopPromiseRef.current;
    interaction.stopping = true;
    interaction.ended = true;
    activeRef.current = null;
    clearInteractionTimers(interaction);
    updateStatus('PTZ wird gestoppt …');
    const request = async () => {
      try {
        await api.ptzStop(cameraRef.current, {
          profileToken: profileRef.current,
          interactionId: interaction.id,
          clientId: clientIdRef.current,
          sequence: ++interaction.sequence,
          reason,
        });
        liveStreamPool.verifyAfterControl(cameraRef.current, reason);
        updateStatus('Bereit');
      } catch (error) {
        updateStatus(error?.message || 'PTZ konnte nicht sicher gestoppt werden. Der Server führt einen Recovery-Stop aus.');
        throw error;
      }
    };
    const chained = Promise.resolve(stopPromiseRef.current).catch(() => {}).then(request);
    interaction.stopPromise = chained;
    stopPromiseRef.current = chained.catch(() => {});
    return chained;
  }, [clearInteractionTimers, updateStatus]);

  const sendMovePulse = useCallback((interaction) => {
    if (!interaction || interaction.ended || activeRef.current !== interaction) return;
    if (interaction.inFlight) {
      interaction.pending = true;
      return;
    }
    interaction.inFlight = true;
    interaction.pending = false;
    const sequence = ++interaction.sequence;
    liveStreamPool.markControlActivity(cameraRef.current, 'ptz-move');
    api.ptzMove(cameraRef.current, {
      ...interaction.vector,
      profileToken: profileRef.current,
      interactionId: interaction.id,
      clientId: clientIdRef.current,
      sequence,
    }).then(() => {
      liveStreamPool.markControlActivity(cameraRef.current, 'ptz-move-ok');
      updateStatus('PTZ aktiv');
    }).catch((error) => {
      interaction.failures += 1;
      updateStatus(error?.message || 'PTZ-Befehl fehlgeschlagen');
      if (interaction.failures >= 3) void stopInteraction('move-error');
    }).finally(() => {
      interaction.inFlight = false;
      if (interaction.pending && !interaction.ended && activeRef.current === interaction) {
        queueMicrotask(() => sendMovePulse(interaction));
      }
    });
  }, [stopInteraction, updateStatus]);

  const beginInteraction = useCallback((vector) => {
    if (pendingRef.current) pendingRef.current.ended = true;
    pendingRef.current = null;
    const previousStop = stopInteraction('interaction-replaced');
    const interaction = {
      id: randomId('interaction'),
      vector,
      sequence: 0,
      failures: 0,
      inFlight: false,
      pending: false,
      ended: false,
      stopping: false,
      stopPromise: null,
      pulseTimer: null,
      heartbeatTimer: null,
    };
    pendingRef.current = interaction;
    updateStatus('PTZ wird gestartet …');
    Promise.resolve(previousStop).catch(() => {}).then(() => {
      if (interaction.ended || pendingRef.current !== interaction) return;
      pendingRef.current = null;
      activeRef.current = interaction;
      sendMovePulse(interaction);
      interaction.pulseTimer = globalThis.setInterval(() => sendMovePulse(interaction), MOVE_PULSE_MS);
      interaction.heartbeatTimer = globalThis.setInterval(() => {
        if (interaction.ended || activeRef.current !== interaction) return;
        api.ptzHeartbeat(cameraRef.current, {
          profileToken: profileRef.current,
          interactionId: interaction.id,
          clientId: clientIdRef.current,
          sequence: interaction.sequence,
        }).catch((error) => {
          updateStatus(error?.message || 'PTZ-Heartbeat fehlgeschlagen');
        });
      }, LEASE_HEARTBEAT_MS);
    });
  }, [sendMovePulse, stopInteraction, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    const stopFromWindow = () => { void stopInteraction('window-release'); };
    const stopWhenHidden = () => {
      if (document.visibilityState === 'hidden') void stopInteraction('document-hidden');
    };
    globalThis.addEventListener('pointerup', stopFromWindow);
    globalThis.addEventListener('blur', stopFromWindow);
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      mountedRef.current = false;
      globalThis.removeEventListener('pointerup', stopFromWindow);
      globalThis.removeEventListener('blur', stopFromWindow);
      document.removeEventListener('visibilitychange', stopWhenHidden);
      const pending = pendingRef.current;
      if (pending) pending.ended = true;
      pendingRef.current = null;
      const interaction = activeRef.current;
      if (interaction) {
        interaction.ended = true;
        clearInteractionTimers(interaction);
        activeRef.current = null;
        void api.ptzStop(cameraRef.current, {
          profileToken: profileRef.current,
          interactionId: interaction.id,
          clientId: clientIdRef.current,
          sequence: ++interaction.sequence,
          reason: 'component-unmount',
        }).catch(() => {});
      }
    };
  }, [clearInteractionTimers, stopInteraction]);

  useEffect(() => {
    let cancelled = false;
    if (!hasPtz || !allowed) return undefined;
    api.presets(camera.id, profileToken).then((result) => {
      if (!cancelled) {
        setPresets(result.items || []);
        setPreset(result.items?.[0]?.token || '');
      }
    }).catch(() => { if (!cancelled) setPresets([]); });
    return () => { cancelled = true; };
  }, [camera.id, hasPtz, profileToken, allowed]);

  if (!hasPtz) return <div className="empty-control">PTZ wird von dieser Kamera nicht gemeldet.</div>;
  if (!allowed) return <div className="empty-control">PTZ erfordert die Rolle Operator oder Administrator.</div>;

  const runDiscrete = async (label, action) => {
    await stopInteraction('discrete-command');
    const interactionId = randomId('interaction');
    updateStatus(`${label} …`);
    try {
      liveStreamPool.markControlActivity(cameraRef.current, 'ptz-discrete');
      await action({
        profileToken: profileRef.current,
        interactionId,
        clientId: clientIdRef.current,
        sequence: 1,
      });
      liveStreamPool.verifyAfterControl(cameraRef.current, 'ptz-discrete-complete');
      updateStatus(`${label} abgeschlossen. Live-Stream und laufende Aufnahmen wurden nicht unterbrochen.`);
    } catch (error) {
      updateStatus(error?.message || `${label} fehlgeschlagen`);
    }
  };

  const bind = (x, y, zoom = 0) => ({
    onPointerDown: (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginInteraction({ x, y, zoom });
    },
    onPointerUp: (event) => {
      event.preventDefault();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      void stopInteraction('pointer-up');
    },
    onPointerCancel: () => { void stopInteraction('pointer-cancel'); },
    onLostPointerCapture: () => { void stopInteraction('pointer-capture-lost'); },
    onKeyDown: (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        beginInteraction({ x, y, zoom });
      }
    },
    onKeyUp: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void stopInteraction('keyboard-up');
      }
    },
    onContextMenu: (event) => event.preventDefault(),
  });

  return <>
    <div className="ptz-grid" aria-label="PTZ-Steuerung">
      <span /><button type="button" {...bind(0, 0.7)} title="Nach oben"><ChevronUp /></button><span />
      <button type="button" {...bind(-0.7, 0)} title="Nach links"><ChevronLeft /></button>
      <button type="button" onClick={() => runDiscrete('Home-Position wird angefahren', (input) => api.ptzHome(camera.id, input))} title="Home-Position"><Home /></button>
      <button type="button" {...bind(0.7, 0)} title="Nach rechts"><ChevronRight /></button>
      <button type="button" {...bind(0, 0, -0.7)} title="Herauszoomen"><ZoomOut /></button>
      <button type="button" {...bind(0, -0.7)} title="Nach unten"><ChevronDown /></button>
      <button type="button" {...bind(0, 0, 0.7)} title="Heranzoomen"><ZoomIn /></button>
    </div>
    <div className="ptz-status"><span>{status}</span></div>
    {presets.length > 0 && <div className="preset-control">
      <select value={preset} onChange={(event) => setPreset(event.target.value)} aria-label="PTZ-Preset">
        {presets.map((item) => <option key={item.token} value={item.token}>{item.name}</option>)}
      </select>
      <button type="button" className="secondary-button" onClick={() => runDiscrete('Preset wird angefahren', (input) => api.gotoPreset(camera.id, preset, input))}><MapPin/> Anfahren</button>
    </div>}
  </>;
}

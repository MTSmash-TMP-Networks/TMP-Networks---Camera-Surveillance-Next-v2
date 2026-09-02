function abortError() {
  return new DOMException('WebRTC-Verbindungsaufbau abgebrochen', 'AbortError');
}

function timeoutError(message) {
  return new Error(message);
}

async function playWithTimeout(video, timeout = 8000, signal = null) {
  if (signal?.aborted) throw abortError();
  const playPromise = Promise.resolve(video.play());
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError('WebRTC-Wiedergabe hat nicht rechtzeitig begonnen')), timeout);
  });
  const abortPromise = new Promise((_, reject) => {
    if (!signal) return;
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
  try {
    await Promise.race(signal ? [playPromise, timeoutPromise, abortPromise] : [playPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function waitIce(pc, timeout = 5000, signal = null) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', handler);
      signal?.removeEventListener('abort', aborted);
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const handler = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const aborted = () => finish(abortError());
    const timer = setTimeout(() => finish(), timeout);
    pc.addEventListener('icegatheringstatechange', handler);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

function startStats(pc, onStats) {
  if (!onStats) return () => {};
  let previous = null;
  const timer = setInterval(async () => {
    try {
      const reports = await pc.getStats();
      let inbound;
      reports.forEach((report) => {
        if (report.type === 'inbound-rtp' && !report.isRemote && (report.kind === 'video' || report.mediaType === 'video')) inbound = report;
      });
      if (!inbound) return;
      const current = {
        packetsReceived: Number(inbound.packetsReceived || 0),
        packetsLost: Number(inbound.packetsLost || 0),
        bytesReceived: Number(inbound.bytesReceived || 0),
        framesDecoded: Number(inbound.framesDecoded || 0),
        timestamp: Number(inbound.timestamp || performance.now()),
      };
      if (previous) {
        const received = Math.max(0, current.packetsReceived - previous.packetsReceived);
        const lost = Math.max(0, current.packetsLost - previous.packetsLost);
        const total = received + lost;
        const seconds = Math.max(0.001, (current.timestamp - previous.timestamp) / 1000);
        const frameDelta = Math.max(0, current.framesDecoded - previous.framesDecoded);
        const byteDelta = Math.max(0, current.bytesReceived - previous.bytesReceived);
        onStats({
          packetLoss: total ? lost / total : 0,
          jitter: Number(inbound.jitter || 0),
          framesPerSecond: Number(inbound.framesPerSecond || (frameDelta / seconds) || 0),
          bitrate: Math.max(0, (byteDelta * 8) / seconds),
          framesDecoded: current.framesDecoded,
          frameDelta,
          byteDelta,
          packetsDelta: received,
        });
      }
      previous = current;
    } catch { /* Statistik darf den Stream nicht unterbrechen. */ }
  }, 5000);
  return () => clearInterval(timer);
}

export async function connectWhep({ url, token, video, onState, onStats, signal, includeAudio = false }) {
  if (signal?.aborted) throw abortError();
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  const stream = new MediaStream();
  let location = null;
  let etag = null;
  let stopStats = () => {};
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    stopStats();
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try { pc.close(); } catch { /* already closed */ }
    video.srcObject = null;
    if (location) {
      const sessionUrl = new URL(location, url).toString();
      fetch(sessionUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, ...(etag ? { 'If-Match': etag } : {}) },
      }).catch(() => {});
    }
  };
  const aborted = () => { close().catch(() => {}); };
  signal?.addEventListener('abort', aborted, { once: true });

  try {
    pc.addTransceiver('video', { direction: 'recvonly' });
    if (includeAudio) pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (event) => {
      stream.addTrack(event.track);
      video.srcObject = stream;
    };
    pc.onconnectionstatechange = () => onState?.(pc.connectionState);
    const offer = await pc.createOffer();
    if (signal?.aborted) throw abortError();
    await pc.setLocalDescription(offer);
    await waitIce(pc, 5000, signal);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${token}` },
      body: pc.localDescription.sdp,
      signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`WebRTC/WHEP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
    }
    location = response.headers.get('location');
    etag = response.headers.get('etag');
    const answer = await response.text();
    if (signal?.aborted) throw abortError();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await playWithTimeout(video, 8000, signal);
    if (signal?.aborted) throw abortError();
    stopStats = startStats(pc, onStats);

    return async () => {
      signal?.removeEventListener('abort', aborted);
      await close();
    };
  } catch (error) {
    signal?.removeEventListener('abort', aborted);
    await close();
    throw error;
  }
}

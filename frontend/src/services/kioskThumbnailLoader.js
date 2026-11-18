// Snapshot-only thumbnails for the layout editor. Never create additional
// go2rtc/RTSP browser readers for thumbnails. Fetch only visible cards and
// limit total camera snapshot requests to avoid a 26-camera burst.
export function createKioskThumbnailLoader({
  load, createUrl, revokeUrl, onUpdate = () => {}, maxConcurrent = 2,
} = {}) {
  if (typeof load !== 'function') throw new TypeError('Thumbnail loader requires load');
  const limit = Math.max(1, Math.min(4, Math.floor(Number(maxConcurrent) || 2)));
  const pending = new Set();
  const queue = [];
  const controllers = new Set();
  const urls = new Map();
  let inFlight = 0;
  let disposed = false;

  function pump() {
    while (!disposed && inFlight < limit && queue.length) {
      const cameraId = queue.shift();
      const controller = new AbortController();
      controllers.add(controller);
      inFlight += 1;
      Promise.resolve()
        .then(() => load(cameraId, controller.signal))
        .then((blob) => {
          if (disposed) return;
          const url = createUrl(blob);
          urls.set(cameraId, url);
          onUpdate(cameraId, url);
        })
        .catch(() => {
          if (disposed) return;
          // Keep the fallback icon rather than repeatedly probing an offline
          // camera while the user is rearranging the grid.
          onUpdate(cameraId, '');
        })
        .finally(() => {
          pending.delete(cameraId);
          controllers.delete(controller);
          inFlight -= 1;
          pump();
        });
    }
  }

  return {
    request(cameraId) {
      const id = String(cameraId || '');
      if (!id || disposed || pending.has(id) || urls.has(id)) return;
      pending.add(id);
      queue.push(id);
      pump();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      for (const controller of controllers) controller.abort();
      for (const url of urls.values()) if (url) revokeUrl(url);
      urls.clear();
    },
  };
}

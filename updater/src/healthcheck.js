import http from 'node:http';

const port = Number(process.env.UPDATER_PORT || 3010);
const timeoutMs = Number(process.env.UPDATER_HEALTHCHECK_TIMEOUT_MS || 2500);

const request = http.get({
  host: '127.0.0.1',
  port,
  path: '/health',
  timeout: timeoutMs,
  headers: { Accept: 'application/json', 'X-Request-ID': `docker-health-${process.pid}` },
}, (response) => {
  const chunks = [];
  let size = 0;
  response.on('data', (chunk) => {
    size += chunk.length;
    if (size <= 32 * 1024) chunks.push(chunk);
  });
  response.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const compatible = payload?.service === 'tmp-camera-updater';
      if (response.statusCode === 200 && compatible) process.exit(0);
      process.stderr.write(`Updater-Healthcheck fehlgeschlagen: HTTP ${response.statusCode || 0}\n`);
      process.exit(1);
    } catch {
      process.stderr.write('Updater-Healthcheck lieferte keine gültige Antwort.\n');
      process.exit(1);
    }
  });
});

request.on('timeout', () => request.destroy(new Error('timeout')));
request.on('error', () => {
  process.stderr.write('Updater-Healthcheck konnte keine Verbindung herstellen.\n');
  process.exit(1);
});

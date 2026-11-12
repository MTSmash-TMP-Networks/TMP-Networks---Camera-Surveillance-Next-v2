import http from 'node:http';

// Read-only ONVIF operation. It does not change clock, camera settings or streams.
const GET_SYSTEM_DATE_AND_TIME = '<?xml version="1.0" encoding="utf-8"?>'
  + '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">'
  + '<s:Body><tds:GetSystemDateAndTime xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>'
  + '</s:Body></s:Envelope>';

export async function probeOnvifHttpDeviceService(host, port = 8000, timeoutMs = 1600) {
  // Called only for IPv4 targets from the bounded device scanner.
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(host || '')) || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) return null;
  const url = `http://${host}:${port}/onvif/device_service`;
  const body = GET_SYSTEM_DATE_AND_TIME;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const request = http.request(url, {
      method: 'POST', timeout: Math.max(300, Math.min(4000, Number(timeoutMs) || 1600)),
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/soap+xml,text/xml,application/xml,*/*;q=0.1',
        Connection: 'close',
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (size >= 64 * 1024) return;
        const remaining = 64 * 1024 - size;
        chunks.push(chunk.subarray(0, remaining));
        size += Math.min(chunk.length, remaining);
      });
      response.once('end', () => finish({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        url,
      }));
      response.once('error', () => finish(null));
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => finish(null));
    request.end(body);
  });
}

import { describe, expect, it } from 'vitest';
import { parseIspyCameraPage } from '../src/services/media/OnlineCameraCatalog.js';

const html = `
<table>
  <tr><th>Models</th><th>Type</th><th>Protocol</th><th>URL</th></tr>
  <tr><td>DS-2CD2043G2-I, DS-2CD2143G2-I</td><td>FFMPEG</td><td>RTSP</td><td>/Streaming/Channels/101</td></tr>
  <tr><td>Unknown</td><td>FFMPEG</td><td>RTSP</td><td>/Streaming/Channels/102</td></tr>
  <tr><td>DS-2CD2043G2-I</td><td>FFMPEG</td><td>HTTP</td><td>/ISAPI/Streaming/channels/101/picture</td></tr>
  <tr><td>DS-2CD2043G2-I</td><td>FFMPEG</td><td>RTSP</td><td>/path?user=[USERNAME]&password=[PASSWORD]</td></tr>
</table>
<p>Port 554 ONVIF</p>`;

describe('Agent-DVR-/iSpy-Katalogparser', () => {
  it('ordnet ein exaktes Modell und Unknown-Fallbacks zu', () => {
    const items = parseIspyCameraPage(html, {
      manufacturer: 'Hikvision',
      model: 'DS-2CD2043G2-I',
      host: '192.0.2.10',
      openPorts: [80, 554],
    });
    expect(items.some((item) => item.url === 'rtsp://192.0.2.10:554/Streaming/Channels/101' && item.confidence === 82)).toBe(true);
    expect(items.some((item) => item.url.endsWith('/Streaming/Channels/102') && item.confidence === 52)).toBe(true);
  });

  it('entfernt Platzhalter fuer Klartext-Zugangsdaten aus der Kandidatenliste', () => {
    const items = parseIspyCameraPage(html, {
      manufacturer: 'Hikvision',
      model: 'DS-2CD2043G2-I',
      host: '192.0.2.10',
      openPorts: [80, 554],
    });
    expect(items.every((item) => !item.url.includes('[USERNAME]') && !item.url.includes('[PASSWORD]'))).toBe(true);
  });

  it('setzt HTTP auf offenen HTTPS-Ports als https um', () => {
    const items = parseIspyCameraPage(html, {
      manufacturer: 'Hikvision',
      model: 'DS-2CD2043G2-I',
      host: '192.0.2.10',
      openPorts: [443],
    });
    expect(items.some((item) => item.url.startsWith('https://192.0.2.10:443/ISAPI/'))).toBe(true);
  });
});

describe('Protokoll- und Medientypzuordnung', () => {
  it('behandelt JPEG ueber HTTP als Snapshot und nutzt ohne Portscan Port 80', () => {
    const jpegHtml = '<table><tr><td>M2035-LE</td><td>JPEG</td><td>HTTP</td><td>/axis-cgi/jpg/image.cgi</td></tr></table><p>Port 554 ONVIF</p>';
    const items = parseIspyCameraPage(jpegHtml, {
      manufacturer: 'Axis', model: 'M2035-LE', host: '192.0.2.10', openPorts: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'snapshot', url: 'http://192.0.2.10:80/axis-cgi/jpg/image.cgi' });
  });

  it('behandelt MJPEG ueber HTTP als MJPEG', () => {
    const mjpegHtml = '<table><tr><td>Unknown</td><td>MJPEG</td><td>HTTP</td><td>/video.mjpg</td></tr></table>';
    const items = parseIspyCameraPage(mjpegHtml, {
      manufacturer: 'Axis', model: 'M2035-LE', host: '192.0.2.10', openPorts: [80],
    });
    expect(items[0]).toMatchObject({ kind: 'mjpeg' });
  });
});

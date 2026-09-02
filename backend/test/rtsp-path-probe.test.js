import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuthorization, parseAuthChallenge, parseRtspResponse, RtspPathProbe } from '../src/services/media/RtspPathProbe.js';

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = net.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

describe('RTSP-Protokollprüfung', () => {
  it('parst Status, Header und SDP', () => {
    const response = parseRtspResponse('RTSP/1.0 200 OK\r\nCSeq: 2\r\nContent-Type: application/sdp\r\nContent-Length: 31\r\n\r\nv=0\r\nm=video 0 RTP/AVP 96\r\n');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/sdp');
    expect(response.body).toContain('m=video');
  });

  it('erzeugt Basic- und Digest-Authentifizierung ohne Kennwortausgabe', () => {
    const basic = parseAuthChallenge('Basic realm="Camera"');
    expect(buildAuthorization(basic, { username: 'admin', password: 'secret', method: 'DESCRIBE', uri: 'rtsp://cam/11' })).toBe(`Basic ${Buffer.from('admin:secret').toString('base64')}`);
    const digest = parseAuthChallenge('Digest realm="IPC", nonce="abc", qop="auth", algorithm=MD5');
    const header = buildAuthorization(digest, { username: 'admin', password: 'secret', method: 'DESCRIBE', uri: 'rtsp://cam/11', cnonce: '00112233' });
    expect(header).toMatch(/^Digest /);
    expect(header).toContain('response="');
    expect(header).not.toContain('secret');
  });

  it('wiederholt DESCRIBE nach Basic-Challenge und erkennt eine Videospur', async () => {
    const sdp = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Camera\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n';
    const port = await listen((socket) => {
      socket.once('data', (data) => {
        const request = data.toString();
        if (!request.includes(`Authorization: Basic ${Buffer.from('admin:secret').toString('base64')}`)) {
          socket.end('RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Basic realm="Camera"\r\nContent-Length: 0\r\n\r\n');
        } else {
          socket.end(`RTSP/1.0 200 OK\r\nCSeq: 2\r\nContent-Type: application/sdp\r\nContent-Length: ${Buffer.byteLength(sdp)}\r\nServer: TestCam\r\n\r\n${sdp}`);
        }
      });
    });
    const probe = new RtspPathProbe({ username: 'admin', password: 'secret', timeoutMs: 1000 });
    const result = await probe.describe(`rtsp://127.0.0.1:${port}/11`);
    expect(result).toMatchObject({ statusCode: 200, validPath: true, hasVideo: true, authenticated: true, server: 'TestCam' });
  });

  it('unterscheidet einen fehlenden Pfad von einem bestätigten Pfad', async () => {
    const port = await listen((socket) => socket.once('data', () => socket.end('RTSP/1.0 404 Not Found\r\nCSeq: 1\r\nContent-Length: 0\r\n\r\n')));
    const result = await new RtspPathProbe({ timeoutMs: 1000 }).describe(`rtsp://127.0.0.1:${port}/wrong`);
    expect(result).toMatchObject({ statusCode: 404, validPath: false });
  });
});

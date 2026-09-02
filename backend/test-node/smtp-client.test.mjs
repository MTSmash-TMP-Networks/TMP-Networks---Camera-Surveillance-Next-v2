import net from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSmtpMail } from '../src/services/notifications/SmtpClient.js';

function createMockSmtp() {
  const state = { commands: [], message: '' };
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8'); socket.write('220 mock-smtp ESMTP\r\n'); let buffer = ''; let dataMode = false; let dataLines = [];
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const idx = buffer.indexOf('\n'); if (idx < 0) break;
        const line = buffer.slice(0, idx + 1).replace(/\r?\n$/, ''); buffer = buffer.slice(idx + 1);
        if (dataMode) {
          if (line === '.') { state.message = dataLines.join('\r\n'); dataLines = []; dataMode = false; socket.write('250 2.0.0 queued\r\n'); }
          else dataLines.push(line);
          continue;
        }
        state.commands.push(line);
        if (/^EHLO /.test(line)) socket.write('250-mock-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000000\r\n');
        else if (/^AUTH PLAIN /.test(line)) socket.write('235 2.7.0 authenticated\r\n');
        else if (/^MAIL FROM:/.test(line) || /^RCPT TO:/.test(line)) socket.write('250 2.1.0 ok\r\n');
        else if (line === 'DATA') { dataMode = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
        else if (line === 'QUIT') { socket.write('221 2.0.0 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  return { server, state };
}

test('SMTP client authenticates and delivers multipart UTF-8 mail without external dependencies', async () => {
  const { server, state } = createMockSmtp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = await sendSmtpMail({ host: '127.0.0.1', port, security: 'none', username: 'camera-user', password: 'secret', fromAddress: 'camera@example.test', fromName: 'TMP Überwachung', recipients: ['admin@example.test'], subject: 'Überwachung erkannt', text: 'Zeile 1\n.Zeile 2', html: '<strong>Alarm</strong>', timeoutMs: 3000 });
    assert.equal(result.accepted, 1);
    assert.ok(state.commands.some((line) => line.startsWith('AUTH PLAIN ')));
    assert.ok(state.commands.includes('MAIL FROM:<camera@example.test>'));
    assert.ok(state.commands.includes('RCPT TO:<admin@example.test>'));
    assert.match(state.message, /Subject: =\?UTF-8\?B\?/);
    assert.match(state.message, /Content-Type: multipart\/alternative/);
    assert.match(state.message, /\.\.Zeile 2/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

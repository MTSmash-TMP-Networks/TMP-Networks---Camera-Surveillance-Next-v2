import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

function cleanHeader(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').trim(); }
function encodedWord(value) {
  const text = cleanHeader(value);
  return /^[\x20-\x7E]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}
function mailbox(address, name = '') {
  const email = cleanHeader(address);
  return name ? `${encodedWord(name)} <${email}>` : email;
}
function dotStuff(value) { return String(value).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'); }
function htmlEscape(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }

class ReplyReader {
  constructor(socket) {
    this.socket = socket; this.buffer = ''; this.lines = []; this.waiters = [];
    this.onData = (chunk) => { this.buffer += chunk.toString('utf8'); this.drain(); };
    this.onError = (error) => this.fail(error);
    this.onClose = () => this.fail(Object.assign(new Error('SMTP connection closed unexpectedly'), { code: 'SMTP_CLOSED' }));
    socket.on('data', this.onData); socket.on('error', this.onError); socket.on('close', this.onClose);
  }
  drain() {
    for (;;) {
      const index = this.buffer.indexOf('\n'); if (index < 0) break;
      const line = this.buffer.slice(0, index + 1).replace(/\r?\n$/, ''); this.buffer = this.buffer.slice(index + 1);
      const waiter = this.waiters.shift(); if (waiter) waiter.resolve(line); else this.lines.push(line);
    }
  }
  fail(error) { const waiters = this.waiters.splice(0); for (const waiter of waiters) waiter.reject(error); }
  nextLine() {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  detach() { this.socket.off('data', this.onData); this.socket.off('error', this.onError); this.socket.off('close', this.onClose); }
}

async function response(reader, expected, commandName = 'SMTP') {
  const lines = []; let code = 0;
  for (;;) {
    const line = await reader.nextLine(); lines.push(line);
    const match = line.match(/^(\d{3})([ -])/); if (!match) continue;
    code = Number(match[1]); if (match[2] === ' ') break;
  }
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(code)) {
    const error = new Error(`${commandName}: SMTP ${code} ${lines.join(' | ').slice(0, 600)}`); error.code = 'SMTP_RESPONSE'; error.smtpCode = code; throw error;
  }
  return { code, lines };
}

function connectSocket({ host, port, secure, timeoutMs, rejectUnauthorized }) {
  return new Promise((resolve, reject) => {
    const options = secure ? { host, port, ...(net.isIP(host) ? {} : { servername: host }), rejectUnauthorized } : { host, port };
    const socket = secure ? tls.connect(options) : net.connect(options);
    const fail = (error) => { socket.destroy(); reject(error); };
    socket.setTimeout(timeoutMs, () => fail(Object.assign(new Error('SMTP connection timed out'), { code: 'SMTP_TIMEOUT' })));
    socket.once('error', fail);
    socket.once(secure ? 'secureConnect' : 'connect', () => { socket.off('error', fail); resolve(socket); });
  });
}

async function upgradeTls(socket, { host, rejectUnauthorized, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, ...(net.isIP(host) ? {} : { servername: host }), rejectUnauthorized });
    const fail = (error) => { secure.destroy(); reject(error); };
    secure.setTimeout(timeoutMs, () => fail(Object.assign(new Error('SMTP TLS handshake timed out'), { code: 'SMTP_TLS_TIMEOUT' })));
    secure.once('error', fail);
    secure.once('secureConnect', () => { secure.off('error', fail); resolve(secure); });
  });
}

function buildMessage({ fromAddress, fromName, recipients, subject, text, html }) {
  const boundary = `tmp-camera-${crypto.randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${mailbox(fromAddress, fromName)}`,
    `To: ${recipients.map((item) => mailbox(item)).join(', ')}`,
    `Subject: ${encodedWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@tmp-camera.local>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    'X-Mailer: TMP Camera Surveillance',
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit', '', String(text || ''),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit', '', String(html || `<pre>${htmlEscape(text)}</pre>`),
    `--${boundary}--`, '',
  ];
  return dotStuff(headers.join('\r\n'));
}

export async function sendSmtpMail({ host, port = 587, security = 'starttls', username = '', password = '', rejectUnauthorized = true, timeoutMs = 10000, fromAddress, fromName = '', recipients, subject, text, html }) {
  const secure = security === 'tls';
  let socket = await connectSocket({ host, port, secure, timeoutMs, rejectUnauthorized });
  let reader = new ReplyReader(socket);
  try {
    await response(reader, 220, 'greeting');
    const writeCommand = async (line, expected, name = line.split(' ')[0]) => { socket.write(`${line}\r\n`); return response(reader, expected, name); };
    let ehlo = await writeCommand(`EHLO tmp-camera.local`, 250, 'EHLO');
    if (security === 'starttls') {
      if (!ehlo.lines.some((line) => /STARTTLS/i.test(line))) throw Object.assign(new Error('SMTP server does not offer STARTTLS'), { code: 'SMTP_STARTTLS_UNAVAILABLE' });
      await writeCommand('STARTTLS', 220, 'STARTTLS'); reader.detach(); socket = await upgradeTls(socket, { host, rejectUnauthorized, timeoutMs }); reader = new ReplyReader(socket);
      const writeTls = async (line, expected, name = line.split(' ')[0]) => { socket.write(`${line}\r\n`); return response(reader, expected, name); };
      ehlo = await writeTls('EHLO tmp-camera.local', 250, 'EHLO');
    }
    const command = async (line, expected, name = line.split(' ')[0]) => { socket.write(`${line}\r\n`); return response(reader, expected, name); };
    if (username) {
      const authText = ehlo.lines.join(' ').toUpperCase();
      if (authText.includes('PLAIN')) {
        const token = Buffer.from(`\0${username}\0${password}`).toString('base64'); await command(`AUTH PLAIN ${token}`, 235, 'AUTH');
      } else {
        await command('AUTH LOGIN', 334, 'AUTH'); await command(Buffer.from(username).toString('base64'), 334, 'AUTH USER'); await command(Buffer.from(password).toString('base64'), 235, 'AUTH PASS');
      }
    }
    await command(`MAIL FROM:<${cleanHeader(fromAddress)}>`, 250, 'MAIL FROM');
    for (const recipient of recipients) await command(`RCPT TO:<${cleanHeader(recipient)}>`, [250, 251], 'RCPT TO');
    await command('DATA', 354, 'DATA'); socket.write(`${buildMessage({ fromAddress, fromName, recipients, subject, text, html })}\r\n.\r\n`); await response(reader, 250, 'message');
    try { await command('QUIT', 221, 'QUIT'); } catch { /* delivery already accepted */ }
    return { accepted: recipients.length };
  } finally { reader.detach(); socket.end(); socket.destroy(); }
}

export { buildMessage };

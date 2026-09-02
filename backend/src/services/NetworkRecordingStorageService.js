import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../db/database.js';
import { config } from '../config.js';
import { encryptSecret, decryptSecret } from './credentialVault.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const execFile = promisify(execFileCallback);
const SETTINGS_KEY = 'recording_storage_mode_v2';
const NETWORK_DIR = path.join(config.dataDir, 'network-storage');
const CACHE_DIR = path.join(config.dataDir, 'network-recording-cache');
const KNOWN_HOSTS_FILE = path.join(NETWORK_DIR, 'known_hosts');
const SUPPORTED_PROTOCOLS = new Set(['smb', 'sftp']);
const DEFAULT_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const CACHE_MAX_BYTES = Math.max(64 * 1024 * 1024, Number(process.env.NETWORK_RECORDING_CACHE_MAX_BYTES || DEFAULT_CACHE_BYTES) || DEFAULT_CACHE_BYTES);
const WORKER_INTERVAL_MS = Math.max(5000, Number(process.env.NETWORK_RECORDING_UPLOAD_INTERVAL_MS || 15000) || 15000);
const COMMAND_TIMEOUT_MS = Math.max(5000, Number(process.env.NETWORK_RECORDING_COMMAND_TIMEOUT_MS || 30000) || 30000);
const STALE_CACHE_PART_MAX_AGE_MS = Math.max(60_000, Number(process.env.NETWORK_RECORDING_STALE_PART_MAX_AGE_MS || 3_600_000) || 3_600_000);

function nowIso() { return new Date().toISOString(); }
function asText(value) { return String(value ?? '').trim(); }
function getSetting() { return db.prepare('SELECT value FROM system_settings WHERE key=?').get(SETTINGS_KEY)?.value || 'local'; }
function setSetting(value) {
  db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(SETTINGS_KEY, value, nowIso());
}
function storageMode() { return getSetting() === 'network' ? 'network' : 'local'; }

function activeProfileRow() {
  return db.prepare('SELECT * FROM recording_storage_profiles WHERE active=1 ORDER BY updated_at DESC LIMIT 1').get() || null;
}

function profileRow(id) {
  return id ? db.prepare('SELECT * FROM recording_storage_profiles WHERE id=?').get(id) || null : null;
}

function publicProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    protocol: row.protocol,
    host: row.host,
    port: Number(row.port),
    share: row.share_name || '',
    basePath: row.base_path || '',
    username: row.username || '',
    domain: row.domain_name || '',
    hostKeyPolicy: row.host_key_policy || 'accept-new',
    passwordConfigured: Boolean(row.password_enc),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function containsUnsafeControl(value) {
  return /[\0\r\n]/.test(String(value || ''));
}

function validateHost(value) {
  const host = asText(value);
  if (!host || host.length > 255 || host.startsWith('-') || containsUnsafeControl(host) || /[\s/\\"'`;|&$<>]/.test(host)) {
    throw new AppError(400, 'NETWORK_STORAGE_INVALID', 'Server oder IP-Adresse ist ungueltig.');
  }
  return host;
}

function validateSimple(value, { required = false, max = 320, field = 'Wert', allowSpaces = true } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new AppError(400, 'NETWORK_STORAGE_INVALID', `${field} fehlt.`);
  if (text.length > max || containsUnsafeControl(text) || (!allowSpaces && /\s/.test(text))) {
    throw new AppError(400, 'NETWORK_STORAGE_INVALID', `${field} ist ungueltig.`);
  }
  return text;
}

function parseHostAndPort(value, fallbackPort) {
  let text = String(value ?? '').trim();
  let port = Number(fallbackPort || 0) || null;
  if (!text) return { host: '', port };

  // Accept common copy/paste forms from NAS/Windows dialogs. The share and
  // path portions are handled separately by normalizeSmbLocation().
  text = text.replace(/^smb:\/\//i, '').replace(/^\\\\/, '').replace(/^\/\//, '');
  text = text.split(/[\\/]/, 1)[0];

  const bracketed = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (bracketed) {
    if (bracketed[2]) port = Number(bracketed[2]);
    return { host: bracketed[1], port };
  }
  if (net.isIP(text) !== 6) {
    const hostPort = text.match(/^(.+):(\d{1,5})$/);
    if (hostPort) {
      text = hostPort[1];
      port = Number(hostPort[2]);
    }
  }
  return { host: text, port };
}

function parseSmbLocation(input = {}, current = null) {
  const rawHost = String(input.host ?? current?.host ?? '').trim();
  const rawShare = String(input.share ?? current?.share_name ?? '').trim();
  const rawBasePath = String(input.basePath ?? current?.base_path ?? '').trim();
  const rawPort = input.port ?? current?.port ?? 445;

  let source = rawHost;
  let share = rawShare;
  let basePath = rawBasePath;
  if (/^(?:smb:\/\/|\\\\|\/\/)/i.test(rawShare)) source = rawShare;

  const normalized = source.replace(/^smb:\/\//i, '').replace(/^\\\\/, '').replace(/^\/\//, '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const authority = parts.shift() || rawHost;
  const parsed = parseHostAndPort(authority, rawPort);

  if (/^(?:smb:\/\/|\\\\|\/\/)/i.test(source)) {
    if (!share && parts.length) share = parts.shift();
    else if (source === rawShare && parts.length) share = parts.shift();
    if ((!basePath || basePath === 'TMP-Camera') && parts.length) basePath = parts.join('/');
  }

  // Also accept "share/folder" in the share field when no explicit folder was
  // supplied. Synology users commonly copy this form from File Station.
  if (share && /[\\/]/.test(share)) {
    const shareParts = share.replace(/\\/g, '/').split('/').filter(Boolean);
    if (shareParts.length) {
      share = shareParts.shift();
      if ((!basePath || basePath === 'TMP-Camera') && shareParts.length) basePath = shareParts.join('/');
    }
  }

  return { host: parsed.host || rawHost, port: parsed.port || Number(rawPort) || 445, share, basePath };
}

function pathParts(value, { allowAbsolute = false } = {}) {
  let text = String(value ?? '').trim().replace(/\\/g, '/');
  const absolute = allowAbsolute && text.startsWith('/');
  text = text.replace(/^\/+|\/+$/g, '');
  if (!text) return { absolute, parts: [] };
  if (containsUnsafeControl(text) || /[";|&<>`]/.test(text)) throw new AppError(400, 'NETWORK_STORAGE_PATH_INVALID', 'Der Zielpfad enthaelt unzulaessige Zeichen.');
  const parts = text.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || part.length > 255)) {
    throw new AppError(400, 'NETWORK_STORAGE_PATH_INVALID', 'Der Zielpfad ist ungueltig.');
  }
  return { absolute, parts };
}

function normalizeBasePath(value, protocol) {
  const parsed = pathParts(value, { allowAbsolute: protocol === 'sftp' });
  const joined = parsed.parts.join('/');
  if (!joined) throw new AppError(400, 'NETWORK_STORAGE_PATH_INVALID', 'Ein Zielordner ist erforderlich.');
  return parsed.absolute ? `/${joined}` : joined;
}

function normalizeProfileInput(input = {}, current = null) {
  const protocol = asText(input.protocol || current?.protocol || 'smb').toLowerCase();
  if (!SUPPORTED_PROTOCOLS.has(protocol)) throw new AppError(400, 'NETWORK_STORAGE_PROTOCOL_UNSUPPORTED', 'Dieses Speicherprotokoll wird nicht unterstuetzt.');
  const smbLocation = protocol === 'smb' ? parseSmbLocation(input, current) : null;
  const host = validateHost(protocol === 'smb' ? smbLocation.host : (input.host || current?.host));
  const port = Number(protocol === 'smb' ? smbLocation.port : (input.port || current?.port || 22));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError(400, 'NETWORK_STORAGE_INVALID', 'Port ist ungueltig.');
  const share = protocol === 'smb'
    ? validateSimple(smbLocation.share, { required: true, max: 160, field: 'SMB-Freigabe', allowSpaces: true })
    : '';
  if (protocol === 'smb' && /[\\/";|&<>`]/.test(share)) throw new AppError(400, 'NETWORK_STORAGE_INVALID', 'SMB-Freigabe ist ungueltig.');
  const basePath = normalizeBasePath(protocol === 'smb' ? (smbLocation.basePath || 'TMP-Camera') : (input.basePath ?? current?.base_path ?? '/TMP-Camera'), protocol);
  let username = validateSimple(input.username ?? current?.username, { required: protocol === 'sftp', max: 320, field: 'Benutzername' });
  let domain = protocol === 'smb' ? validateSimple(input.domain ?? current?.domain_name, { max: 160, field: 'Domaene' }) : '';
  if (protocol === 'smb' && !domain) {
    const domainUser = username.match(/^([^\\/]+)[\\/]([^\\/]+)$/);
    if (domainUser) { domain = domainUser[1]; username = domainUser[2]; }
  }
  const hostKeyPolicy = protocol === 'sftp' && String(input.hostKeyPolicy || current?.host_key_policy || 'accept-new') === 'strict' ? 'strict' : 'accept-new';
  const suppliedPassword = typeof input.password === 'string' ? input.password : '';
  if (containsUnsafeControl(suppliedPassword)) throw new AppError(400, 'NETWORK_STORAGE_INVALID', 'Kennwort enthaelt unzulaessige Steuerzeichen.');
  const passwordEnc = suppliedPassword.length ? encryptSecret(suppliedPassword) : (current?.password_enc || null);
  if (protocol === 'sftp' && !passwordEnc) throw new AppError(400, 'NETWORK_STORAGE_INVALID', 'Fuer SFTP ist ein Kennwort erforderlich.');
  return { protocol, host, port, share, basePath, username, domain, hostKeyPolicy, passwordEnc };
}

function commandOutput(error) {
  return `${error?.stderr || ''}\n${error?.stdout || ''}\n${error?.message || ''}`.toLowerCase();
}

function commandError(error, protocol) {
  if (error instanceof AppError) return error;
  if (error?.code === 'ENOENT') return new AppError(500, 'NETWORK_STORAGE_CLIENT_MISSING', `Der ${protocol.toUpperCase()}-Client ist im Backend nicht verfuegbar.`);
  if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') return new AppError(504, 'NETWORK_STORAGE_TIMEOUT', 'Zeitueberschreitung beim Zugriff auf den Netzwerkspeicher.');
  const output = commandOutput(error);
  if (/nt_status_object_name_not_found|nt_status_no_such_file|no such file/.test(output)) {
    return new AppError(404, 'NETWORK_STORAGE_REMOTE_NOT_FOUND', 'Remote-Datei wurde nicht gefunden.');
  }
  if (/logon failure|nt_status_logon_failure|authentication failed|invalid password|login failed/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_AUTH_FAILED', 'Anmeldung am Netzwerkspeicher fehlgeschlagen.');
  }
  if (/permission denied|access denied|nt_status_access_denied/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_PERMISSION_DENIED', 'Der Benutzer hat nicht die erforderlichen Rechte auf dem Netzwerkspeicher.');
  }
  if (/host key verification failed|connection refused|connection timed out|no route to host|could not resolve|name or service not known|network is unreachable|connection closed|connection reset|failed to connect|nt_status_host_unreachable|nt_status_connection/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_CONNECTION_FAILED', 'Netzwerkspeicher ist nicht erreichbar.');
  }
  return new AppError(422, 'NETWORK_STORAGE_CONNECTION_FAILED', 'Zugriff auf den Netzwerkspeicher ist fehlgeschlagen.');
}

function isSmbProtocolNegotiationFailure(error) {
  const output = commandOutput(error);
  return /protocol negotiation failed|nt_status_invalid_network_response|nt_status_not_supported|nt_status_invalid_parameter_mix|server does not support|protocol not supported/.test(output);
}

async function probeTcp(host, port, timeoutMs = 3500) {
  let address = String(host || '');
  try {
    if (!net.isIP(address)) address = (await dns.lookup(address)).address;
  } catch {
    return { resolved: false, reachable: false, address: null };
  }
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port: Number(port) });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ resolved: true, reachable, address });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function smbCommandError(error, profile) {
  if (error instanceof AppError) return error;
  if (error?.code === 'ENOENT') return new AppError(500, 'NETWORK_STORAGE_CLIENT_MISSING', 'Der SMB-Client ist im Backend nicht verfuegbar.');
  if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') return new AppError(504, 'NETWORK_STORAGE_TIMEOUT', 'Zeitueberschreitung beim Zugriff auf den SMB-Server.');
  const output = commandOutput(error);
  if (/nt_status_bad_network_name|nt_status_no_such_device|tree connect failed.*bad_network_name/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_SHARE_NOT_FOUND', 'Die SMB-Freigabe wurde auf dem Server nicht gefunden.');
  }
  if (/logon failure|nt_status_logon_failure|authentication failed|invalid password|login failed/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_AUTH_FAILED', 'Anmeldung am SMB-Server fehlgeschlagen.');
  }
  if (/permission denied|access denied|nt_status_access_denied|nt_status_privilege_not_held/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_PERMISSION_DENIED', 'Der SMB-Benutzer hat nicht die erforderlichen Rechte.');
  }
  if (/nt_status_object_path_not_found|nt_status_object_name_not_found|nt_status_no_such_file|no such file/.test(output)) {
    return new AppError(404, 'NETWORK_STORAGE_REMOTE_NOT_FOUND', 'Der angegebene SMB-Pfad wurde nicht gefunden.');
  }
  if (isSmbProtocolNegotiationFailure(error)) {
    return new AppError(422, 'NETWORK_STORAGE_PROTOCOL_FAILED', 'SMB2/SMB3-Protokollverhandlung ist fehlgeschlagen.');
  }
  if (/could not resolve|name or service not known|temporary failure in name resolution|nt_status_bad_network_name.*name resolution/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_HOST_UNRESOLVED', 'Der SMB-Servername konnte nicht aufgeloest werden.');
  }
  const probe = await probeTcp(profile.host, profile.port);
  if (!probe.resolved) return new AppError(422, 'NETWORK_STORAGE_HOST_UNRESOLVED', 'Der SMB-Servername konnte nicht aufgeloest werden.');
  if (!probe.reachable) return new AppError(422, 'NETWORK_STORAGE_PORT_UNREACHABLE', 'Der konfigurierte SMB-Port ist aus dem Backend nicht erreichbar.');
  if (/connection refused|connection timed out|no route to host|network is unreachable|connection closed|connection reset|failed to connect|nt_status_host_unreachable|nt_status_connection|nt_status_io_timeout/.test(output)) {
    return new AppError(422, 'NETWORK_STORAGE_CONNECTION_FAILED', 'Die SMB-Verbindung wurde unterbrochen oder vom Server abgewiesen.');
  }
  return new AppError(422, 'NETWORK_STORAGE_SMB_FAILED', 'Der SMB-Server ist erreichbar, die angeforderte SMB-Operation ist jedoch fehlgeschlagen.');
}

function escapeCommandPath(value) {
  const text = String(value || '');
  if (containsUnsafeControl(text) || /[";]/.test(text)) throw new AppError(400, 'NETWORK_STORAGE_PATH_INVALID', 'Der Zielpfad ist ungueltig.');
  return text.replace(/\\/g, '/');
}

async function withTempFile(prefix, content, fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const file = path.join(dir, 'file');
  try {
    await fs.promises.writeFile(file, content, { mode: 0o600 });
    return await fn(file, dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function smbAuthFile(profile, fn) {
  const password = profile.password_enc ? decryptSecret(profile.password_enc) : '';
  if (!profile.username && !password) return fn(null, true);
  const lines = [`username = ${profile.username || ''}`, `password = ${password}`];
  if (profile.domain_name) lines.push(`domain = ${profile.domain_name}`);
  lines.push('');
  return withTempFile('tmp-camera-smb-auth', lines.join('\n'), (file) => fn(file, false));
}

async function smbResolvedIpv4(host) {
  if (net.isIP(host) === 4) return host;
  if (net.isIP(host)) return null;
  try {
    const result = await dns.lookup(host, { family: 4 });
    return result?.address || null;
  } catch { return null; }
}

function smbArgs(profile, command, { authFile = null, guest = false, maxProtocol = 'SMB3', ipAddress = null } = {}) {
  const args = [`//${profile.host}/${profile.share_name}`];
  if (guest) args.push('-N');
  else args.push('-A', authFile);
  args.push('-p', String(profile.port), '--use-kerberos=off', '-m', maxProtocol, '--option=client min protocol=SMB2_02');
  if (ipAddress) args.push('-I', ipAddress);
  args.push('-c', command);
  return args;
}

async function runSmb(profile, command, { timeout = COMMAND_TIMEOUT_MS } = {}) {
  return smbAuthFile(profile, async (authFile, guest) => {
    const ipAddress = await smbResolvedIpv4(profile.host);
    let firstError = null;
    for (const maxProtocol of ['SMB3', 'SMB2']) {
      try {
        return await execFile('smbclient', smbArgs(profile, command, { authFile, guest, maxProtocol, ipAddress }), {
          timeout, maxBuffer: 1024 * 1024, windowsHide: true,
        });
      } catch (error) {
        firstError ||= error;
        if (maxProtocol === 'SMB3' && isSmbProtocolNegotiationFailure(error)) continue;
        throw await smbCommandError(error, profile);
      }
    }
    throw await smbCommandError(firstError, profile);
  });
}

function sftpTargetArgs(profile, batchFile) {
  return [
    '-e', 'sftp',
    '-b', batchFile,
    '-P', String(profile.port),
    '-o', `User=${profile.username}`,
    '-o', 'BatchMode=no',
    '-o', 'PasswordAuthentication=yes',
    '-o', `UserKnownHostsFile=${KNOWN_HOSTS_FILE}`,
    '-o', `StrictHostKeyChecking=${profile.host_key_policy === 'strict' ? 'yes' : 'accept-new'}`,
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=2',
    profile.host,
  ];
}

async function runSftp(profile, commands, { timeout = COMMAND_TIMEOUT_MS } = {}) {
  const password = profile.password_enc ? decryptSecret(profile.password_enc) : '';
  return withTempFile('tmp-camera-sftp-batch', `${commands.join('\n')}\n`, async (batchFile) => {
    try {
      return await execFile('sshpass', sftpTargetArgs(profile, batchFile), {
        env: { ...process.env, SSHPASS: password }, timeout, maxBuffer: 1024 * 1024, windowsHide: true,
      });
    } catch (error) { throw commandError(error, 'sftp'); }
  });
}

function parentPaths(remotePath) {
  const normalized = escapeCommandPath(remotePath);
  const absolute = normalized.startsWith('/');
  const parts = normalized.replace(/^\/+/, '').split('/').filter(Boolean);
  parts.pop();
  const result = [];
  let current = absolute ? '' : '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    result.push(absolute ? `/${current}` : current);
  }
  return result;
}

async function smbUpload(profile, localPath, remotePath) {
  const safeRemote = escapeCommandPath(remotePath);
  for (const dir of parentPaths(safeRemote)) {
    try { await runSmb(profile, `mkdir "${dir}"`); } catch { /* put reports real permission/connectivity failures */ }
  }
  await runSmb(profile, `put "${escapeCommandPath(localPath)}" "${safeRemote}"`, { timeout: Math.max(COMMAND_TIMEOUT_MS, 120000) });
}

async function smbDownload(profile, remotePath, localPath) {
  await runSmb(profile, `get "${escapeCommandPath(remotePath)}" "${escapeCommandPath(localPath)}"`, { timeout: Math.max(COMMAND_TIMEOUT_MS, 120000) });
}

async function smbDelete(profile, remotePath) {
  try {
    await runSmb(profile, `del "${escapeCommandPath(remotePath)}"`);
  } catch (error) {
    if (error?.code === 'NETWORK_STORAGE_REMOTE_NOT_FOUND') return;
    throw error;
  }
}

async function smbRemoteSize(profile, remotePath) {
  try {
    const result = await runSmb(profile, `allinfo "${escapeCommandPath(remotePath)}"`);
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const stream = output.match(/stream:\s*\[::\$DATA\],\s*(\d+)\s+bytes/i);
    if (stream) return Number(stream[1]);
    const size = output.match(/(?:^|\n)\s*size\s*:\s*(\d+)\s*(?:\n|$)/i);
    if (size) return Number(size[1]);
    throw new AppError(502, 'NETWORK_STORAGE_VERIFY_FAILED', 'Remote-Dateigroesse konnte nicht bestimmt werden.');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw await smbCommandError(error, profile);
  }
}

async function sftpUpload(profile, localPath, remotePath) {
  const safeRemote = escapeCommandPath(remotePath);
  const commands = parentPaths(safeRemote).map((dir) => `-mkdir "${dir}"`);
  commands.push(`put "${escapeCommandPath(localPath)}" "${safeRemote}"`);
  await runSftp(profile, commands, { timeout: Math.max(COMMAND_TIMEOUT_MS, 120000) });
}

async function sftpDownload(profile, remotePath, localPath) {
  await runSftp(profile, [`get "${escapeCommandPath(remotePath)}" "${escapeCommandPath(localPath)}"`], { timeout: Math.max(COMMAND_TIMEOUT_MS, 120000) });
}

async function sftpDelete(profile, remotePath) {
  await runSftp(profile, [`-rm "${escapeCommandPath(remotePath)}"`]);
}

async function sftpRemoteSize(profile, remotePath) {
  const result = await runSftp(profile, [`ls -ln "${escapeCommandPath(remotePath)}"`]);
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    if (!/^[-dlcbps]/.test(line)) continue;
    const fields = line.split(/\s+/);
    if (fields.length >= 5 && /^\d+$/.test(fields[4])) return Number(fields[4]);
  }
  throw new AppError(502, 'NETWORK_STORAGE_VERIFY_FAILED', 'Remote-Dateigroesse konnte nicht bestimmt werden.');
}

async function remoteSize(profile, remotePath) {
  if (profile.protocol === 'smb') return smbRemoteSize(profile, remotePath);
  if (profile.protocol === 'sftp') return sftpRemoteSize(profile, remotePath);
  throw new AppError(400, 'NETWORK_STORAGE_PROTOCOL_UNSUPPORTED', 'Speicherprotokoll wird nicht unterstuetzt.');
}

async function verifyRemoteFile(profile, remotePath, expectedBytes) {
  const actualBytes = await remoteSize(profile, remotePath);
  const expected = Number(expectedBytes || 0);
  if (actualBytes <= 0 || (expected > 0 && actualBytes !== expected)) {
    throw new AppError(502, 'NETWORK_STORAGE_VERIFY_FAILED', 'Remote-Aufnahmeblock hat nicht die erwartete Dateigroesse.');
  }
  return actualBytes;
}

async function moveRemote(profile, fromPath, toPath) {
  if (profile.protocol === 'smb') return runSmb(profile, `rename "${escapeCommandPath(fromPath)}" "${escapeCommandPath(toPath)}"`);
  if (profile.protocol === 'sftp') return runSftp(profile, [`rename "${escapeCommandPath(fromPath)}" "${escapeCommandPath(toPath)}"`]);
  throw new AppError(400, 'NETWORK_STORAGE_PROTOCOL_UNSUPPORTED', 'Speicherprotokoll wird nicht unterstuetzt.');
}

async function upload(profile, localPath, remotePath) {
  const temporaryPath = `${remotePath}.uploading-${crypto.randomUUID()}`;
  try {
    if (profile.protocol === 'smb') await smbUpload(profile, localPath, temporaryPath);
    else if (profile.protocol === 'sftp') await sftpUpload(profile, localPath, temporaryPath);
    else throw new AppError(400, 'NETWORK_STORAGE_PROTOCOL_UNSUPPORTED', 'Speicherprotokoll wird nicht unterstuetzt.');
    // A previous process may have completed the rename before it could update
    // SQLite. Replace that deterministic destination from the intact local copy.
    await removeRemote(profile, remotePath).catch((error) => {
      if (error?.code !== 'NETWORK_STORAGE_REMOTE_NOT_FOUND') throw error;
    });
    await moveRemote(profile, temporaryPath, remotePath);
  } catch (error) {
    await removeRemote(profile, temporaryPath).catch(() => {});
    throw error;
  }
}

async function download(profile, remotePath, localPath) {
  if (profile.protocol === 'smb') return smbDownload(profile, remotePath, localPath);
  if (profile.protocol === 'sftp') return sftpDownload(profile, remotePath, localPath);
  throw new AppError(400, 'NETWORK_STORAGE_PROTOCOL_UNSUPPORTED', 'Speicherprotokoll wird nicht unterstuetzt.');
}

async function removeRemote(profile, remotePath) {
  if (profile.protocol === 'smb') return smbDelete(profile, remotePath);
  if (profile.protocol === 'sftp') return sftpDelete(profile, remotePath);
  throw new AppError(400, 'NETWORK_STORAGE_PROTOCOL_UNSUPPORTED', 'Speicherprotokoll wird nicht unterstuetzt.');
}

function remotePathFor(profile, recordingId, segmentIndex, localPath) {
  const ext = path.extname(localPath || '') || '.ts';
  const base = String(profile.base_path || '').replace(/\/+$/g, '');
  const file = `${String(Number(segmentIndex) || 0).padStart(6, '0')}-${crypto.createHash('sha1').update(path.basename(localPath || 'segment')).digest('hex').slice(0, 10)}${ext}`;
  return `${base}/recording-${Number(recordingId)}/${file}`;
}

function purgeUnusedProfiles() {
  db.prepare(`DELETE FROM recording_storage_profiles
    WHERE active=0 AND id NOT IN (SELECT DISTINCT storage_profile_id FROM recording_segments WHERE storage_profile_id IS NOT NULL)`).run();
}

function counts() {
  const out = { local: 0, pending: 0, uploading: 0, remote: 0, upload_failed: 0 };
  for (const row of db.prepare('SELECT storage_state,COUNT(*) AS count FROM recording_segments GROUP BY storage_state').all()) {
    out[row.storage_state || 'local'] = Number(row.count || 0);
  }
  return out;
}

function syncVerifiedSegmentSize(segmentId, recordingId, verifiedBytes) {
  const bytes = Number(verifiedBytes || 0);
  if (!(bytes > 0)) return;
  const current = db.prepare('SELECT size_bytes FROM recording_segments WHERE id=?').get(segmentId);
  if (!current || Number(current.size_bytes || 0) === bytes) return;
  db.prepare('UPDATE recording_segments SET size_bytes=? WHERE id=?').run(bytes, segmentId);
  const total = db.prepare(`SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM recording_segments
    WHERE recording_id=? AND status IN ('ready','recovered')`).get(recordingId);
  db.prepare('UPDATE recordings SET file_size_bytes=? WHERE id=?').run(Number(total?.bytes || 0), recordingId);
}

async function ensureDirectories() {
  await fs.promises.mkdir(NETWORK_DIR, { recursive: true, mode: 0o750 });
  await fs.promises.mkdir(CACHE_DIR, { recursive: true, mode: 0o750 });
  try { await fs.promises.open(KNOWN_HOSTS_FILE, 'a', 0o600).then((handle) => handle.close()); } catch {}
  try { await fs.promises.chmod(KNOWN_HOSTS_FILE, 0o600); } catch {}
}

async function cleanupCache(protectPath = null) {
  let entries = [];
  try { entries = await fs.promises.readdir(CACHE_DIR, { withFileTypes: true }); } catch { return { removedParts: 0, removedBytes: 0 }; }
  const files = [];
  let total = 0;
  let removedParts = 0;
  let removedBytes = 0;
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(CACHE_DIR, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (entry.name.endsWith('.part')) {
        if (now - stat.mtimeMs >= STALE_CACHE_PART_MAX_AGE_MS && (!protectPath || path.resolve(filePath) !== path.resolve(protectPath))) {
          await fs.promises.rm(filePath, { force: true });
          removedParts += 1;
          removedBytes += stat.size;
        }
        continue;
      }
      total += stat.size;
      files.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  if (total > CACHE_MAX_BYTES) {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of files) {
      if (protectPath && path.resolve(file.filePath) === path.resolve(protectPath)) continue;
      await fs.promises.rm(file.filePath, { force: true }).catch(() => {});
      total -= file.size;
      removedBytes += file.size;
      if (total <= CACHE_MAX_BYTES) break;
    }
  }
  return { removedParts, removedBytes };
}

export class NetworkRecordingStorageService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.lastError = null;
    this.lastTransferAt = null;
    this.lastReconcileAt = null;
    this.lastReconcile = null;
  }

  settings() {
    const profile = activeProfileRow();
    return {
      mode: storageMode(),
      profile: publicProfile(profile),
      runtime: {
        counts: counts(),
        localSpool: config.recordingsDir,
        cacheDir: CACHE_DIR,
        cacheMaxBytes: CACHE_MAX_BYTES,
        lastError: this.lastError,
        lastTransferAt: this.lastTransferAt,
        lastReconcileAt: this.lastReconcileAt,
        lastReconcile: this.lastReconcile,
        workerRunning: Boolean(this.timer),
      },
    };
  }

  candidate(input = {}) {
    const current = activeProfileRow();
    return normalizeProfileInput(input, current);
  }

  async test(input = {}) {
    if (input.mode === 'local') return { ok: true, mode: 'local', path: config.recordingsDir };
    await ensureDirectories();
    const candidate = this.candidate(input);
    const profile = {
      protocol: candidate.protocol, host: candidate.host, port: candidate.port, share_name: candidate.share,
      base_path: candidate.basePath, username: candidate.username, password_enc: candidate.passwordEnc,
      domain_name: candidate.domain, host_key_policy: candidate.hostKeyPolicy,
    };
    const marker = `tmp-camera-storage-test-${crypto.randomUUID()}.txt`;
    const remotePath = `${String(profile.base_path).replace(/\/+$/g, '')}/${marker}`;
    const content = `TMP Camera Surveillance storage test ${crypto.randomUUID()}\n`;
    return withTempFile('tmp-camera-storage-test', content, async (source, dir) => {
      const downloaded = path.join(dir, 'downloaded');
      let uploaded = false;
      try {
        // Validate the SMB tree separately so a wrong Synology shared-folder
        // name is reported as such instead of looking like a port failure.
        if (profile.protocol === 'smb') await runSmb(profile, 'pwd');
        await upload(profile, source, remotePath);
        uploaded = true;
        await download(profile, remotePath, downloaded);
        const received = await fs.promises.readFile(downloaded, 'utf8');
        if (received !== content) throw new AppError(422, 'NETWORK_STORAGE_VERIFY_FAILED', 'Die Testdatei konnte nicht korrekt verifiziert werden.');
        return { ok: true, mode: 'network', protocol: profile.protocol, host: profile.host, port: profile.port };
      } finally {
        if (uploaded) await removeRemote(profile, remotePath).catch(() => {});
      }
    });
  }

  save(input = {}) {
    if (input.mode !== 'network') {
      setSetting('local');
      purgeUnusedProfiles();
      this.lastError = null;
      return this.settings();
    }
    const current = activeProfileRow();
    const candidate = normalizeProfileInput(input, current);
    const id = crypto.randomUUID();
    const now = nowIso();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE recording_storage_profiles SET active=0 WHERE active=1').run();
      db.prepare(`INSERT INTO recording_storage_profiles(
        id,protocol,host,port,share_name,base_path,username,password_enc,domain_name,host_key_policy,created_at,updated_at,active
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
        id, candidate.protocol, candidate.host, candidate.port, candidate.share || null, candidate.basePath,
        candidate.username, candidate.passwordEnc, candidate.domain, candidate.hostKeyPolicy, now, now,
      );
      setSetting('network');
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    purgeUnusedProfiles();
    this.lastError = null;
    return this.settings();
  }

  assignSegment(recordingId, segmentIndex, localPath) {
    if (storageMode() !== 'network') return false;
    const profile = activeProfileRow();
    if (!profile) return false;
    const remotePath = remotePathFor(profile, recordingId, segmentIndex, localPath);
    db.prepare(`UPDATE recording_segments SET storage_profile_id=?,remote_path=?,storage_state='pending',storage_error=NULL
      WHERE recording_id=? AND segment_index=?`).run(profile.id, remotePath, Number(recordingId), Number(segmentIndex));
    return true;
  }

  async reconcile({ limit = 2000 } = {}) {
    await ensureDirectories();
    const cache = await cleanupCache();
    const summary = { examined: 0, recoveredRemote: 0, localCopiesRemoved: 0, requeued: 0, missing: 0, cacheRemovedBytes: Number(cache?.removedBytes || 0), staleCacheParts: Number(cache?.removedParts || 0) };
    const rows = db.prepare(`SELECT * FROM recording_segments
      WHERE storage_profile_id IS NOT NULL AND remote_path IS NOT NULL
        AND storage_state IN ('pending','uploading','upload_failed','remote')
      ORDER BY id ASC LIMIT ?`).all(Math.max(1, Math.min(100000, Number(limit) || 2000)));
    for (const segment of rows) {
      summary.examined += 1;
      const profile = profileRow(segment.storage_profile_id);
      if (!profile) continue;
      const localPath = path.resolve(segment.file_path || '');
      const localExists = Boolean(localPath && fs.existsSync(localPath));
      const expectedBytes = Number(localExists ? fs.statSync(localPath).size : (segment.size_bytes || 0));
      if (segment.storage_state === 'remote') {
        if (!localExists) continue;
        try {
          const verifiedBytes = await verifyRemoteFile(profile, segment.remote_path, expectedBytes);
          syncVerifiedSegmentSize(segment.id, segment.recording_id, verifiedBytes);
          await fs.promises.rm(localPath, { force: true });
          summary.localCopiesRemoved += 1;
        } catch (error) {
          db.prepare("UPDATE recording_segments SET storage_state='pending',storage_error=? WHERE id=?")
            .run(error?.code || 'NETWORK_STORAGE_VERIFY_FAILED', segment.id);
          summary.requeued += 1;
        }
        continue;
      }
      if (!localExists) {
        try {
          await verifyRemoteFile(profile, segment.remote_path, expectedBytes);
          db.prepare("UPDATE recording_segments SET storage_state='remote',storage_error=NULL,remote_uploaded_at=COALESCE(remote_uploaded_at,?) WHERE id=?")
            .run(nowIso(), segment.id);
          summary.recoveredRemote += 1;
        } catch (error) {
          db.prepare("UPDATE recording_segments SET storage_state='upload_failed',storage_error='NETWORK_STORAGE_LOCAL_FILE_MISSING' WHERE id=?").run(segment.id);
          summary.missing += 1;
        }
      } else if (segment.storage_state === 'uploading') {
        try {
          const verifiedBytes = await verifyRemoteFile(profile, segment.remote_path, expectedBytes);
          syncVerifiedSegmentSize(segment.id, segment.recording_id, verifiedBytes);
          await fs.promises.rm(localPath, { force: true });
          db.prepare("UPDATE recording_segments SET storage_state='remote',storage_error=NULL,remote_uploaded_at=COALESCE(remote_uploaded_at,?) WHERE id=?")
            .run(nowIso(), segment.id);
          summary.recoveredRemote += 1;
          summary.localCopiesRemoved += 1;
        } catch {
          db.prepare("UPDATE recording_segments SET storage_state='pending',storage_error=NULL WHERE id=?").run(segment.id);
          summary.requeued += 1;
        }
      }
    }
    this.lastReconcileAt = nowIso();
    this.lastReconcile = summary;
    if (summary.recoveredRemote || summary.localCopiesRemoved || summary.requeued || summary.missing || summary.cacheRemovedBytes) {
      logger.info(summary, 'Aufnahmespeicher wurde mit Datenbank und Netzwerkspeicher abgeglichen');
    }
    return summary;
  }

  start() {
    if (this.timer) return;
    void ensureDirectories().catch((error) => logger.warn({ err: error }, 'Netzwerkspeicher-Verzeichnisse konnten nicht vorbereitet werden'));
    const tick = () => { void this.runWorker().catch((error) => logger.error({ err: error }, 'Netzwerkspeicher-Worker ist fehlgeschlagen')); };
    this.timer = setInterval(tick, WORKER_INTERVAL_MS);
    this.timer.unref?.();
    setTimeout(tick, 1500).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runWorker() {
    if (this.running) return;
    this.running = true;
    try {
      purgeUnusedProfiles();
      const rows = db.prepare(`SELECT s.* FROM recording_segments s
        JOIN recordings r ON r.id=s.recording_id
        LEFT JOIN recording_compression_jobs c ON c.recording_id=s.recording_id AND c.segment_index=s.segment_index
        WHERE s.storage_profile_id IS NOT NULL AND s.remote_path IS NOT NULL
          AND s.storage_state IN ('pending','uploading','upload_failed')
          AND s.status IN ('ready','recovered')
          AND r.status IN ('recording','ready','ready_with_gaps')
          AND (
            ?=0
            OR c.status IN ('completed','skipped','failed')
          )
        ORDER BY s.id ASC LIMIT 6`).all(
          config.recordingCompressionEnabled ? 1 : 0,
        );
      for (const segment of rows) await this.uploadSegment(segment);
    } finally { this.running = false; }
  }

  async uploadSegment(segment) {
    const profile = profileRow(segment.storage_profile_id);
    if (!profile) {
      db.prepare("UPDATE recording_segments SET storage_state='upload_failed',storage_error='NETWORK_STORAGE_PROFILE_MISSING' WHERE id=?").run(segment.id);
      this.lastError = 'NETWORK_STORAGE_PROFILE_MISSING';
      return false;
    }
    const localPath = path.resolve(segment.file_path || '');
    const localExists = Boolean(localPath && fs.existsSync(localPath));
    const expectedBytes = Number(localExists ? fs.statSync(localPath).size : (segment.size_bytes || 0));
    if (!localExists) {
      try {
        await verifyRemoteFile(profile, segment.remote_path, expectedBytes);
        const recoveredAt = nowIso();
        db.prepare("UPDATE recording_segments SET storage_state='remote',storage_error=NULL,remote_uploaded_at=COALESCE(remote_uploaded_at,?) WHERE id=?").run(recoveredAt, segment.id);
        this.lastError = null;
        this.lastTransferAt = recoveredAt;
        return true;
      } catch {
        db.prepare("UPDATE recording_segments SET storage_state='upload_failed',storage_error='NETWORK_STORAGE_LOCAL_FILE_MISSING' WHERE id=?").run(segment.id);
        this.lastError = 'NETWORK_STORAGE_LOCAL_FILE_MISSING';
        return false;
      }
    }
    db.prepare("UPDATE recording_segments SET storage_state='uploading',storage_error=NULL WHERE id=?").run(segment.id);
    try {
      let verifiedBytes = null;
      if (segment.storage_state === 'uploading') {
        try {
          verifiedBytes = await verifyRemoteFile(profile, segment.remote_path, expectedBytes);
        } catch { /* unfinished upload is replaced from the intact local spool */ }
      }
      if (!(verifiedBytes > 0)) {
        await upload(profile, localPath, segment.remote_path);
        verifiedBytes = await verifyRemoteFile(profile, segment.remote_path, expectedBytes);
      }
      syncVerifiedSegmentSize(segment.id, segment.recording_id, verifiedBytes);
      // Keep SQLite in the non-terminal 'uploading' state until the local copy
      // is actually gone. A crash anywhere before this point is recoverable:
      // startup reconciliation verifies the remote file before deleting/relabeling.
      try {
        await fs.promises.rm(localPath, { force: true });
      } catch (cleanupError) {
        db.prepare("UPDATE recording_segments SET storage_state='uploading',storage_error='NETWORK_STORAGE_LOCAL_CLEANUP_FAILED' WHERE id=?").run(segment.id);
        this.lastError = 'NETWORK_STORAGE_LOCAL_CLEANUP_FAILED';
        logger.warn({ recordingId: segment.recording_id, segmentIndex: segment.segment_index, err: cleanupError }, 'Lokale Aufnahme konnte nach verifiziertem Remote-Upload noch nicht entfernt werden');
        return false;
      }
      const uploadedAt = nowIso();
      db.prepare("UPDATE recording_segments SET storage_state='remote',storage_error=NULL,remote_uploaded_at=? WHERE id=?").run(uploadedAt, segment.id);
      this.lastError = null;
      this.lastTransferAt = uploadedAt;
      return true;
    } catch (error) {
      const mapped = commandError(error, profile.protocol);
      db.prepare("UPDATE recording_segments SET storage_state='upload_failed',storage_error=? WHERE id=?").run(mapped.code || 'NETWORK_STORAGE_CONNECTION_FAILED', segment.id);
      this.lastError = mapped.code || 'NETWORK_STORAGE_CONNECTION_FAILED';
      logger.warn({ recordingId: segment.recording_id, segmentIndex: segment.segment_index, code: this.lastError }, 'Aufnahmeblock konnte nicht auf den Netzwerkspeicher uebertragen werden');
      return false;
    }
  }

  async materializeSegment(segment) {
    const localPath = path.resolve(segment.file_path || '');
    if (localPath && fs.existsSync(localPath)) return { path: localPath, cached: false };
    if (!segment.storage_profile_id || !segment.remote_path) throw new AppError(404, 'RECORDING_BLOCK_MISSING', 'Aufnahmeblock ist nicht verfuegbar.');
    const profile = profileRow(segment.storage_profile_id);
    if (!profile) throw new AppError(503, 'NETWORK_STORAGE_PROFILE_MISSING', 'Speicherprofil der Aufnahme ist nicht mehr verfuegbar.');
    await ensureDirectories();
    const extension = path.extname(segment.remote_path) || '.ts';
    const key = crypto.createHash('sha256').update(`${segment.storage_profile_id}\0${segment.remote_path}`).digest('hex');
    const cachePath = path.join(CACHE_DIR, `${key}${extension}`);
    if (fs.existsSync(cachePath)) {
      fs.promises.utimes(cachePath, new Date(), new Date()).catch(() => {});
      return { path: cachePath, cached: true };
    }
    await cleanupCache(cachePath);
    const part = `${cachePath}.${crypto.randomUUID()}.part`;
    try {
      await download(profile, segment.remote_path, part);
      const stat = await fs.promises.stat(part);
      if (!stat.isFile() || stat.size <= 0 || (Number(segment.size_bytes || 0) > 0 && stat.size !== Number(segment.size_bytes))) {
        throw new AppError(502, 'NETWORK_STORAGE_VERIFY_FAILED', 'Remote-Aufnahmeblock konnte nicht verifiziert werden.');
      }
      await fs.promises.rename(part, cachePath);
      await cleanupCache(cachePath);
      return { path: cachePath, cached: true };
    } catch (error) {
      await fs.promises.rm(part, { force: true }).catch(() => {});
      throw commandError(error, profile.protocol);
    }
  }

  async deleteRemoteSegment(segment) {
    if (!segment?.storage_profile_id || !segment?.remote_path) return false;
    const profile = profileRow(segment.storage_profile_id);
    if (!profile) throw new AppError(503, 'NETWORK_STORAGE_PROFILE_MISSING', 'Speicherprofil der Aufnahme ist nicht mehr verfuegbar.');
    await removeRemote(profile, segment.remote_path);
    return true;
  }
}

export const networkRecordingStorageService = new NetworkRecordingStorageService();

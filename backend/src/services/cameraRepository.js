import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { decryptSecret, encryptSecret } from './credentialVault.js';
import { publicMediaSource } from './media/MediaSource.js';
import { cameraIdentityKeys, normalizeCameraIp, normalizeDeviceUid, normalizeMacAddress, normalizeSerialNumber } from './CameraIdentity.js';
import { normalizeMotionZone } from './recording/MotionZone.js';

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function publicCamera(row) {
  if (!row) return null;
  const capabilities = parseJson(row.capabilities, {});
  const connectionType = capabilities.connectionType || (capabilities.driver === 'direct-stream' ? 'stream' : capabilities.driver === 'onvif' ? 'onvif' : 'camera');
  return {
    id: row.id,
    name: row.name,
    location: row.location || '',
    status: row.status,
    enabled: Boolean(row.enabled),
    onvif: { ip: row.onvif_ip, port: row.onvif_port, xaddr: row.onvif_xaddr || null },
    preferredProfile: row.stream_profile || null,
    profilePolicy: row.profile_policy || 'auto',
    codecPreference: row.codec_preference || 'auto',
    sourcePolicy: row.source_policy || 'auto',
    connectionType,
    capabilities,
    rotation: row.rotation || 0,
    motionZone: normalizeMotionZone(parseJson(row.motion_zone, null)),
    macAddress: row.mac_address || null,
    deviceUid: row.device_uid || null,
    serialNumber: row.serial_number || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    lastError: row.last_error,
  };
}


function nextDefaultCameraName() {
  const rows = db.prepare('SELECT name FROM cameras').all();
  let max = 0;
  for (const row of rows) {
    const match = String(row.name || '').trim().match(/^(?:CAM|Kamera)-(\d+)$/i);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > max) max = value;
  }
  return `CAM-${max + 1}`;
}

function isDefaultCameraName(value) {
  return /^(?:CAM|Kamera)-(\d+)$/i.test(String(value || '').trim());
}

function cameraNameExists(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!name) return false;
  return Boolean(db.prepare('SELECT 1 FROM cameras WHERE lower(trim(name))=? LIMIT 1').get(name));
}

function resolveCreateCameraName(value) {
  const name = String(value || '').trim();
  if (!name) return nextDefaultCameraName();
  if (isDefaultCameraName(name) && cameraNameExists(name)) return nextDefaultCameraName();
  return name;
}

function normalizeCameraName(value) {
  const name = String(value || '').trim();
  return name || nextDefaultCameraName();
}

function withCredentials(row) {
  if (!row) return null;
  return {
    ...publicCamera(row),
    username: decryptSecret(row.username_enc),
    password: decryptSecret(row.password_enc),
  };
}

export const cameraRepository = {
  nextDefaultName() {
    return nextDefaultCameraName();
  },
  list() {
    return db.prepare('SELECT * FROM cameras ORDER BY name COLLATE NOCASE').all().map(publicCamera);
  },
  listEnabled() {
    return db.prepare('SELECT * FROM cameras WHERE enabled=1 ORDER BY name COLLATE NOCASE').all().map(publicCamera);
  },
  discoveryIdentities() {
    return db.prepare('SELECT id,name,onvif_ip,mac_address,device_uid,serial_number,capabilities FROM cameras').all().map((row) => {
      const camera = publicCamera(row);
      return {
        cameraId: row.id,
        name: row.name,
        ip: row.onvif_ip,
        keys: cameraIdentityKeys(camera),
      };
    });
  },
  findDiscoveryDuplicate(device) {
    // A camera is blocked as an existing device only when its network address
    // is already assigned. MAC addresses, serial numbers and device UUIDs can
    // be missing, cloned, reused by OEM firmware or shared by multi-channel
    // devices and therefore must not prevent adding another IP address.
    const ip = normalizeCameraIp(device?.ip || device?.onvif?.ip);
    if (!ip) return null;
    const row = db.prepare('SELECT * FROM cameras WHERE lower(trim(onvif_ip))=?').all(ip)
      .find((candidate) => publicCamera(candidate)?.connectionType !== 'stream');
    if (!row) return null;
    const camera = publicCamera(row);
    return {
      cameraId: row.id,
      name: row.name,
      ip: row.onvif_ip,
      keys: cameraIdentityKeys(camera),
      matchType: 'ip',
      matchKey: `ip:${ip}`,
    };
  },
  findStreamDuplicate(rawUrl, { excludeCameraId = null } = {}) {
    let url;
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      parsed.username = '';
      parsed.password = '';
      url = parsed.toString();
    } catch { return null; }
    const row = excludeCameraId
      ? db.prepare(`SELECT c.* FROM cameras c JOIN camera_media_sources s ON s.camera_id=c.id WHERE s.url=? AND c.id<>? LIMIT 1`).get(url, excludeCameraId)
      : db.prepare(`SELECT c.* FROM cameras c JOIN camera_media_sources s ON s.camera_id=c.id WHERE s.url=? LIMIT 1`).get(url);
    if (!row) return null;
    const camera = publicCamera(row);
    return { cameraId: row.id, name: row.name, url, connectionType: camera.connectionType, matchType: 'stream-url' };
  },
  get(id) {
    return publicCamera(db.prepare('SELECT * FROM cameras WHERE id=?').get(id));
  },
  getWithCredentials(id) {
    return withCredentials(db.prepare('SELECT * FROM cameras WHERE id=?').get(id));
  },
  create(input) {
    const id = input.id || crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO cameras(
        id,name,location,status,created_at,updated_at,onvif_ip,onvif_port,onvif_xaddr,
        stream_profile,username_enc,password_enc,capabilities,rotation,motion_zone,mac_address,device_uid,serial_number,enabled,profile_policy,codec_preference,source_policy
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, resolveCreateCameraName(input.name), input.location || '', 'activating', now, now, normalizeCameraIp(input.ip), input.port || 80,
      input.xaddr || null, input.preferredProfile || null, encryptSecret(input.username), encryptSecret(input.password),
      JSON.stringify(input.capabilities || {}), input.rotation || 0, input.motionZone ? JSON.stringify(normalizeMotionZone(input.motionZone)) : null, normalizeMacAddress(input.macAddress), normalizeDeviceUid(input.deviceUid), normalizeSerialNumber(input.serialNumber),
      1, input.profilePolicy || 'auto', input.codecPreference || 'auto', input.sourcePolicy || 'auto',
    );
    return this.get(id);
  },
  update(id, patch) {
    const current = db.prepare('SELECT * FROM cameras WHERE id=?').get(id);
    if (!current) return null;
    const fields = {
      name: patch.name === undefined ? current.name : normalizeCameraName(patch.name),
      location: patch.location ?? current.location,
      onvif_ip: patch.ip === undefined ? current.onvif_ip : normalizeCameraIp(patch.ip),
      onvif_port: patch.port ?? current.onvif_port,
      stream_profile: patch.preferredProfile === undefined ? current.stream_profile : (patch.preferredProfile || null),
      profile_policy: patch.profilePolicy ?? current.profile_policy,
      codec_preference: patch.codecPreference ?? current.codec_preference ?? 'auto',
      source_policy: patch.sourcePolicy ?? current.source_policy ?? 'auto',
      capabilities: patch.capabilities === undefined ? current.capabilities : JSON.stringify(patch.capabilities || {}),
      rotation: patch.rotation ?? current.rotation,
      motion_zone: patch.motionZone === undefined ? current.motion_zone : (patch.motionZone ? JSON.stringify(normalizeMotionZone(patch.motionZone)) : null),
      enabled: patch.enabled === undefined ? current.enabled : Number(Boolean(patch.enabled)),
      username_enc: patch.username === undefined ? current.username_enc : encryptSecret(patch.username),
      password_enc: patch.password === undefined ? current.password_enc : encryptSecret(patch.password),
      mac_address: patch.macAddress === undefined ? current.mac_address : normalizeMacAddress(patch.macAddress),
      device_uid: patch.deviceUid === undefined ? current.device_uid : normalizeDeviceUid(patch.deviceUid),
      serial_number: patch.serialNumber === undefined ? current.serial_number : normalizeSerialNumber(patch.serialNumber),
      updated_at: new Date().toISOString(),
    };
    db.prepare(`UPDATE cameras SET name=@name,location=@location,onvif_ip=@onvif_ip,onvif_port=@onvif_port,
      stream_profile=@stream_profile,profile_policy=@profile_policy,codec_preference=@codec_preference,source_policy=@source_policy,capabilities=@capabilities,rotation=@rotation,motion_zone=@motion_zone,enabled=@enabled,
      username_enc=@username_enc,password_enc=@password_enc,mac_address=@mac_address,device_uid=@device_uid,serial_number=@serial_number,updated_at=@updated_at WHERE id=@id`).run({ ...fields, id });
    return this.get(id);
  },
  remove(id) {
    return db.prepare('DELETE FROM cameras WHERE id=?').run(id).changes > 0;
  },
  updateStatus(id, status, error = null) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE cameras SET status=?, last_error=?, last_seen_at=CASE WHEN ?='online' THEN ? ELSE last_seen_at END, updated_at=? WHERE id=?`)
      .run(status, error, status, now, now, id);
  },
  replaceProfiles(cameraId, profiles) {
    const del = db.prepare('DELETE FROM camera_profiles WHERE camera_id=?');
    const insert = db.prepare(`INSERT INTO camera_profiles(camera_id,token,name,video_codec,video_profile,media_service,audio_codec,width,height,fps,bitrate,has_ptz,role,rank,last_verified_at)
      VALUES(@cameraId,@token,@name,@videoCodec,@videoProfile,@mediaService,@audioCodec,@width,@height,@fps,@bitrate,@hasPtz,@role,@rank,@verifiedAt)`);
    db.exec('BEGIN');
    try {
      del.run(cameraId);
      profiles.forEach((profile) => insert.run({ ...profile, videoProfile: profile.videoProfile || null, mediaService: profile.mediaService || 'auto', cameraId, hasPtz: Number(Boolean(profile.hasPtz)), verifiedAt: new Date().toISOString() }));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  },

  mediaSources(cameraId) {
    return db.prepare(`SELECT * FROM camera_media_sources WHERE camera_id=? ORDER BY priority ASC, id ASC`).all(cameraId).map(publicMediaSource);
  },
  replaceMediaSources(cameraId, sources = []) {
    const existing = new Map(db.prepare('SELECT id,last_status,last_error,last_verified_at,created_at FROM camera_media_sources WHERE camera_id=?').all(cameraId).map((row) => [Number(row.id), row]));
    const del = db.prepare('DELETE FROM camera_media_sources WHERE camera_id=?');
    const insert = db.prepare(`INSERT INTO camera_media_sources(id,camera_id,label,kind,url,priority,enabled,origin,last_status,last_error,last_verified_at,created_at,updated_at)
      VALUES(@id,@cameraId,@label,@kind,@url,@priority,@enabled,@origin,@lastStatus,@lastError,@lastVerifiedAt,@createdAt,@updatedAt)`);
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      del.run(cameraId);
      sources.forEach((source, index) => {
        const old = source.id ? existing.get(Number(source.id)) : null;
        insert.run({
          id: source.id ? Number(source.id) : null,
          cameraId,
          label: source.label || `Alternative Quelle ${index + 1}`,
          kind: source.kind || 'auto',
          url: source.url,
          priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : (index + 1) * 10,
          enabled: Number(source.enabled !== false),
          origin: source.origin || 'manual',
          lastStatus: old?.last_status || 'unknown',
          lastError: old?.last_error || null,
          lastVerifiedAt: old?.last_verified_at || null,
          createdAt: old?.created_at || now,
          updatedAt: now,
        });
      });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return this.mediaSources(cameraId);
  },
  updateMediaSourceStatus(id, status, error = null) {
    const now = new Date().toISOString();
    db.prepare('UPDATE camera_media_sources SET last_status=?,last_error=?,last_verified_at=?,updated_at=? WHERE id=?')
      .run(status, error, now, now, Number(id));
  },
  profiles(cameraId) {
    return db.prepare(`SELECT token,name,video_codec AS videoCodec,video_profile AS videoProfile,media_service AS mediaService,audio_codec AS audioCodec,width,height,fps,bitrate,
      has_ptz AS hasPtz,role,rank,last_verified_at AS lastVerifiedAt FROM camera_profiles WHERE camera_id=? ORDER BY rank`).all(cameraId)
      .map((profile) => ({ ...profile, hasPtz: Boolean(profile.hasPtz) }));
  },
};

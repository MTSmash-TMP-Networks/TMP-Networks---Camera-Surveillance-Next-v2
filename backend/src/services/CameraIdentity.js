function compact(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeMacAddress(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 12 || /^0{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g).join(':');
}

export function normalizeSerialNumber(value) {
  const normalized = compact(value).replace(/[^a-z0-9._-]/g, '');
  return normalized.length >= 4 ? normalized : null;
}

export function normalizeDeviceUid(value) {
  const normalized = compact(value)
    .replace(/^urn:uuid:/, '')
    .replace(/^uuid:/, '')
    .replace(/[^a-z0-9._:-]/g, '');
  return normalized.length >= 6 ? normalized : null;
}


export function normalizeCameraIp(value) {
  let normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  normalized = normalized.replace(/^https?:\/\//, '').split('/')[0];
  if (normalized.startsWith('[')) {
    const end = normalized.indexOf(']');
    if (end > 0) return normalized.slice(1, end);
  }
  const colonCount = (normalized.match(/:/g) || []).length;
  if (colonCount === 1) normalized = normalized.split(':')[0];
  return normalized || null;
}

export function deviceIdentityKeys(device = {}) {
  const keys = [];
  const mac = normalizeMacAddress(device.macAddress || device.mac_address);
  const uid = normalizeDeviceUid(device.deviceUid || device.device_uid || device.uuid || device.urn);
  const serial = normalizeSerialNumber(device.serialNumber || device.serial_number);
  if (mac) keys.push(`mac:${mac}`);
  if (uid) keys.push(`uid:${uid}`);
  if (serial) keys.push(`serial:${serial}`);
  return keys;
}

export function cameraIdentityKeys(camera = {}) {
  const capabilities = camera.capabilities || {};
  const device = capabilities.device || {};
  return deviceIdentityKeys({
    macAddress: camera.macAddress || device.macAddress,
    deviceUid: camera.deviceUid || device.deviceUid || device.hardwareId,
    serialNumber: camera.serialNumber || device.serialNumber,
  });
}

export function identityMatch(left, right) {
  const leftKeys = new Set(deviceIdentityKeys(left));
  return deviceIdentityKeys(right).some((key) => leftKeys.has(key));
}

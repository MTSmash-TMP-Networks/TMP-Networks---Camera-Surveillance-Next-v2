export function isDiscoveryRunning(job) {
  return job?.status === 'running';
}

export function discoveryDeviceKeys(device = {}) {
  const keys = [
    device.deviceUid && `uid:${device.deviceUid}`,
    device.uuid && `uuid:${device.uuid}`,
    device.urn && `urn:${device.urn}`,
    device.macAddress && `mac:${device.macAddress}`,
    device.ip && `ip-port:${device.ip}:${Number(device.port || 0)}`,
    device.ip && `ip:${device.ip}`,
  ];
  return [...new Set(keys.filter(Boolean).map((value) => String(value).trim().toLowerCase()))];
}

export function discoveryDeviceKey(device = {}) {
  return discoveryDeviceKeys(device)[0] || '';
}

function mergeDevice(previous = {}, device = {}) {
  return {
    ...previous,
    ...device,
    openPorts: [...new Set([...(previous.openPorts || []), ...(device.openPorts || [])])].sort((a, b) => a - b),
    discoveryMethods: [...new Set([...(previous.discoveryMethods || []), ...(device.discoveryMethods || [])])],
    evidences: [...new Set([...(previous.evidences || []), ...(device.evidences || [])])],
    verified: Boolean(previous.verified || device.verified),
    likelyCamera: Boolean(previous.likelyCamera || device.likelyCamera),
    onvifAvailable: Boolean(previous.onvifAvailable || device.onvifAvailable),
    confidence: Math.max(Number(previous.confidence || 0), Number(device.confidence || 0)),
  };
}

export function mergeDiscoveredDevices(current = [], incoming = []) {
  const devices = new Map();
  const aliases = new Map();

  for (const device of [...current, ...incoming]) {
    const keys = discoveryDeviceKeys(device);
    if (!keys.length) continue;
    const existingKey = keys.map((key) => aliases.get(key)).find(Boolean);
    const primaryKey = existingKey || keys[0];
    const merged = mergeDevice(devices.get(primaryKey), device);
    devices.set(primaryKey, merged);
    for (const key of discoveryDeviceKeys(merged)) aliases.set(key, primaryKey);
  }

  return [...devices.values()].sort((left, right) =>
    Number(right.confidence || 0) - Number(left.confidence || 0)
    || String(left.ip || '').localeCompare(String(right.ip || ''), undefined, { numeric: true })
  );
}

export function cameraSetupAvailability({ actionBusy = false, scanStartBusy = false, manualScanJob = null } = {}) {
  return {
    setupBusy: Boolean(actionBusy),
    manualSearchBusy: Boolean(scanStartBusy || isDiscoveryRunning(manualScanJob)),
  };
}

function endpointValue(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(endpointValue);
  if (typeof value === 'string') return /^(?:https?:\/\/|\/)/i.test(value.trim());
  if (typeof value !== 'object') return false;
  for (const key of ['XAddr', 'xAddr', 'xaddr', 'uri', 'Uri', 'URL', 'url']) {
    if (endpointValue(value[key])) return true;
  }
  return false;
}

export function cameraAdvertisesPtz(camera) {
  const caps = camera?.capabilities || {};
  if (caps.ptz === true || caps.panTilt === true || camera?.ptz?.supported === true) return true;
  return endpointValue(caps.PTZ)
    || endpointValue(caps.device?.capabilities?.PTZ)
    || endpointValue(caps.device?.capabilities?.ptz);
}

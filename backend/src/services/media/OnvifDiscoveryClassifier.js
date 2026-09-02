function flattenText(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (typeof value === 'object') return Object.values(value).flatMap(flattenText);
  return [String(value)];
}

export function classifyDiscoveredDevice(cam = {}, remoteInfo = {}) {
  const hostname = cam.hostname || remoteInfo?.address || null;
  const port = Number(cam.port || 80);
  const xaddr = cam.uri?.device || cam.xaddr || cam.XAddr || null;
  const haystack = [
    ...flattenText(cam.scopes),
    ...flattenText(cam.types),
    ...flattenText(cam.name),
    ...flattenText(cam.urn),
    ...flattenText(xaddr),
  ].join(' ').toLowerCase();

  const onvifSignal = /onvif/.test(haystack) || /\/onvif\//.test(String(xaddr || '').toLowerCase());
  // Do not trust generic words such as "camera", "imaging" or "PTZ". Gateways,
  // controllers and network appliances can expose those strings too. Only a
  // standard ONVIF video-device/profile marker is a positive WS-Discovery signal.
  const cameraSignal = /(?:network[_ -]?video[_ -]?(?:transmitter|encoder)|networkvideotransmitter|video[_ -]?encoder|videoencoder|onvif:\/\/www\.onvif\.org\/type\/(?:network_video_transmitter|video_encoder|nvt)|onvif:\/\/www\.onvif\.org\/profile\/streaming)/.test(haystack);
  const nonCameraSignal = /(printer|scanner|printdevice|router|accesspoint|wirelessaccesspoint|network switch|computer|workstation|nas|storage|gateway|managed switch)/.test(haystack);
  const deviceService = /\/onvif\/device_service(?:\b|\/|\?)/.test(String(xaddr || '').toLowerCase());
  const uidText = flattenText(cam.urn).join(' ');
  const deviceUid = uidText.match(/(?:urn:)?uuid:([a-z0-9-]{8,})/i)?.[1] || null;
  const likelyCamera = Boolean(hostname && onvifSignal && cameraSignal && !nonCameraSignal);

  return {
    likelyCamera,
    device: hostname ? {
      ip: hostname,
      port,
      xaddr,
      name: cam.name || hostname,
      verified: likelyCamera,
      onvifDiscoveryVerified: likelyCamera,
      evidence: cameraSignal ? 'ONVIF-Video-Gerätetyp' : deviceService ? 'Allgemeiner ONVIF Device Service' : 'Unbestätigt',
      deviceUid,
    } : null,
  };
}

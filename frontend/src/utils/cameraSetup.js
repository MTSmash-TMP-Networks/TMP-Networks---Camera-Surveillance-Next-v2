export function connectionModeForDiscoveredCamera(device = {}) {
  // Discovery happens before credentials are entered. A camera can therefore
  // advertise only generic video ports during the scan even though ONVIF becomes
  // available after authentication. Always try ONVIF first during the actual
  // setup and let the backend fall back to the generic driver only on a real
  // ONVIF failure.
  if (String(device.connectionType || '').toLowerCase() === 'stream') return 'stream';
  return 'auto';
}

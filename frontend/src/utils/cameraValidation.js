// Passive discovery metadata must never block an otherwise valid ONVIF camera setup.
// Do not normalize stream URLs, passwords or ONVIF profile tokens here.
const LIMITS = Object.freeze({
  manufacturer: 160, model: 180, serialNumber: 180, macAddress: 80,
  deviceUid: 240, discoveryEvidence: 4000,
});
const FIELD_LABELS = Object.freeze({
  name: 'Kameraname', location: 'Standort', ip: 'IP-Adresse', port: 'ONVIF-Port',
  xaddr: 'ONVIF-Adresse', username: 'Benutzername', password: 'Kennwort',
  preferredProfile: 'ONVIF-Profil', preferredSourceUrl: 'Stream-Adresse',
  mediaSources: 'Medienquellen', openPorts: 'Erkannte Ports',
  manufacturer: 'Hersteller', model: 'Modell', serialNumber: 'Seriennummer',
  macAddress: 'MAC-Adresse', deviceUid: 'Gerätekennung',
  discoveryEvidence: 'Erkennungsinformationen', connectionMode: 'Verbindungsart',
});

export function cameraSavePayload(form, name, direct = false) {
  const payload = { ...form, name, port: Number(form.port || 0) };
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = payload[field];
    if (value == null) continue;
    const text = typeof value === 'string' ? value : String(value);
    // An overlong UID must be omitted rather than silently truncated and
    // accidentally matched to another camera; identity also uses IP/MAC/serial.
    payload[field] = field === 'deviceUid' && text.length > max ? '' : text.slice(0, max);
  }
  if (direct) {
    payload.ip = '';
    payload.port = 0;
    payload.connectionMode = 'stream';
    payload.sourcePolicy = 'manual-first';
  }
  return payload;
}

export function cameraSetupError(error, locale = 'de') {
  if (error?.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details) || !error.details.length) {
    return error?.message || (locale === 'de' ? 'Kamera konnte nicht hinzugefügt werden.' : 'Could not add camera.');
  }
  const issues = error.details.slice(0, 5).map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path : [];
    const key = String(path[0] || 'input');
    const suffix = path.slice(1).map((part) => typeof part === 'number' ? `[${part + 1}]` : `.${part}`).join('');
    const field = `${FIELD_LABELS[key] || key}${suffix}`;
    let message = String(issue.message || 'ungültiger Wert');
    if (issue.code === 'too_big' && Number.isInteger(issue.maximum)) {
      message = locale === 'de' ? `maximal ${issue.maximum} Zeichen oder Einträge erlaubt` : `maximum ${issue.maximum} characters or entries`;
    }
    return `${field}: ${message}`;
  });
  const intro = locale === 'de' ? 'Kamera konnte nicht gespeichert werden. Bitte prüfen: ' : 'Camera could not be saved. Check: ';
  return intro + issues.join(' · ');
}

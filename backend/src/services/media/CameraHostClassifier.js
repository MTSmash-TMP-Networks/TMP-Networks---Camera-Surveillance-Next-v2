import { sanitizeAxisHints } from '../../axisEvidenceGuard.js';
import {
  CAMERA_RTSP_PORTS,
  CAMERA_WEB_PORTS,
  inferCameraPortSignature,
} from './CameraPortCatalog.js';

const CAMERA_IDENTITY_PATTERN = /\b(?:network\s+camera|ip\s+camera|internet\s+camera|security\s+camera|surveillance\s+camera|netzwerkkamera|ueberwachungskamera|überwachungskamera|network\s+video\s+(?:recorder|server|encoder|transmitter)|digital\s+video\s+recorder|video\s+encoder|camera\s+(?:login|viewer|live\s*view)|nvr\b|dvr\b|ipc\s+(?:camera|web|viewer)|deviceType[^<]{0,30}(?:IPCamera|NVR|DVR|VideoEncoder))\b/i;
const NON_CAMERA_DEVICE_PATTERN = /\b(?:router|routing|router\s+management|managed\s+switch|network\s+switch|ethernet\s+switch|switch\s+management|access\s+point|wireless\s+(?:access\s+point|controller|router)|firewall|security\s+gateway|internet\s+gateway|cable\s+modem|dsl\s+modem|print(?:er|\s+server)|network\s+storage|storage\s+manager|nas\b|pbx\b|voip\s+gateway|openwrt|luci|routeros|omada\s+(?:controller|gateway|switch)|unifi\s+(?:network|gateway|switch)|edgeos|airmax|pfsense|opnsense|fortigate|integrated\s+lights[- ]out|hpe?\s+iLO\b|iLO\s+[2-9]\b|integrated\s+remote\s+console|integrated\s+dell\s+remote\s+access|iDRAC\b|xclarity\s+controller|integrated\s+management\s+module|baseboard\s+management\s+controller|\bBMC\b|\bIPMI\b|supermicro[^\n]{0,80}(?:bmc|ipmi)|vmware\s+esxi|esxi\s+host\s+client|hypervisor\s+management)\b/i;
const MANAGEMENT_UI_PATTERN = /\b(?:tmp\s+router\s+management|tmp[-\s]?networks?\s+(?:router|management|camera\s+surveillance)|kamera(?:suche|verwaltung)|camera\s+surveillance\s+next|update[-\s]?center|systemstatus|router\s+management|network\s+management|managed\s+device)\b/i;

function cleanText(value, max = 180) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function pageText(pages = []) {
  return pages.map((page) => `${page?.headers?.server || ''}\n${page?.headers?.['www-authenticate'] || ''}\n${page?.headers?.location || ''}\n${page?.body || ''}`).join('\n');
}

/**
 * Kameraspezifische Beschreibung fuer SSDP, ONVIF und Web-Fingerprints.
 * Allgemeine Herstellernamen reichen absichtlich nicht als Kameranachweis.
 */
export function hasCameraIdentityText(value) {
  const text = String(value || '');
  return CAMERA_IDENTITY_PATTERN.test(text)
    || /\b(?:unifi\s+protect|vigi\s+(?:network\s+|ip\s+)?camera|reolink|foscam|ezviz|hilook|imou|amcrest|vivotek|xmeye|wisenet|synology\s+camera)\b/i.test(text)
    || /\b(?:RLC|IPC|DS-2CD|HWI-|HWT-|BC500|TC500|CC400W|UV-C|UVC-G[3-6])[-A-Z0-9]{1,32}\b/i.test(text);
}

function hasStrongCameraWebIdentity(text) {
  return /<title[^>]*>[^<]{0,100}(?:network\s+camera|ip\s+camera|security\s+camera|surveillance\s+camera|camera\s+login|nvr\b|dvr\b|video\s+encoder)[^<]{0,100}<\/title>/i.test(text)
    || /www-authenticate[^\n]{0,160}(?:camera|nvr|dvr|video)/i.test(text)
    || /<(?:h1|h2|legend)[^>]*>[^<]{0,100}(?:network\s+camera|ip\s+camera|camera\s+login|nvr\s+login|dvr\s+login|video\s+encoder)[^<]{0,100}<\/(?:h1|h2|legend)>/i.test(text)
    || /<form[^>]{0,200}(?:camera|nvr|dvr|video|liveview|live-view)[^>]{0,200}>/i.test(text)
    || /deviceType[^<]{0,30}(?:IPCamera|NVR|DVR|VideoEncoder)/i.test(text);
}

function endpointUrl(page) {
  return String(page?.url || '');
}

function cameraAuthChallenge(page, vendorPattern = null) {
  const status = Number(page?.statusCode || 0);
  if (![401, 403].includes(status)) return false;
  const auth = String(page?.headers?.['www-authenticate'] || '');
  if (!auth) return false;
  const genericCamera = /(?:camera|ipcam|ipc\b|dvr\b|nvr\b|video\s+(?:device|server|recorder)|onvif)/i.test(auth);
  return genericCamera || Boolean(vendorPattern && vendorPattern.test(auth));
}

function vendorEndpointEvidenceForPage(page) {
  const status = Number(page?.statusCode || 0);
  if (!status || status === 404) return null;
  const url = endpointUrl(page);
  const body = String(page?.body || '');
  const contentType = String(page?.headers?.['content-type'] || '');

  // Hikvision ISAPI. Generic XML containing Model/SerialNumber is deliberately
  // not enough: BMCs such as HPE iLO expose those fields as well.
  if (/\/ISAPI\/System\/deviceInfo/i.test(url)) {
    if (cameraAuthChallenge(page, /hikvision|hilook|ezviz/i)) {
      return { manufacturer: 'Hikvision', reason: 'Hikvision ISAPI Auth-Challenge' };
    }
    const deviceInfo = /<DeviceInfo\b/i.test(body);
    const hikvisionNamespace = /(?:hikvision|www\.hikvision\.com|ISAPI)/i.test(body);
    const videoType = /<deviceType>\s*(?:IPCamera|NVR|DVR|Encoder|Decoder|NetworkCamera)\s*<\/deviceType>/i.test(body);
    if (/(?:xml|json)/i.test(contentType) && deviceInfo && (hikvisionNamespace || videoType)) {
      return { manufacturer: 'Hikvision', reason: 'Hikvision ISAPI DeviceInfo' };
    }
    return null;
  }

  // Dahua/Amcrest/Imou magicBox. The real endpoint returns key=value data.
  // A web server merely echoing "magicBox.cgi" or generic XML is not evidence.
  if (/\/cgi-bin\/magicBox\.cgi/i.test(url)) {
    if (cameraAuthChallenge(page, /dahua|amcrest|imou/i)) {
      return { manufacturer: 'Dahua', reason: 'Dahua magicBox Auth-Challenge' };
    }
    const keyCount = [
      /(?:^|[\r\n])deviceType\s*=/im,
      /(?:^|[\r\n])serialNumber\s*=/im,
      /(?:^|[\r\n])softwareVersion\s*=/im,
      /(?:^|[\r\n])hardwareVersion\s*=/im,
      /(?:^|[\r\n])processor\s*=/im,
    ].filter((pattern) => pattern.test(body)).length;
    const cameraType = /(?:^|[\r\n])deviceType\s*=\s*(?:IPC|NVR|DVR|HCVR|XVR|NVR-|DHI-|DH-)/im.test(body)
      || /\b(?:Dahua|Amcrest|Imou)\b/i.test(body);
    if (keyCount >= 2 && cameraType) return { manufacturer: 'Dahua', reason: 'Dahua magicBox SystemInfo' };
    return null;
  }

  // Axis VAPIX property list.
  if (/\/axis-cgi\/param\.cgi/i.test(url)) {
    if (cameraAuthChallenge(page, /axis/i)) return sanitizeAxisHints({ manufacturer: 'Axis', reason: 'Axis VAPIX Auth-Challenge' });
    if (/root\.(?:Brand|Properties)\./i.test(body)
      && /(?:AXIS|ProdFullName|SerialNumber|Firmware\.Version)/i.test(body)) {
      return sanitizeAxisHints({ manufacturer: 'Axis', reason: 'Axis VAPIX Properties' });
    }
    return null;
  }

  // Foscam CGIProxy getDevInfo.
  if (/\/cgi-bin\/CGIProxy\.fcgi/i.test(url)) {
    if (cameraAuthChallenge(page, /foscam/i)) return { manufacturer: 'Foscam', reason: 'Foscam CGIProxy Auth-Challenge' };
    if (/<CGI_Result\b/i.test(body) && /<(?:productName|firmwareVer|serialNo|devName|model)>/i.test(body)) {
      return { manufacturer: 'Foscam', reason: 'Foscam CGIProxy DeviceInfo' };
    }
    return null;
  }

  // Reolink JSON API.
  if (/\/cgi-bin\/api\.cgi/i.test(url)) {
    if (cameraAuthChallenge(page, /reolink/i)) return { manufacturer: 'Reolink', reason: 'Reolink API Auth-Challenge' };
    if (/GetDevInfo/i.test(body) && /(?:"DevInfo"|"type"\s*:\s*"(?:IPC|NVR|DVR)|"model")/i.test(body)) {
      return { manufacturer: 'Reolink', reason: 'Reolink GetDevInfo API' };
    }
    return null;
  }

  // Uniview/UNV LAPI. Require an explicit video-device/vendor marker in addition
  // to DeviceInfo fields so generic management APIs cannot pass this probe.
  if (/\/LAPI\/V1\.0\/System\/DeviceInfo/i.test(url)) {
    if (cameraAuthChallenge(page, /uniview|\bUNV\b/i)) return { manufacturer: 'Uniview', reason: 'Uniview LAPI Auth-Challenge' };
    const deviceInfo = /(?:DeviceInfo|DeviceModel|DeviceType|SerialNumber)/i.test(body);
    const cameraMarker = /(?:Uniview|\bUNV\b|\bIPC\b|\bNVR\b|\bDVR\b|Network\s+Camera)/i.test(body);
    if (/(?:json|xml)/i.test(contentType) && deviceInfo && cameraMarker) {
      return { manufacturer: 'Uniview', reason: 'Uniview LAPI DeviceInfo' };
    }
    return null;
  }

  return null;
}

function findVendorEndpointEvidence(pages = []) {
  for (const page of pages) {
    const evidence = vendorEndpointEvidenceForPage(page);
    if (evidence) return evidence;
  }
  return null;
}

function inferVendor({ pages = [], openPorts = [] }) {
  const text = pageText(pages);
  const managementUi = MANAGEMENT_UI_PATTERN.test(text) || NON_CAMERA_DEVICE_PATTERN.test(text);
  const cameraIdentity = hasStrongCameraWebIdentity(text)
    || /\b(?:RLC|IPC|DS-2CD|HWI-|HWT-|BC500|TC500|CC400W|UV-C|UVC-G[3-6])[-A-Z0-9]{1,32}\b/i.test(text);
  const endpointEvidence = managementUi ? null : findVendorEndpointEvidence(pages);

  if (endpointEvidence) {
    return { ...endpointEvidence, confidence: 99, webFingerprint: true, endpointVerified: true };
  }

  // Manufacturer names in ordinary HTML are accepted only together with a
  // strong camera identity. Probe path names are intentionally not inspected
  // here because generic web servers often echo unknown request paths.
  if (!managementUi && ((/hikvision/i.test(text) && cameraIdentity)
      || /\b(?:DS-2CD|iDS-|HWI-|HWT-)\b/i.test(text))) return { manufacturer: 'Hikvision', confidence: 94, reason: 'Hikvision-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && (/(?:dahua|amcrest|imou)/i.test(text) && cameraIdentity)) return { manufacturer: 'Dahua', confidence: 94, reason: 'Dahua-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && (/axis communications/i.test(text) && cameraIdentity)) return sanitizeAxisHints({ manufacturer: 'Axis', confidence: 94, reason: 'Axis-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false });
  if (!managementUi && (/reolink/i.test(text) && cameraIdentity)) return { manufacturer: 'Reolink', confidence: 94, reason: 'Reolink-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && (/vivotek/i.test(text) && cameraIdentity)) return { manufacturer: 'Vivotek', confidence: 94, reason: 'Vivotek-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && (/foscam/i.test(text) && cameraIdentity)) return { manufacturer: 'Foscam', confidence: 94, reason: 'Foscam-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && (/(?:uniview|\bunv\b)/i.test(text) && cameraIdentity)) return { manufacturer: 'Uniview', confidence: 92, reason: 'Uniview-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && ((/\bvigi\b/i.test(text) && cameraIdentity)
      || (/\btapo\b/i.test(text) && cameraIdentity))) return { manufacturer: 'TP-Link', confidence: 92, reason: 'TP-Link VIGI/Tapo-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && (/(?:hanwha|wisenet|samsung techwin)/i.test(text) && cameraIdentity)) return { manufacturer: 'Hanwha', confidence: 92, reason: 'Hanwha/Wisenet-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && /bosch security|bosch video|rcp\+/i.test(text) && cameraIdentity) return { manufacturer: 'Bosch', confidence: 92, reason: 'Bosch-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && /unifi\s+protect|protect\s+camera|\bUV-?C[-A-Z0-9]*\b|\bUVC-G[3-6][-A-Z0-9]*\b/i.test(text)) return { manufacturer: 'Ubiquiti', confidence: 92, reason: 'Ubiquiti UniFi-Protect-Kameraidentitaet', webFingerprint: true, endpointVerified: false };
  if (!managementUi && /xmeye|xiongmai|hi351[068]|hisilicon|netsurveillance/i.test(text) && cameraIdentity) return { manufacturer: 'Xiongmai', confidence: 90, reason: 'Xiongmai/XMEye-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  if (!managementUi && /synology camera|bc500|tc500|cc400w/i.test(text)) return { manufacturer: 'Synology', confidence: 92, reason: 'Synology-Kameraidentitaet im Webinterface', webFingerprint: true, endpointVerified: false };
  const signature = inferCameraPortSignature(openPorts);
  return { ...signature, webFingerprint: false, endpointVerified: false };
}

export function extractCameraModelFromPages(pages, manufacturer) {
  const combined = pages.map((page) => `${page?.body || ''}`).join('\n');
  const title = combined.match(/<title[^>]*>([^<]{1,180})<\/title>/i)?.[1];
  if (/hikvision/i.test(manufacturer || '')) {
    const model = combined.match(/\b(?:DS|iDS|IPC|HWI|HWT|NVR|DVR)-[A-Z0-9][A-Z0-9-]{4,40}\b/i)?.[0];
    if (model) return model.toUpperCase();
  }
  if (/reolink/i.test(manufacturer || '')) {
    const model = combined.match(/\b(?:RLC|E1|DUO|TRACKMIX|ARGUS|CX|FE)-[A-Z0-9-]{1,32}\b/i)?.[0];
    if (model) return model.toUpperCase();
  }
  const normalizedTitle = cleanText(title || '', 120);
  // HTTP status/login titles such as "302 Found", "Login" or "Forbidden"
  // are not camera models. Keep a page title only when it contains an actual
  // camera/recorder identity. This avoids misleading names in discovery lists.
  return normalizedTitle && hasCameraIdentityText(normalizedTitle) ? normalizedTitle : null;
}

function responseMarker(page) {
  return `${page?.headers?.server || ''}\n${page?.headers?.['www-authenticate'] || ''}\n${page?.headers?.location || ''}\n${page?.body || ''}`;
}

// Only a structured ONVIF/SOAP response or camera-specific auth challenge
// confirms ONVIF. An open port (including 8000), a generic 401 and a regular
// web login page must never be accepted as an ONVIF device.
export function isConfirmedOnvifServicePage(page, nonCameraDevice = false) {
  const status = Number(page?.statusCode || 0);
  if (!/\/onvif\/device_service/i.test(page?.url || '') || [0, 404].includes(status)) return false;
  const contentType = String(page?.headers?.['content-type'] || '');
  const body = String(page?.body || '');
  const structuredSoap = /(?:application|text)\/(?:soap\+xml|xml)/i.test(contentType)
    && /(?:<[^>]*(?:Envelope|Fault|GetDeviceInformation|GetCapabilities|GetServices)|xmlns(?::\w+)?=["'][^"']*onvif|www\.onvif\.org\/ver)/i.test(body);
  if (structuredSoap) return !nonCameraDevice;
  if ([401, 403].includes(status)) {
    const auth = String(page?.headers?.['www-authenticate'] || '');
    return /(camera|dvr|nvr|reolink|hikvision|dahua|axis|vivotek|foscam|uniview|wisenet|onvif)/i.test(auth) && !nonCameraDevice;
  }
  return false;
}

export function classifyHostFingerprint({ openPorts = [], pages = [], rtspServices = [] } = {}) {
  const ports = [...new Set(openPorts.map(Number))];
  const portSignature = inferCameraPortSignature(ports);
  const vendor = inferVendor({ pages, openPorts: ports });
  const combined = pageText(pages);
  const managementUi = MANAGEMENT_UI_PATTERN.test(combined);
  const nonCameraDevice = NON_CAMERA_DEVICE_PATTERN.test(combined) || managementUi;
  const rawCameraPhrase = hasStrongCameraWebIdentity(combined);
  const cameraPhrase = rawCameraPhrase && !nonCameraDevice;
  const onvifEvidence = pages.some((page) => isConfirmedOnvifServicePage(page, nonCameraDevice));
  const vendorEndpoint = nonCameraDevice ? null : findVendorEndpointEvidence(pages);
  const vendorEndpointEvidence = Boolean(vendorEndpoint);
  const rtspConfirmed = rtspServices.filter((item) => item?.confirmed);
  const rtspEvidence = rtspConfirmed.length > 0;
  const rtspOpen = ports.some((port) => CAMERA_RTSP_PORTS.includes(port));
  const onlyGenericWebPorts = ports.length > 0 && ports.every((port) => CAMERA_WEB_PORTS.includes(port));
  const evidence = [];
  let confidence = 0;

  const webFingerprintEvidence = Boolean(vendor.webFingerprint && !nonCameraDevice);
  const cameraProtocolEvidence = Boolean(onvifEvidence || vendorEndpointEvidence);
  // A strong multi-port video signature is network evidence and must not be
  // invalidated by a generic HTML title such as "Login" or "Management".
  // In particular 80+554+1935+8080 and Hikvision's 80/443+554+7681+8000+8443
  // are decisive camera/video-appliance signatures even when RTSP auth blocks
  // the protocol handshake during discovery.
  const strongPortCombinationEvidence = Boolean(portSignature.strong && !onlyGenericWebPorts);

  if (webFingerprintEvidence) {
    confidence = Math.max(confidence, Number(vendor.confidence || 0));
    evidence.push(vendor.reason);
  } else if (strongPortCombinationEvidence) {
    confidence = Math.max(confidence, Number(portSignature.confidence || 0));
    evidence.push(portSignature.reason);
  }
  if (onvifEvidence) {
    confidence = Math.max(confidence, 94);
    evidence.push('ONVIF Device Service antwortet');
  }
  if (vendorEndpointEvidence) {
    confidence = Math.max(confidence, 96);
    evidence.push(vendorEndpoint?.reason || 'Hersteller-Kamera-API antwortet');
  }
  if (cameraPhrase) {
    confidence = Math.max(confidence, 78);
    evidence.push('Weboberflaeche bezeichnet das Geraet eindeutig als Kamera/Recorder');
  }
  if (rtspEvidence) {
    evidence.push(`RTSP-Protokoll auf Port ${rtspConfirmed.map((item) => item.port).join(', ')} bestaetigt`);
    // RTSP is a general streaming protocol also used by media servers, phones,
    // intercoms and test tools. It raises confidence only when an independent
    // camera-specific signal exists.
    if (webFingerprintEvidence || cameraPhrase || cameraProtocolEvidence || strongPortCombinationEvidence) {
      confidence = Math.max(confidence, strongPortCombinationEvidence
        ? Math.min(97, Number(portSignature.confidence || 0) + 8)
        : 82);
    }
  } else if (rtspOpen && strongPortCombinationEvidence) {
    confidence = Math.max(confidence, Number(portSignature.confidence || 0));
  }
  if (webFingerprintEvidence && rtspEvidence) confidence = 100;
  if (onvifEvidence && (rtspEvidence || webFingerprintEvidence)) confidence = 100;

  const hasCameraSpecificEvidence = Boolean(
    webFingerprintEvidence
    || cameraPhrase
    || cameraProtocolEvidence
    || strongPortCombinationEvidence,
  );
  const corroboratedPortEvidence = Boolean(strongPortCombinationEvidence && rtspEvidence);

  // Router, switch, gateway and management pages may mention cameras or expose
  // an RTSP proxy. Such a page is accepted only with a concrete camera protocol
  // or a corroborated vendor-port/RTSP combination.
  if (nonCameraDevice && !cameraProtocolEvidence && !corroboratedPortEvidence && !strongPortCombinationEvidence) {
    confidence = 0;
    evidence.length = 0;
  }

  // Reine Weboberflaechen sind bei Netzwerkscans viel zu unspezifisch. Auch ein
  // Kameraname im HTML reicht bei 80/443/8080/8888 allein nicht mehr. Bei einem
  // Web-only-Host muss ein echter ONVIF- oder Hersteller-API-Endpunkt antworten.
  // Damit verschwinden Router, NAS, Hypervisoren und andere Admin-UIs aus dem
  // Kamera-Setup, ohne Kameras mit konkreter Kamera-API auszuschliessen.
  if (onlyGenericWebPorts && !cameraProtocolEvidence) {
    confidence = 0;
    evidence.length = 0;
  }

  const likelyCamera = confidence >= 65 && Boolean(
    cameraProtocolEvidence
    || strongPortCombinationEvidence
    || (!onlyGenericWebPorts && (webFingerprintEvidence || cameraPhrase))
  );
  const candidate = likelyCamera;
  const verified = candidate && Boolean(
    webFingerprintEvidence
    || onvifEvidence
    || vendorEndpointEvidence
    || corroboratedPortEvidence,
  );

  return {
    candidate,
    likelyCamera,
    verified,
    confidence: candidate ? Math.min(100, Math.round(confidence)) : 0,
    manufacturer: candidate ? (vendorEndpoint?.manufacturer || vendor.manufacturer || portSignature.manufacturer || null) : null,
    evidence: [...new Set(evidence)].filter(Boolean),
    cameraPhrase,
    rawCameraPhrase,
    nonCameraDevice,
    managementUi,
    genericWebOnly: onlyGenericWebPorts && !cameraProtocolEvidence,
    onvifEvidence,
    vendorEndpointEvidence,
    cameraProtocolEvidence,
    strongPortCombinationEvidence,
    rtspOnly: rtspEvidence && !hasCameraSpecificEvidence,
    rtspConfirmed: rtspConfirmed.map((item) => item.port),
  };
}

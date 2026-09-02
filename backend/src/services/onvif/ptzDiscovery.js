import { parse as parseUrl } from 'node:url';
import { collapseSoapArrays, readOnvifValue } from './profileDiscovery.js';

const PTZ_NS = 'http://www.onvif.org/ver20/ptz/wsdl';

function escapeXmlText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function scalarText(value) {
  let current = value;
  while (Array.isArray(current) && current.length === 1) current = current[0];
  if (current && typeof current === 'object') {
    if (Object.prototype.hasOwnProperty.call(current, '_')) return scalarText(current._);
    for (const key of ['href', 'Href', 'XAddr', 'xAddr', 'xaddr', 'URL', 'url', 'Uri', 'uri', 'path']) {
      if (Object.prototype.hasOwnProperty.call(current, key)) return scalarText(current[key]);
    }
    return '';
  }
  return current === undefined || current === null ? '' : String(current).trim();
}

export function ptzServiceUrl(cam) {
  const direct = scalarText(cam?.uri?.ptz);
  if (direct) return direct;
  const capabilities = collapseSoapArrays(cam?.capabilities || {});
  const serviceValue = readOnvifValue(
    capabilities,
    'PTZ.XAddr',
    'PTZ.xAddr',
    'PTZ.xaddr',
    'ptz.XAddr',
    'ptz.xAddr',
    'ptz.xaddr',
    'Capabilities.PTZ.XAddr',
    'capabilities.PTZ.XAddr',
    'PTZ',
    'ptz',
  );
  const capabilityUrl = scalarText(serviceValue);
  if (capabilityUrl) return capabilityUrl;

  // node-onvif exposes GetServices as an array. Older TMP recovery code looked
  // for services.ptz and therefore missed a valid PTZ service on cameras that
  // completed the modern GetServices handshake without GetCapabilities.
  for (const service of Array.isArray(cam?.services) ? cam.services : []) {
    const namespace = scalarText(service?.namespace || service?.Namespace);
    if (!/(?:^|\/)onvif\.org\/ver\d+\/ptz\/wsdl(?:$|[/?#])/i.test(namespace)
      && !/www\.onvif\.org\/ver\d+\/ptz\/wsdl/i.test(namespace)
      && !/\/ptz\/wsdl/i.test(namespace)) continue;
    const address = scalarText(service?.XAddr || service?.xAddr || service?.xaddr || service?.url);
    if (address) return address;
  }
  return scalarText(cam?.services?.ptz?.XAddr) || scalarText(cam?.services?.PTZ?.XAddr);
}

export function ensurePtzServiceUri(cam) {
  const url = ptzServiceUrl(cam);
  if (!url || !cam) return null;
  if (!cam.uri || typeof cam.uri !== 'object') cam.uri = {};
  // node-onvif's _request() expects the legacy url.parse() shape and accesses
  // .path. A plain string would make PTZ SOAP requests target an undefined path.
  if (!cam.uri.ptz || typeof cam.uri.ptz === 'string') {
    try { cam.uri.ptz = parseUrl(url); } catch { cam.uri.ptz = { href: url, path: url }; }
  }
  return url;
}

function responsePayload(result) {
  return collapseSoapArrays(result?.data ?? result ?? {});
}

function xmlText(result) {
  return String(result?.xml || '');
}

export function hasPtzStatusResponse(result) {
  const payload = responsePayload(result);
  if (readOnvifValue(payload, 'getStatusResponse') !== undefined) return true;
  return /<(?:\w+:)?GetStatusResponse\b/i.test(xmlText(result));
}

function hasConfigurationValue(value) {
  if (Array.isArray(value)) return value.some(hasConfigurationValue);
  if (!value) return false;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

export function hasCompatiblePtzConfiguration(result) {
  const payload = responsePayload(result);
  const response = readOnvifValue(payload, 'getCompatibleConfigurationsResponse');
  if (response !== undefined) {
    const configurations = readOnvifValue(
      response,
      'PTZConfiguration',
      'PTZConfigurations',
      'Configurations',
      'Configuration',
    );
    if (hasConfigurationValue(configurations)) return true;
  }
  const xml = xmlText(result);
  return /<(?:\w+:)?GetCompatibleConfigurationsResponse\b[\s\S]*<(?:\w+:)?(?:PTZConfiguration|Configurations?)\b/i.test(xml);
}

export function hasPtzNodesResponse(result) {
  const payload = responsePayload(result);
  const response = readOnvifValue(payload, 'getNodesResponse');
  if (response !== undefined) {
    const nodes = readOnvifValue(response, 'PTZNode', 'Nodes', 'Node');
    if (hasConfigurationValue(nodes)) return true;
  }
  return /<(?:\w+:)?GetNodesResponse\b[\s\S]*<(?:\w+:)?(?:PTZNode|Nodes?|Node)\b/i.test(xmlText(result));
}

export function hasPtzConfigurationsResponse(result) {
  const payload = responsePayload(result);
  const response = readOnvifValue(payload, 'getConfigurationsResponse');
  if (response !== undefined) {
    const configurations = readOnvifValue(response, 'PTZConfiguration', 'Configurations', 'Configuration');
    if (hasConfigurationValue(configurations)) return true;
  }
  return /<(?:\w+:)?GetConfigurationsResponse\b[\s\S]*<(?:\w+:)?(?:PTZConfiguration|Configurations?|Configuration)\b/i.test(xmlText(result));
}

export function ptzServiceProbeOperations() {
  return [
    { kind: 'nodes', xml: `<GetNodes xmlns="${PTZ_NS}"/>` },
    { kind: 'configurations', xml: `<GetConfigurations xmlns="${PTZ_NS}"/>` },
  ];
}

export async function probePtzService(cam, { request } = {}) {
  if (typeof request !== 'function' || !ensurePtzServiceUri(cam)) return false;
  for (const operation of ptzServiceProbeOperations()) {
    try {
      const result = await request(cam, 'ptz', operation.xml);
      if (operation.kind === 'nodes' && hasPtzNodesResponse(result)) return true;
      if (operation.kind === 'configurations' && hasPtzConfigurationsResponse(result)) return true;
    } catch {
      // Service-level discovery is best effort. Some otherwise working cameras
      // expose PTZ but reject one of these optional read-only operations.
    }
  }
  return false;
}

function activeProfileToken(cam) {
  return scalarText(cam?.activeSource?.profileToken)
    || scalarText(cam?.defaultProfile?.$?.token)
    || scalarText(cam?.defaultProfile?.token);
}

function hasAdvertisedPtzState(cam) {
  if (!ensurePtzServiceUri(cam)) return false;
  const caps = collapseSoapArrays(cam?.capabilities || {});
  const advertised = readOnvifValue(caps, 'PTZ', 'ptz', 'Capabilities.PTZ', 'capabilities.PTZ');
  if (advertised && typeof advertised === 'object') return true;
  if (cam?.activeSource?.ptz) return true;
  if (cam?.defaultProfile?.PTZConfiguration || cam?.defaultProfile?.ptzConfiguration) return true;
  // node-onvif only populates uri.ptz after GetCapabilities/GetServices exposed
  // a PTZ endpoint. That advertised service is stronger evidence than a missing
  // PTZConfiguration field in one Media profile.
  return Boolean(scalarText(cam?.uri?.ptz));
}

export function ptzProbeOperations(profileToken) {
  const token = escapeXmlText(profileToken);
  return [
    {
      kind: 'status',
      xml: `<GetStatus xmlns="${PTZ_NS}"><ProfileToken>${token}</ProfileToken></GetStatus>`,
    },
    {
      kind: 'compatible-configurations',
      xml: `<GetCompatibleConfigurations xmlns="${PTZ_NS}"><ProfileToken>${token}</ProfileToken></GetCompatibleConfigurations>`,
    },
  ];
}

export async function probePtzProfile(cam, profileToken, { request } = {}) {
  if (!profileToken || typeof request !== 'function' || !ensurePtzServiceUri(cam)) return false;
  for (const operation of ptzProbeOperations(profileToken)) {
    try {
      const result = await request(cam, 'ptz', operation.xml);
      if (operation.kind === 'status' && hasPtzStatusResponse(result)) return true;
      if (operation.kind === 'compatible-configurations' && hasCompatiblePtzConfiguration(result)) return true;
    } catch {
      // PTZ-Funktionen sind herstellerabhaengig teilweise implementiert. Ein
      // fehlgeschlagener Read-only-Probe darf den restlichen Kamera-Setup nicht stoppen.
    }
  }
  return false;
}

export async function enrichProfilesWithPtzSupport(cam, profiles, { request } = {}) {
  const normalized = (profiles || []).map((profile) => ({ ...profile, hasPtz: Boolean(profile?.hasPtz) }));
  if (!normalized.length || !ensurePtzServiceUri(cam)) return normalized;

  // Fuer die Kamera-Capability und die spaetere PTZ-Steuerung reicht ein
  // bestaetigtes Profil. Sequentiell zu pruefen schont besonders kleine
  // Kamera-SoCs, die mehrere parallele SOAP-Anfragen schlecht verarbeiten.
  if (normalized.some((profile) => profile.hasPtz)) return normalized;
  if (typeof request === 'function') {
    for (const profile of normalized) {
      if (!profile.token) continue;
      if (await probePtzProfile(cam, profile.token, { request })) {
        profile.hasPtz = true;
        return normalized;
      }
    }

    // Several ONVIF cameras expose a valid PTZ service but omit the profile's
    // PTZConfiguration link. GetNodes/GetConfigurations prove the PTZ service
    // without moving the camera and allow us to recover the active profile.
    if (await probePtzService(cam, { request })) {
      const token = activeProfileToken(cam);
      const target = normalized.find((profile) => profile.token === token) || normalized[0];
      if (target) target.hasPtz = true;
      return normalized;
    }
  }

  // Last compatibility fallback: node-onvif obtains uri.ptz during its initial
  // GetCapabilities/GetServices handshake. Some devices reject the optional
  // read-only probes above yet accept normal PTZ commands. Preserve that valid
  // advertised capability instead of hiding PTZ from the UI entirely.
  if (hasAdvertisedPtzState(cam)) {
    const token = activeProfileToken(cam);
    const target = normalized.find((profile) => profile.token === token) || normalized[0];
    if (target) target.hasPtz = true;
  }
  return normalized;
}

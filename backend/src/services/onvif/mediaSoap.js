import {
  collapseSoapArrays,
  profilesFromSoap,
  readOnvifValue,
} from './profileDiscovery.js';

function escapeXmlText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function soapRequest(cam, service, operation) {
  return new Promise((resolve, reject) => {
    if (typeof cam?._request !== 'function' || typeof cam?._envelopeHeader !== 'function' || typeof cam?._envelopeFooter !== 'function') {
      reject(new Error('Die ONVIF-Bibliothek stellt keine direkte SOAP-Anfrage bereit'));
      return;
    }
    cam._request({
      service,
      body: `${cam._envelopeHeader()}${operation}${cam._envelopeFooter()}`,
    }, (error, data, xml) => error ? reject(error) : resolve({ data, xml }));
  });
}

export function availableMediaServices(cam) {
  return ['media', 'media2'].filter((service) => Boolean(cam?.uri?.[service]));
}

function getProfilesOperation(service) {
  if (service === 'media2') {
    return '<GetProfiles xmlns="http://www.onvif.org/ver20/media/wsdl"><Type>All</Type></GetProfiles>';
  }
  return '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>';
}

function getEncoderConfigurationsOperation(service) {
  const namespace = service === 'media2'
    ? 'http://www.onvif.org/ver20/media/wsdl'
    : 'http://www.onvif.org/ver10/media/wsdl';
  return `<GetVideoEncoderConfigurations xmlns="${namespace}"/>`;
}

export async function profilesForService(cam, service) {
  const profileResponse = await soapRequest(cam, service, getProfilesOperation(service));
  let encoderData = null;
  try {
    encoderData = (await soapRequest(cam, service, getEncoderConfigurationsOperation(service))).data;
  } catch {
    // Einige Kameras liefern die komplette Encoderkonfiguration bereits mit GetProfiles
    // oder implementieren GetVideoEncoderConfigurations nicht korrekt.
  }
  return profilesFromSoap(profileResponse.data, service, encoderData);
}

function resultUri(data, ...paths) {
  let raw = readOnvifValue(collapseSoapArrays(data), ...paths);
  while (Array.isArray(raw) && raw.length === 1) raw = raw[0];
  if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, '_')) raw = raw._;
  return raw === undefined || raw === null ? null : String(raw).trim() || null;
}

export function media2Protocol(protocol, stream = 'RTP-Unicast') {
  const normalized = String(protocol || 'RTSP').toUpperCase();
  if (normalized === 'HTTP') return 'RtspOverHttp';
  if (normalized === 'UDP') return stream === 'RTP-Multicast' ? 'RtspMulticast' : 'RtspUnicast';
  if (normalized === 'TCP') return 'RTSP';
  return normalized;
}

export async function streamUriForService(cam, service, profileToken, protocol, stream = 'RTP-Unicast') {
  const token = escapeXmlText(profileToken);
  if (service === 'media2') {
    const response = await soapRequest(cam, service,
      `<GetStreamUri xmlns="http://www.onvif.org/ver20/media/wsdl"><Protocol>${escapeXmlText(media2Protocol(protocol, stream))}</Protocol><ProfileToken>${token}</ProfileToken></GetStreamUri>`);
    return resultUri(response.data, 'getStreamUriResponse.uri', 'getStreamUriResponse.mediaUri.uri');
  }
  const response = await soapRequest(cam, service,
    `<GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl"><StreamSetup><Stream xmlns="http://www.onvif.org/ver10/schema">${escapeXmlText(stream)}</Stream><Transport xmlns="http://www.onvif.org/ver10/schema"><Protocol>${escapeXmlText(protocol || 'RTSP')}</Protocol></Transport></StreamSetup><ProfileToken>${token}</ProfileToken></GetStreamUri>`);
  return resultUri(response.data, 'getStreamUriResponse.mediaUri.uri', 'getStreamUriResponse.uri');
}

export async function snapshotUriForService(cam, service, profileToken) {
  const namespace = service === 'media2'
    ? 'http://www.onvif.org/ver20/media/wsdl'
    : 'http://www.onvif.org/ver10/media/wsdl';
  const response = await soapRequest(cam, service,
    `<GetSnapshotUri xmlns="${namespace}"><ProfileToken>${escapeXmlText(profileToken)}</ProfileToken></GetSnapshotUri>`);
  return service === 'media2'
    ? resultUri(response.data, 'getSnapshotUriResponse.uri', 'getSnapshotUriResponse.mediaUri.uri')
    : resultUri(response.data, 'getSnapshotUriResponse.mediaUri.uri', 'getSnapshotUriResponse.uri');
}

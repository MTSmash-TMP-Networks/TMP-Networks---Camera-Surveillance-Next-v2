import {
  CAMERA_RTSP_PORTS,
  CAMERA_VENDOR_PORTS,
  CAMERA_WEB_PORTS,
  inferCameraPortSignature,
} from './CameraPortCatalog.js';

export function applyFinalCameraDiscoveryPolicy(device = {}) {
  const openPorts = [...new Set((device.openPorts || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const methods = new Set(device.discoveryMethods || []);
  const portSignature = inferCameraPortSignature(openPorts);
  const onlyGenericWebPorts = openPorts.length > 0 && openPorts.every((port) => CAMERA_WEB_PORTS.includes(port));
  const hasCameraSpecificNetworkPort = openPorts.some((port) =>
    CAMERA_RTSP_PORTS.includes(port)
    || CAMERA_VENDOR_PORTS.includes(port)
    || [1935, 1936].includes(port));
  const strongPortSignature = Boolean(device.strongPortCombinationEvidence || portSignature.strong);
  const directProtocolEvidence = Boolean(device.directCameraProtocolEvidence || device.onvifHttpEvidence || device.vendorEndpointEvidence);
  const broadcastCameraEvidence = Boolean(device.sadpVerified || device.ssdpVerified || methods.has('sadp') || methods.has('ssdp'));
  const onvifVideoTypeEvidence = Boolean(device.onvifDiscoveryVerified);
  const rtspConfirmed = [...new Set((device.rtspConfirmed || []).map(Number).filter(Number.isInteger))];
  const explicitNonCamera = Boolean(device.nonCameraDevice);

  // Final gate: 80/443 or 443/8888 never become cameras just because a web page,
  // redirect, login screen or a generic WS-Discovery record exists. Conversely,
  // a strong multi-service video signature is accepted even if authentication
  // prevents RTSP from completing during discovery.
  const reliableCameraEvidence = Boolean(
    !explicitNonCamera
    && (directProtocolEvidence
    || broadcastCameraEvidence
    || strongPortSignature
    || (onvifVideoTypeEvidence && hasCameraSpecificNetworkPort)),
  );

  const weakCandidate = Boolean(
    !explicitNonCamera
    && !onlyGenericWebPorts
    && device.cameraCandidate
    && Number(device.confidence || 0) >= 45,
  );
  const likelyCamera = reliableCameraEvidence;
  const cameraCandidate = reliableCameraEvidence || weakCandidate;
  const verified = Boolean(
    !explicitNonCamera
    && (directProtocolEvidence
    || broadcastCameraEvidence
    || (onvifVideoTypeEvidence && hasCameraSpecificNetworkPort)
    || (strongPortSignature && rtspConfirmed.length > 0)),
  );
  const confidence = reliableCameraEvidence
    ? Math.max(Number(device.confidence || 0), Number(portSignature.confidence || 0), verified ? 86 : 65)
    : weakCandidate ? Number(device.confidence || 0) : 0;

  return {
    ...device,
    manufacturer: explicitNonCamera ? null : (device.manufacturer || null),
    openPorts,
    likelyCamera,
    cameraCandidate,
    verified,
    confidence: Math.min(100, Math.round(confidence)),
    strongPortCombinationEvidence: strongPortSignature,
    onvifAvailable: Boolean(!explicitNonCamera && (device.onvifHttpEvidence || (onvifVideoTypeEvidence && hasCameraSpecificNetworkPort))),
    rtspConfirmed,
    finalCameraEvidence: reliableCameraEvidence,
    explicitNonCamera,
    genericWebOnly: onlyGenericWebPorts && !directProtocolEvidence && !broadcastCameraEvidence,
  };
}

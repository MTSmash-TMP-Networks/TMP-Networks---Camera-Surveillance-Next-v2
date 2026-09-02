/*
 * TMP Camera Surveillance - ONVIF PTZ service evidence bridge
 *
 * Some ONVIF cameras advertise a valid PTZ service but omit the optional
 * PTZConfiguration element from Media/GetProfiles. The upstream onvif
 * compatibility object then leaves activeSource.ptz empty although PTZ is
 * available and movement commands work with the media profile token.
 *
 * This bridge does not move the camera. It only normalizes authoritative
 * service/profile evidence already returned by the camera.
 */
'use strict';

const PATCH_MARKER = Symbol.for('tmp.camera.onvif.ptz-service-evidence.v2');

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    return String(value.href || value.Href || value.XAddr || value.xAddr || value.url || value.path || value._ || '');
  }
  return '';
}

function getServiceNamespace(service) {
  return stringValue(service && (service.namespace || service.Namespace || service.namespaceUri || service.ns));
}

function getServiceAddress(service) {
  return stringValue(service && (service.XAddr || service.xAddr || service.xaddr || service.address || service.url));
}

function profileHasPtz(profile) {
  if (!profile || typeof profile !== 'object') return false;
  return Boolean(
    profile.PTZConfiguration ||
    profile.ptzConfiguration ||
    profile.PtzConfiguration ||
    profile.PTZConfigurationToken ||
    profile.ptzConfigurationToken ||
    profile.ptz
  );
}

function getAdvertisedPtzAddress(cam) {
  if (!cam || typeof cam !== 'object') return '';

  const uri = cam.uri || cam.uris || {};
  const directUri = uri.ptz || uri.PTZ || uri.Ptz;
  if (directUri) return stringValue(directUri) || 'onvif:ptz';

  const capabilities = cam.capabilities || cam.Capabilities || {};
  const ptzCapabilities = capabilities.PTZ || capabilities.ptz || capabilities.Ptz;
  if (ptzCapabilities) {
    const address = stringValue(ptzCapabilities.XAddr || ptzCapabilities.xAddr || ptzCapabilities.xaddr || ptzCapabilities);
    if (address) return address;
  }

  for (const service of asArray(cam.services || cam.Services)) {
    const namespace = getServiceNamespace(service);
    const address = getServiceAddress(service);
    const isOnvifPtzNamespace = /(?:^|\/)onvif\.org\/ver\d+\/ptz\/wsdl(?:$|[/?#])/i.test(namespace) ||
      /www\.onvif\.org\/ver\d+\/ptz\/wsdl/i.test(namespace) ||
      /\/ptz\/wsdl/i.test(namespace);
    if (isOnvifPtzNamespace && address) return address;
  }

  for (const profile of asArray(cam.profiles || cam.Profiles || cam.defaultProfiles)) {
    if (profileHasPtz(profile)) return 'onvif:profile-ptz';
  }

  if (cam.activeSource && cam.activeSource.ptz) return 'onvif:active-source-ptz';
  for (const source of asArray(cam.activeSources)) {
    if (source && source.ptz) return 'onvif:active-source-ptz';
  }

  return '';
}

function hasOnvifPtzEvidence(cam) {
  return Boolean(getAdvertisedPtzAddress(cam));
}

function getProfileToken(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return profile.token || profile.profileToken || profile.ProfileToken ||
    (profile.$ && (profile.$.token || profile.$.Token)) || null;
}

function applyOnvifPtzEvidence(cam, options = {}) {
  if (!cam || typeof cam !== 'object') return false;
  const forced = options.force === true;
  const address = forced ? (options.address || 'onvif:verified-ptz') : getAdvertisedPtzAddress(cam);
  if (!address) return false;

  cam.ptzSupported = true;
  cam.ptzAvailable = true;
  cam.supportsPtz = true;
  cam.supportsPTZ = true;
  cam.hasPtz = true;
  cam.hasPTZ = true;
  cam.hasPTZService = true;
  cam.ptzServiceAddress = address;

  if (!cam.uri) cam.uri = {};
  if (!cam.uri.ptz && /^https?:\/\//i.test(address)) {
    try {
      cam.uri.ptz = new URL(address);
    } catch (_) {
      cam.uri.ptz = address;
    }
  }

  if (!cam.capabilities) cam.capabilities = {};
  if (!cam.capabilities.PTZ && !cam.capabilities.ptz) {
    cam.capabilities.PTZ = { XAddr: address, serviceOnly: true };
  }

  const profiles = asArray(cam.profiles || cam.Profiles || cam.defaultProfiles);
  const defaultProfile = cam.defaultProfile || profiles[0] || null;
  const fallbackToken = getProfileToken(defaultProfile) ||
    (cam.activeSource && cam.activeSource.profileToken) || null;
  const marker = {
    name: 'ONVIF PTZ service',
    token: null,
    profileToken: fallbackToken,
    serviceOnly: true,
    XAddr: address
  };

  if (cam.activeSource && !cam.activeSource.ptz) {
    cam.activeSource.ptz = { ...marker };
  }
  for (const source of asArray(cam.activeSources)) {
    if (source && !source.ptz) {
      source.ptz = { ...marker, profileToken: source.profileToken || fallbackToken };
    }
  }

  // A number of applications inspect the raw Media profile rather than the
  // advertised PTZ service. Keep this compatibility marker non-enumerable so
  // it cannot be mistaken for a real PTZ configuration token when serialized.
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object' || profileHasPtz(profile)) continue;
    try {
      Object.defineProperty(profile, 'PTZConfiguration', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: {
          name: 'ONVIF PTZ service',
          $: { token: null },
          serviceOnly: true,
          profileToken: getProfileToken(profile),
          XAddr: address
        }
      });
    } catch (_) {
      // Frozen profile objects are still covered by the camera-level flags.
    }
  }

  return true;
}

function resultContainsPtzEvidence(result) {
  if (result == null) return false;
  if (Array.isArray(result)) return result.length > 0;
  if (typeof result !== 'object') return true;
  return Object.keys(result).length > 0;
}

function wrapEvidenceMethod(Cam, methodName) {
  const original = Cam.prototype[methodName];
  if (typeof original !== 'function' || original.__tmpPtzEvidenceWrapped) return;
  function wrapped(...args) {
    const callbackIndex = [...args].reverse().findIndex((value) => typeof value === 'function');
    if (callbackIndex < 0) return original.apply(this, args);
    const index = args.length - 1 - callbackIndex;
    const callback = args[index];
    args[index] = (error, result, ...rest) => {
      if (!error && resultContainsPtzEvidence(result)) {
        applyOnvifPtzEvidence(this, { force: true });
      }
      return callback.call(this, error, result, ...rest);
    };
    return original.apply(this, args);
  }
  Object.defineProperty(wrapped, '__tmpPtzEvidenceWrapped', { value: true });
  Cam.prototype[methodName] = wrapped;
}

function installOnvifPtzPatch(onvifModule) {
  const Cam = onvifModule && (onvifModule.Cam || (onvifModule.default && onvifModule.default.Cam));
  if (!Cam || !Cam.prototype || Cam.prototype[PATCH_MARKER]) return Boolean(Cam);
  Object.defineProperty(Cam.prototype, PATCH_MARKER, { value: true });

  const originalGetActiveSources = Cam.prototype.getActiveSources;
  if (typeof originalGetActiveSources === 'function') {
    Cam.prototype.getActiveSources = function patchedGetActiveSources(...args) {
      const result = originalGetActiveSources.apply(this, args);
      applyOnvifPtzEvidence(this);
      return result;
    };
  }

  const originalConnect = Cam.prototype.connect;
  if (typeof originalConnect === 'function') {
    Cam.prototype.connect = function patchedConnect(callback) {
      const cam = this;
      if (typeof callback !== 'function') return originalConnect.apply(cam, arguments);
      return originalConnect.call(cam, function patchedConnectCallback(error, ...rest) {
        if (!error) applyOnvifPtzEvidence(this || cam);
        return callback.call(this || cam, error, ...rest);
      });
    };
  }

  for (const methodName of ['getConfigurations', 'getNodes', 'getStatus', 'getPresets', 'getCompatibleConfigurations']) {
    wrapEvidenceMethod(Cam, methodName);
  }

  return true;
}

module.exports = {
  applyOnvifPtzEvidence,
  getAdvertisedPtzAddress,
  hasOnvifPtzEvidence,
  installOnvifPtzPatch,
  profileHasPtz
};

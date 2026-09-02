#!/usr/bin/env node
'use strict';

/* Ensures the upstream onvif compatibility object exposes advertised PTZ
 * services even when Media/GetProfiles omits PTZConfiguration. Safe to run
 * repeatedly and during npm ci. */
const fs = require('fs');
const path = require('path');
const marker = 'TMP_ONVIF_PTZ_SERVICE_EVIDENCE_PATCH_V2';

let target;
try {
  target = require.resolve('onvif/lib/cam.js', { paths: [process.cwd()] });
} catch (_) {
  process.exit(0);
}

let source = fs.readFileSync(target, 'utf8');
if (source.includes(marker)) process.exit(0);

const patch = `\n/* ${marker} */\n(function installTmpPtzEvidenceBridge() {\n  if (typeof Cam !== 'function' || !Cam.prototype || Cam.prototype.__tmpPtzServiceEvidenceV2) return;\n  Object.defineProperty(Cam.prototype, '__tmpPtzServiceEvidenceV2', { value: true });\n  function text(v) {\n    if (!v) return '';\n    if (typeof v === 'string') return v;\n    return String(v.href || v.XAddr || v.xAddr || v.path || v._ || '');\n  }\n  function evidence(cam) {\n    var uri = cam.uri || {};\n    if (uri.ptz || uri.PTZ) return text(uri.ptz || uri.PTZ) || 'onvif:ptz';\n    var caps = cam.capabilities || {};\n    var ptz = caps.PTZ || caps.ptz;\n    if (ptz && (ptz.XAddr || ptz.xAddr)) return text(ptz.XAddr || ptz.xAddr);\n    var services = Array.isArray(cam.services) ? cam.services : [];\n    for (var i = 0; i < services.length; i += 1) {\n      var ns = text(services[i].namespace || services[i].Namespace);\n      var addr = text(services[i].XAddr || services[i].xAddr);\n      if (/\\/ptz\\/wsdl/i.test(ns) && addr) return addr;\n    }\n    return '';\n  }\n  function apply(cam) {\n    var addr = evidence(cam);\n    if (!addr) return false;\n    cam.ptzSupported = cam.ptzAvailable = cam.supportsPtz = cam.supportsPTZ = true;\n    cam.hasPtz = cam.hasPTZ = cam.hasPTZService = true;\n    cam.ptzServiceAddress = addr;\n    if (cam.activeSource && !cam.activeSource.ptz) {\n      cam.activeSource.ptz = { name: 'ONVIF PTZ service', token: null, profileToken: cam.activeSource.profileToken || null, serviceOnly: true, XAddr: addr };\n    }\n    (Array.isArray(cam.activeSources) ? cam.activeSources : []).forEach(function(src) {\n      if (src && !src.ptz) src.ptz = { name: 'ONVIF PTZ service', token: null, profileToken: src.profileToken || null, serviceOnly: true, XAddr: addr };\n    });\n    return true;\n  }\n  var original = Cam.prototype.getActiveSources;\n  if (typeof original === 'function') {\n    Cam.prototype.getActiveSources = function() {\n      var result = original.apply(this, arguments);\n      apply(this);\n      return result;\n    };\n  }\n  var connect = Cam.prototype.connect;\n  if (typeof connect === 'function') {\n    Cam.prototype.connect = function(callback) {\n      var self = this;\n      if (typeof callback !== 'function') return connect.apply(self, arguments);\n      return connect.call(self, function(err) {\n        if (!err) apply(this || self);\n        return callback.apply(this || self, arguments);\n      });\n    };\n  }\n})();\n`;

fs.writeFileSync(target, source + patch, 'utf8');
console.log('[TMP Camera] Applied ONVIF PTZ service evidence compatibility patch.');

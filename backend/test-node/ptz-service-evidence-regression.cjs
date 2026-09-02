#!/usr/bin/env node
'use strict';
const assert = require('assert');
const path = require('path');
const helper = require(process.argv[2]);

class FakeCam {
  connect(callback) { callback.call(this, null); }
  getActiveSources() {
    this.profiles = [{ $: { token: 'profile-1' } }];
    this.activeSource = { profileToken: 'profile-1' };
    this.activeSources = [this.activeSource];
  }
  getConfigurations(callback) { callback.call(this, null, { PTZ: { token: 'cfg-1' } }); }
  getNodes(callback) { callback.call(this, null, {}); }
}
helper.installOnvifPtzPatch({ Cam: FakeCam });

const cam = new FakeCam();
cam.uri = { ptz: { href: 'http://camera/onvif/ptz_service' } };
cam.services = [{ namespace: 'http://www.onvif.org/ver20/ptz/wsdl', XAddr: 'http://camera/onvif/ptz_service' }];
cam.getActiveSources();
assert.strictEqual(cam.ptzSupported, true);
assert.strictEqual(cam.hasPTZService, true);
assert.ok(cam.activeSource.ptz, 'activeSource.ptz must be normalized');
assert.strictEqual(cam.activeSource.ptz.profileToken, 'profile-1');
assert.strictEqual(helper.hasOnvifPtzEvidence(cam), true);

const fixed = new FakeCam();
fixed.uri = { media: { href: 'http://camera/onvif/media_service' } };
fixed.services = [{ namespace: 'http://www.onvif.org/ver10/media/wsdl', XAddr: 'http://camera/onvif/media_service' }];
fixed.getActiveSources();
assert.notStrictEqual(fixed.ptzSupported, true, 'media-only device must not become PTZ');

const capsOnly = new FakeCam();
capsOnly.capabilities = { PTZ: { XAddr: 'http://camera/onvif/ptz' } };
capsOnly.getActiveSources();
assert.strictEqual(capsOnly.ptzAvailable, true);

const probe = new FakeCam();
probe.getActiveSources();
probe.getConfigurations((err, result) => {
  assert.ifError(err);
  assert.ok(result);
});
assert.strictEqual(probe.ptzSupported, true, 'successful safe PTZ probe must mark support');

console.log('PTZ service evidence regression tests passed');

import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseComposeProjectName, normalizeComposeProjectName, projectIdentityFromInspect } from '../src/composeProject.js';

test('Updater bevorzugt den realen Compose-Projektnamen des laufenden Containers', () => {
  const identity = projectIdentityFromInspect({
    Config: { Labels: {
      'com.docker.compose.project': 'tmp_networks_camera_surveillance_next_v2163_universal_docker',
      'com.docker.compose.service': 'updater',
    } },
    Mounts: [{ Source: '/volume1/docker/TMP_Networks_Camera_Surveillance_Next_v2.16.3_Universal_Docker', Destination: '/workspace' }],
  });
  assert.equal(identity.composeProjectName, 'tmp_networks_camera_surveillance_next_v2163_universal_docker');
  assert.equal(identity.hostProjectPath, '/volume1/docker/TMP_Networks_Camera_Surveillance_Next_v2.16.3_Universal_Docker');
  assert.equal(chooseComposeProjectName({
    inspectedProjectName: identity.composeProjectName,
    configuredProjectName: 'tmp-camera-surveillance-next',
  }), identity.composeProjectName);
});

test('Ungültige Projektnamen werden verworfen und sicher ersetzt', () => {
  assert.equal(normalizeComposeProjectName('bad name; rm -rf /'), null);
  assert.equal(chooseComposeProjectName({ configuredProjectName: 'bad name', fallback: 'tmp-camera-surveillance-next' }), 'tmp-camera-surveillance-next');
});

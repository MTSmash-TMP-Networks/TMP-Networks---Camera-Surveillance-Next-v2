export function normalizeComposeProjectName(value) {
  const normalized = String(value || '').trim();
  if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(normalized)) return null;
  return normalized;
}

export function projectIdentityFromInspect(inspected, projectDirectory = '/workspace') {
  const labels = inspected?.Config?.Labels || {};
  const composeProjectName = normalizeComposeProjectName(labels['com.docker.compose.project']);
  const mounts = Array.isArray(inspected?.Mounts) ? inspected.Mounts : [];
  const projectMount = mounts.find((mount) => mount?.Destination === projectDirectory || mount?.Destination === '/workspace');
  const hostProjectPath = typeof projectMount?.Source === 'string' && projectMount.Source.startsWith('/') && projectMount.Source !== '/'
    ? projectMount.Source
    : null;
  return {
    composeProjectName,
    hostProjectPath,
    composeService: String(labels['com.docker.compose.service'] || '').trim() || null,
    composeWorkingDir: String(labels['com.docker.compose.project.working_dir'] || '').trim() || null,
  };
}

export function chooseComposeProjectName({ inspectedProjectName, configuredProjectName, fallback = 'tmp-camera-surveillance-next' } = {}) {
  return normalizeComposeProjectName(inspectedProjectName)
    || normalizeComposeProjectName(configuredProjectName)
    || normalizeComposeProjectName(fallback)
    || 'tmp-camera-surveillance-next';
}

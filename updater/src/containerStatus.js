const CORE_SERVICES = Object.freeze(['updater', 'backend', 'mediamtx', 'frontend']);
const OPTIONAL_SERVICES = new Set(['caddy']);

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function safeDate(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function serviceName(container) {
  return String(container?.Config?.Labels?.['com.docker.compose.service'] || '').trim() || null;
}

function containerName(container) {
  return String(container?.Name || '').replace(/^\/+/, '').trim() || null;
}

function runtimeState(state = {}) {
  const raw = String(state.Status || '').trim().toLowerCase();
  const health = String(state.Health?.Status || '').trim().toLowerCase() || null;
  if (state.Dead || raw === 'dead') return 'dead';
  if (health === 'unhealthy') return 'unhealthy';
  if (state.Restarting || raw === 'restarting') return 'restarting';
  if (state.Paused || raw === 'paused') return 'paused';
  if (state.Running || raw === 'running') return health === 'starting' ? 'starting' : (health === 'healthy' ? 'healthy' : 'running');
  if (raw === 'created') return 'created';
  if (raw === 'exited') return 'stopped';
  if (raw === 'removing') return 'removing';
  return raw || 'unknown';
}

function severityForState(state, essential) {
  if (['healthy', 'running'].includes(state)) return 'ok';
  if (['starting', 'restarting', 'paused', 'created', 'removing'].includes(state)) return 'warning';
  if (['unhealthy', 'dead', 'stopped', 'missing'].includes(state)) return essential ? 'critical' : 'warning';
  return 'warning';
}

export function normalizeContainerInspect(container, { now = Date.now(), expectedServices = CORE_SERVICES } = {}) {
  const service = serviceName(container);
  const state = container?.State || {};
  const startedAt = safeDate(state.StartedAt);
  const finishedAt = safeDate(state.FinishedAt);
  const startedMs = startedAt ? Date.parse(startedAt) : null;
  const status = runtimeState(state);
  const essential = expectedServices.includes(service);
  const healthLog = Array.isArray(state.Health?.Log) ? state.Health.Log.at(-1) : null;
  return {
    id: String(container?.Id || '').slice(0, 12) || null,
    service,
    name: containerName(container),
    image: String(container?.Config?.Image || container?.Image || '').trim() || null,
    status,
    severity: severityForState(status, essential),
    essential,
    running: Boolean(state.Running),
    health: String(state.Health?.Status || '').trim().toLowerCase() || null,
    healthFailingStreak: finiteInteger(state.Health?.FailingStreak),
    healthLastCheckedAt: safeDate(healthLog?.End),
    restartCount: finiteInteger(container?.RestartCount),
    exitCode: Number.isInteger(Number(state.ExitCode)) ? Number(state.ExitCode) : null,
    oomKilled: Boolean(state.OOMKilled),
    startedAt,
    finishedAt,
    uptimeSeconds: state.Running && startedMs !== null ? Math.max(0, Math.floor((now - startedMs) / 1000)) : null,
  };
}

function missingService(service, expectedServices) {
  const essential = expectedServices.includes(service);
  return {
    id: null,
    service,
    name: null,
    image: null,
    status: 'missing',
    severity: severityForState('missing', essential),
    essential,
    running: false,
    health: null,
    healthFailingStreak: 0,
    healthLastCheckedAt: null,
    restartCount: 0,
    exitCode: null,
    oomKilled: false,
    startedAt: null,
    finishedAt: null,
    uptimeSeconds: null,
  };
}

function bestContainer(containers) {
  return [...containers].sort((left, right) => {
    const rank = (item) => ({ healthy: 6, running: 5, starting: 4, restarting: 3, paused: 2, created: 1 }[item.status] || 0);
    const rankDifference = rank(right) - rank(left);
    if (rankDifference) return rankDifference;
    return String(right.startedAt || right.finishedAt || '').localeCompare(String(left.startedAt || left.finishedAt || ''));
  })[0];
}

export function summarizeContainers(items) {
  const summary = { total: items.length, running: 0, healthy: 0, warning: 0, critical: 0, restarting: 0, stopped: 0, missing: 0 };
  for (const item of items) {
    if (item.running) summary.running += 1;
    if (item.status === 'healthy') summary.healthy += 1;
    if (item.status === 'restarting') summary.restarting += 1;
    if (item.status === 'stopped') summary.stopped += 1;
    if (item.status === 'missing') summary.missing += 1;
    if (item.severity === 'warning') summary.warning += 1;
    if (item.severity === 'critical') summary.critical += 1;
  }
  return summary;
}

export function normalizeContainerSet(inspectItems, {
  composeProjectName = null,
  now = Date.now(),
  expectedServices = CORE_SERVICES,
} = {}) {
  const normalized = (Array.isArray(inspectItems) ? inspectItems : [])
    .map((item) => normalizeContainerInspect(item, { now, expectedServices }))
    .filter((item) => item.service);
  const grouped = new Map();
  for (const item of normalized) {
    const list = grouped.get(item.service) || [];
    list.push(item);
    grouped.set(item.service, list);
  }

  const discoveredServices = [...grouped.keys()].filter((service) => !expectedServices.includes(service));
  const serviceOrder = [
    ...expectedServices,
    ...discoveredServices.filter((service) => OPTIONAL_SERVICES.has(service)).sort(),
    ...discoveredServices.filter((service) => !OPTIONAL_SERVICES.has(service)).sort(),
  ];
  const items = serviceOrder.map((service) => grouped.has(service)
    ? bestContainer(grouped.get(service))
    : missingService(service, expectedServices));
  const summary = summarizeContainers(items);
  const status = summary.critical > 0 ? 'critical' : (summary.warning > 0 ? 'warning' : 'ok');
  return {
    status,
    generatedAt: new Date(now).toISOString(),
    source: 'docker-engine',
    project: composeProjectName,
    summary,
    items,
  };
}

function parseIds(output) {
  return String(output || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function parseInspect(output) {
  try { return JSON.parse(String(output || '[]')); }
  catch { throw new Error('Docker-Containerstatus konnte nicht gelesen werden'); }
}

function composeProject(container) {
  return String(container?.Config?.Labels?.['com.docker.compose.project'] || '').trim() || null;
}

function chooseDiscoveredProject(containers, { composeProjectName, currentContainerId, expectedServices }) {
  const groups = new Map();
  for (const container of containers) {
    const project = composeProject(container);
    if (!project) continue;
    const list = groups.get(project) || [];
    list.push(container);
    groups.set(project, list);
  }
  if (composeProjectName && groups.has(composeProjectName)) return { project: composeProjectName, containers: groups.get(composeProjectName) };

  const current = String(currentContainerId || '').trim();
  if (current) {
    for (const [project, items] of groups) {
      if (items.some((item) => String(item?.Id || '').startsWith(current))) return { project, containers: items };
    }
  }

  const ranked = [...groups.entries()].map(([project, items]) => {
    const services = new Set(items.map(serviceName).filter(Boolean));
    const expected = expectedServices.filter((service) => services.has(service)).length;
    const running = items.filter((item) => item?.State?.Running).length;
    const updater = services.has('updater') ? 1 : 0;
    return { project, containers: items, score: expected * 100 + updater * 20 + running };
  }).sort((left, right) => right.score - left.score || left.project.localeCompare(right.project));
  return ranked[0] || { project: composeProjectName || null, containers: [] };
}

export async function collectContainerStatus({
  executeDocker,
  composeProjectName,
  currentContainerId = null,
  expectedServices = CORE_SERVICES,
  now = Date.now(),
} = {}) {
  if (typeof executeDocker !== 'function') throw new TypeError('executeDocker is required');

  const listed = await executeDocker([
    'ps', '-a',
    '--filter', `label=com.docker.compose.project=${composeProjectName}`,
    '--format', '{{.ID}}',
  ]);
  const projectIds = parseIds(listed?.stdout);
  if (projectIds.length) {
    const inspected = await executeDocker(['inspect', ...projectIds]);
    return normalizeContainerSet(parseInspect(inspected?.stdout), { composeProjectName, now, expectedServices });
  }

  // Some older Compose/DSM installations use a directory-derived project
  // label even when COMPOSE_PROJECT_NAME contains a newer fixed value. Fall
  // back to service labels and select the project containing this updater.
  const discoveredIds = new Set();
  for (const service of [...expectedServices, ...OPTIONAL_SERVICES]) {
    const serviceList = await executeDocker([
      'ps', '-a',
      '--filter', `label=com.docker.compose.service=${service}`,
      '--format', '{{.ID}}',
    ]);
    for (const id of parseIds(serviceList?.stdout)) discoveredIds.add(id);
  }
  if (!discoveredIds.size) return normalizeContainerSet([], { composeProjectName, now, expectedServices });

  const inspected = await executeDocker(['inspect', ...discoveredIds]);
  const selected = chooseDiscoveredProject(parseInspect(inspected?.stdout), {
    composeProjectName,
    currentContainerId,
    expectedServices,
  });
  return normalizeContainerSet(selected.containers, {
    composeProjectName: selected.project || composeProjectName,
    now,
    expectedServices,
  });
}

export { CORE_SERVICES };

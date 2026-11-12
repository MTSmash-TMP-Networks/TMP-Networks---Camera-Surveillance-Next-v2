import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

import {
  calculateCpuUsage, calculateFilesystemUsagePercent, calculateNetworkRates, clampPercent, filesystemCapacityMatches, parseCpuStat, parseMemInfo, parseNetworkDev, parseNvidiaCsv, toFiniteNumber,
} from './systemMetricsParsers.js';

const execFileAsync = promisify(execFile);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const finite = toFiniteNumber;
const ONE_TB = 1024 ** 4;

function safeInteger(value) {
  if (typeof value === 'bigint') {
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(value > maximum ? maximum : value);
  }
  return Math.max(0, finite(value, 0));
}

async function readText(file, fallback = null) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return fallback;
  }
}

async function readableDirectory(candidate, fallback) {
  try {
    const stat = await fsp.stat(candidate);
    if (stat.isDirectory()) return candidate;
  } catch { /* fallback below */ }
  return fallback;
}

function parseNvidiaInformation(contents, id) {
  const values = {};
  for (const line of String(contents || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.+?)\s*$/);
    if (match) values[match[1].trim()] = match[2].trim();
  }
  return {
    id: values['GPU UUID'] || id,
    index: null,
    name: values.Model || 'NVIDIA GPU',
    vendor: 'NVIDIA',
    utilizationPercent: null,
    memoryTotalBytes: null,
    memoryUsedBytes: null,
    memoryUsagePercent: null,
    temperatureC: null,
    source: 'nvidia-proc',
  };
}

async function firstNumber(files, divisor = 1) {
  for (const file of files) {
    const text = await readText(file);
    const value = finite(String(text || '').trim(), null);
    if (value !== null) return value / divisor;
  }
  return null;
}

async function collectCpuTemperature(sysRoot) {
  const candidates = [];
  try {
    const thermalRoot = path.join(sysRoot, 'class/thermal');
    for (const entry of await fsp.readdir(thermalRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('thermal_zone')) continue;
      const base = path.join(thermalRoot, entry.name);
      const type = String(await readText(path.join(base, 'type'), '')).trim().toLowerCase();
      if (/cpu|x86_pkg|soc|package/.test(type)) candidates.push(path.join(base, 'temp'));
    }
  } catch { /* no thermal zones */ }
  const value = await firstNumber(candidates, 1000);
  return value === null ? null : Math.round(value * 10) / 10;
}

async function collectNvidiaSmi() {
  try {
    const { stdout } = await execFileAsync(config.nvidiaSmiPath, [
      '--query-gpu=index,name,uuid,utilization.gpu,memory.total,memory.used,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], {
      timeout: config.systemMetricsCommandTimeoutMs,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    });
    return parseNvidiaCsv(stdout);
  } catch (error) {
    logger.debug({ code: error?.code || 'NVIDIA_SMI_FAILED' }, 'NVIDIA-Metriken sind ueber nvidia-smi nicht verfuegbar');
    return [];
  }
}

async function collectNvidiaProc(procRoot) {
  const root = path.join(procRoot, 'driver/nvidia/gpus');
  try {
    const devices = [];
    for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const contents = await readText(path.join(root, entry.name, 'information'));
      if (contents) devices.push(parseNvidiaInformation(contents, `nvidia-${devices.length}`));
    }
    return devices;
  } catch {
    return [];
  }
}

function vendorName(vendor) {
  return ({ '0x1002': 'AMD', '0x8086': 'Intel', '0x10de': 'NVIDIA' })[vendor] || 'Unbekannt';
}

async function collectDrmGpu(sysRoot) {
  const root = path.join(sysRoot, 'class/drm');
  try {
    const output = [];
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!/^card\d+$/.test(entry.name)) continue;
      const base = path.join(root, entry.name, 'device');
      const vendor = String(await readText(path.join(base, 'vendor'), '')).trim().toLowerCase();
      if (!vendor) continue;
      const device = String(await readText(path.join(base, 'device'), '')).trim().toLowerCase();
      const busy = await firstNumber([
        path.join(base, 'gpu_busy_percent'),
        path.join(base, 'gt_busy_percent'),
      ]);
      const memoryTotalBytes = await firstNumber([path.join(base, 'mem_info_vram_total')]);
      const memoryUsedBytes = await firstNumber([path.join(base, 'mem_info_vram_used')]);
      const hwmonRoot = path.join(base, 'hwmon');
      const temperatureFiles = [];
      try {
        for (const hwmon of await fsp.readdir(hwmonRoot, { withFileTypes: true })) {
          if (hwmon.isDirectory()) temperatureFiles.push(path.join(hwmonRoot, hwmon.name, 'temp1_input'));
        }
      } catch { /* no hwmon */ }
      const temperature = await firstNumber(temperatureFiles, 1000);
      let driver = '';
      try { driver = path.basename(await fsp.realpath(path.join(base, 'driver'))); } catch { /* optional */ }
      output.push({
        id: `${vendor}-${device || entry.name}-${entry.name}`,
        index: finite(entry.name.replace('card', ''), null),
        name: `${vendorName(vendor)} GPU${device ? ` (${device})` : ''}`,
        vendor: vendorName(vendor),
        driver: driver || null,
        utilizationPercent: busy === null ? null : clampPercent(busy),
        memoryTotalBytes,
        memoryUsedBytes,
        memoryUsagePercent: memoryTotalBytes ? clampPercent((memoryUsedBytes / memoryTotalBytes) * 100) : null,
        temperatureC: temperature === null ? null : Math.round(temperature * 10) / 10,
        source: 'drm-sysfs',
      });
    }
    return output;
  } catch {
    return [];
  }
}

async function statFilesystem(target, { id = 'recording-storage', label = 'Aufnahmespeicher', source = 'statfs' } = {}) {
  const stat = await fsp.statfs(target, { bigint: true });
  const blockSize = safeInteger(stat.bsize);
  const totalBytes = blockSize * safeInteger(stat.blocks);
  const freeBytes = blockSize * safeInteger(stat.bfree);
  const availableBytes = blockSize * safeInteger(stat.bavail);
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    id,
    label,
    source,
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    usagePercent: calculateFilesystemUsagePercent(usedBytes, availableBytes, totalBytes),
    capacityTrusted: true,
  };
}

async function directorySizeBytes(target) {
  try {
    const stat = await fsp.stat(target);
    if (!stat.isDirectory()) return 0;
  } catch { return 0; }
  try {
    const { stdout } = await execFileAsync('du', ['-sk', target], {
      timeout: config.systemMetricsCommandTimeoutMs,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    const kiloBytes = finite(String(stdout || '').trim().split(/\s+/)[0], 0);
    return Math.max(0, kiloBytes * 1024);
  } catch (error) {
    logger.debug({ code: error?.code || 'DIRECTORY_SIZE_UNAVAILABLE' }, 'Ordnergroesse konnte nicht mit du ermittelt werden');
    return 0;
  }
}

function hostDiskFromConfig() {
  const totalBytes = config.systemHostDiskTotalBytes;
  const availableBytes = config.systemHostDiskAvailableBytes;
  const usedBytes = config.systemHostDiskUsedBytes || Math.max(0, totalBytes - availableBytes);
  if (!totalBytes || totalBytes <= 0) return null;
  return {
    id: 'host-storage',
    label: 'Host-Festplatte',
    source: config.systemHostDiskSource || 'host-df',
    totalBytes,
    usedBytes,
    freeBytes: availableBytes,
    availableBytes,
    usagePercent: totalBytes ? clampPercent((usedBytes / totalBytes) * 100) : null,
    capacityTrusted: true,
  };
}

async function collectStorage() {
  const diagnostics = [];
  const [recordingsUsedBytes, dataUsedBytes] = await Promise.all([
    directorySizeBytes(config.recordingsDir),
    directorySizeBytes(config.dataDir),
  ]);

  // SYSTEM_HOST_DISK_* is written by start.sh as a startup snapshot. It must
  // never be used as the live usage/free-space value: Docker image/build-cache
  // cleanup can reclaim gigabytes without restarting the backend. Keep only
  // the snapshot total as an identity hint for the bind-mounted host filesystem.
  const configuredHostDisk = hostDiskFromConfig();

  const candidates = [...new Set([config.systemDiskPath, config.recordingsDir, config.dataDir, process.cwd()])];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const stat = await statFilesystem(candidate);
      stat.recordingsUsedBytes = recordingsUsedBytes;
      stat.applicationDataUsedBytes = dataUsedBytes;
      if (stat.totalBytes > 0 && stat.totalBytes <= config.systemStoragePlausibleMaxBytes) {
        // A bind mount reports live statfs values from the backing host
        // filesystem on Linux/Synology. If its capacity matches the host-df
        // snapshot captured by start.sh, label it explicitly as a live host
        // measurement. Used/free bytes always come from this fresh statfs call.
        if (candidate === config.systemDiskPath && configuredHostDisk && filesystemCapacityMatches(stat.totalBytes, configuredHostDisk.totalBytes)) {
          stat.id = 'host-storage';
          stat.label = 'Host-Festplatte';
          stat.source = 'host-statfs';
        }
        return {
          values: [stat],
          diagnostics: candidate === config.systemDiskPath ? diagnostics : diagnostics.concat({ code: 'STORAGE_PATH_FALLBACK', message: 'Der konfigurierte Aufnahmespeicher war nicht verfuegbar; angezeigt wird ein alternativer Datenpfad.' }),
        };
      }
      return {
        values: [{
          id: 'recording-directory-size',
          label: 'Aufnahmeordner',
          source: 'directory-size',
          totalBytes: null,
          usedBytes: recordingsUsedBytes || dataUsedBytes,
          freeBytes: null,
          availableBytes: null,
          usagePercent: null,
          capacityTrusted: false,
          recordingsUsedBytes,
          applicationDataUsedBytes: dataUsedBytes,
          virtualTotalBytes: stat.totalBytes,
          virtualUsedBytes: stat.usedBytes,
          virtualAvailableBytes: stat.availableBytes,
        }],
        diagnostics: diagnostics.concat({ code: 'STORAGE_VIRTUAL_CAPACITY_FALLBACK', message: 'Docker meldet eine unplausible virtuelle Datentraegergroesse. Angezeigt wird deshalb die echte Groesse des Aufnahmeordners. Fuer Host-Kapazitaet start.sh erneut ausfuehren oder SYSTEM_HOST_DISK_* setzen.' }),
      };
    } catch (error) { lastError = error; }
  }
  if (recordingsUsedBytes || dataUsedBytes) {
    return {
      values: [{
        id: 'recording-directory-size',
        label: 'Aufnahmeordner',
        source: 'directory-size',
        totalBytes: null,
        usedBytes: recordingsUsedBytes || dataUsedBytes,
        freeBytes: null,
        availableBytes: null,
        usagePercent: null,
        capacityTrusted: false,
        recordingsUsedBytes,
        applicationDataUsedBytes: dataUsedBytes,
      }],
      diagnostics: diagnostics.concat({ code: 'STORAGE_CAPACITY_UNAVAILABLE', message: 'Datentraegerkapazitaet konnte im Container nicht sicher gelesen werden; angezeigt wird die Ordnergroesse.' }),
    };
  }
  throw lastError || new Error('Kein lesbarer Datentraegerpfad');
}

function parseCpuModel(contents) {
  for (const line of String(contents || '').split(/\r?\n/)) {
    const match = line.match(/^(?:model name|hardware|processor)\s*:\s*(.+)$/i);
    if (match && !/^\d+$/.test(match[1].trim())) return match[1].trim().slice(0, 160);
  }
  return os.cpus()[0]?.model || null;
}

function wildcardToRegex(pattern) {
  return new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
}

function isExcludedInterface(name) {
  return config.systemNetworkExcludeInterfaces.some((pattern) => wildcardToRegex(pattern).test(name));
}

async function collectInterfaceMetadata(sysRoot, name) {
  const base = path.join(sysRoot, 'class/net', name);
  const [operstateText, speedText, mtuText] = await Promise.all([
    readText(path.join(base, 'operstate'), ''),
    readText(path.join(base, 'speed'), ''),
    readText(path.join(base, 'mtu'), ''),
  ]);
  const speedMbps = finite(String(speedText || '').trim(), null);
  return {
    operstate: String(operstateText || '').trim() || null,
    speedMbps: speedMbps && speedMbps > 0 && speedMbps < 1_000_000 ? speedMbps : null,
    mtu: finite(String(mtuText || '').trim(), null),
  };
}

class SystemMetricsService {
  constructor() {
    this.previousCpu = null;
    this.previousNetwork = null;
    this.cache = null;
    this.pending = null;
  }

  async status({ force = false } = {}) {
    if (!force && this.cache && Date.now() - this.cache.createdAt < config.systemMetricsCacheMs) return this.cache.value;
    if (this.pending) return this.pending;
    this.pending = this.collect().then((value) => {
      this.cache = { createdAt: Date.now(), value };
      return value;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  async sampleCpu(procRoot) {
    let current = parseCpuStat(await readText(path.join(procRoot, 'stat'), ''));
    if (!this.previousCpu?.cpu) {
      this.previousCpu = current;
      await sleep(config.systemMetricsCpuSampleMs);
      current = parseCpuStat(await readText(path.join(procRoot, 'stat'), ''));
    }
    const usages = calculateCpuUsage(this.previousCpu, current);
    this.previousCpu = current;
    return {
      usagePercent: usages.cpu ?? 0,
      perCorePercent: Object.entries(usages)
        .filter(([name]) => name !== 'cpu')
        .sort(([left], [right]) => Number(left.slice(3)) - Number(right.slice(3)))
        .map(([, value]) => value ?? 0),
    };
  }

  async sampleNetwork(procRoot, sysRoot) {
    let sampledAt = Date.now();
    let current = parseNetworkDev(await readText(path.join(procRoot, 'net/dev'), ''));
    if (!this.previousNetwork?.samples) {
      this.previousNetwork = { sampledAt, samples: current };
      await sleep(config.systemMetricsCpuSampleMs);
      sampledAt = Date.now();
      current = parseNetworkDev(await readText(path.join(procRoot, 'net/dev'), ''));
    }
    const elapsedMs = Math.max(1, sampledAt - this.previousNetwork.sampledAt);
    const rates = calculateNetworkRates(this.previousNetwork.samples, current, elapsedMs);
    this.previousNetwork = { sampledAt, samples: current };

    const devices = [];
    for (const [name, rate] of Object.entries(rates)) {
      if (isExcludedInterface(name)) continue;
      const meta = await collectInterfaceMetadata(sysRoot, name);
      const totalBytesPerSecond = Math.max(0, rate.totalBytesPerSecond || 0);
      if (totalBytesPerSecond <= 0 && meta.operstate && meta.operstate !== 'up') continue;
      const speedBitsPerSecond = meta.speedMbps ? meta.speedMbps * 1_000_000 : null;
      devices.push({
        name,
        operstate: meta.operstate,
        mtu: meta.mtu,
        speedMbps: meta.speedMbps,
        speedBitsPerSecond,
        rxBytes: rate.rxBytes,
        txBytes: rate.txBytes,
        rxBytesPerSecond: rate.rxBytesPerSecond,
        txBytesPerSecond: rate.txBytesPerSecond,
        totalBytesPerSecond,
        rxPacketsPerSecond: rate.rxPacketsPerSecond,
        txPacketsPerSecond: rate.txPacketsPerSecond,
        errors: (rate.rxErrors || 0) + (rate.txErrors || 0),
        dropped: (rate.rxDropped || 0) + (rate.txDropped || 0),
        usagePercent: speedBitsPerSecond ? clampPercent((totalBytesPerSecond * 8 / speedBitsPerSecond) * 100) : null,
      });
    }
    devices.sort((left, right) => right.totalBytesPerSecond - left.totalBytesPerSecond);
    const limited = devices.slice(0, config.systemNetworkMaxDevices);
    const totalRxBytesPerSecond = devices.reduce((sum, device) => sum + device.rxBytesPerSecond, 0);
    const totalTxBytesPerSecond = devices.reduce((sum, device) => sum + device.txBytesPerSecond, 0);
    const totalBytesPerSecond = totalRxBytesPerSecond + totalTxBytesPerSecond;
    const totalSpeedBitsPerSecond = devices.reduce((sum, device) => sum + (device.speedBitsPerSecond || 0), 0);
    return {
      status: devices.length ? 'available' : 'unavailable',
      sampleIntervalMs: elapsedMs,
      totalRxBytesPerSecond,
      totalTxBytesPerSecond,
      totalBytesPerSecond,
      totalSpeedBitsPerSecond: totalSpeedBitsPerSecond || null,
      usagePercent: totalSpeedBitsPerSecond ? clampPercent((totalBytesPerSecond * 8 / totalSpeedBitsPerSecond) * 100) : null,
      relativeActivityPercent: clampPercent(Math.min(100, (totalBytesPerSecond / (12.5 * 1024 * 1024)) * 100)),
      devices: limited,
      hiddenDeviceCount: Math.max(0, devices.length - limited.length),
      message: devices.length ? null : 'Keine aktive Netzwerkschnittstelle mit messbarem Durchsatz gefunden.',
    };
  }

  async collectGpu(procRoot, sysRoot) {
    const acceleration = {
      configured: config.go2RtcFfmpegHardware === 'vaapi',
      mode: config.go2RtcFfmpegHardware,
      renderNodeVisible: await fsp.access('/dev/dri/renderD128').then(() => true).catch(() => false),
      note: 'Beschleunigungseinstellung bedeutet nicht automatisch, dass gerade ein Video enkodiert wird.',
    };
    const nvidia = await collectNvidiaSmi();
    if (nvidia.length) return { status: 'available', devices: nvidia, message: null, acceleration };
    const drm = await collectDrmGpu(sysRoot);
    if (drm.length) {
      const complete = drm.some((device) => device.utilizationPercent !== null);
      return {
        status: complete ? 'available' : 'partial',
        devices: drm,
        message: complete ? null : 'GPU erkannt, aber der Treiber stellt keine Auslastungswerte im Container bereit.',
        acceleration,
      };
    }
    const nvidiaProc = await collectNvidiaProc(procRoot);
    if (nvidiaProc.length) {
      return {
        status: 'partial',
        devices: nvidiaProc,
        message: 'NVIDIA-GPU erkannt. Fuer Live-Auslastung muss der Backend-Container mit NVIDIA Container Toolkit gestartet werden.',
        acceleration,
      };
    }
    return { status: 'unavailable', devices: [], message: 'Keine unterstuetzte GPU-Schnittstelle erkannt.', acceleration };
  }

  async collect() {
    const diagnostics = [];
    const procRoot = await readableDirectory(config.systemProcRoot, '/proc');
    const sysRoot = await readableDirectory(config.systemSysRoot, '/sys');
    const scope = procRoot === '/proc' ? 'container' : 'host';

    let cpu = { usagePercent: 0, perCorePercent: [] };
    let memory = null;
    let storage = [];
    let network = { status: 'unavailable', devices: [], message: 'Netzwerkmetriken konnten nicht gelesen werden.' };
    let gpu = { status: 'unavailable', devices: [], message: 'GPU-Metriken konnten nicht gelesen werden.' };

    try {
      cpu = await this.sampleCpu(procRoot);
    } catch (error) {
      diagnostics.push({ code: 'CPU_METRICS_UNAVAILABLE', message: 'CPU-Auslastung konnte nicht gelesen werden.' });
      logger.warn({ code: error?.code || 'CPU_METRICS_UNAVAILABLE' }, 'CPU-Metriken konnten nicht gelesen werden');
    }

    const [memInfo, loadText, uptimeText, cpuInfo, cpuTemperature] = await Promise.all([
      readText(path.join(procRoot, 'meminfo')),
      readText(path.join(procRoot, 'loadavg')),
      readText(path.join(procRoot, 'uptime')),
      readText(path.join(procRoot, 'cpuinfo')),
      collectCpuTemperature(sysRoot),
    ]);

    if (memInfo) memory = parseMemInfo(memInfo);
    else {
      const totalBytes = os.totalmem();
      const availableBytes = os.freemem();
      memory = {
        totalBytes,
        availableBytes,
        usedBytes: totalBytes - availableBytes,
        usagePercent: totalBytes ? clampPercent(((totalBytes - availableBytes) / totalBytes) * 100) : 0,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
        swapUsagePercent: 0,
      };
      diagnostics.push({ code: 'HOST_MEMORY_FALLBACK', message: 'RAM-Werte stammen aus der Containeransicht.' });
    }

    try {
      const disk = await collectStorage();
      storage = disk.values;
      diagnostics.push(...disk.diagnostics);
    } catch (error) {
      diagnostics.push({ code: 'STORAGE_METRICS_UNAVAILABLE', message: 'Datentraegerbelegung konnte nicht gelesen werden.' });
      logger.warn({ code: error?.code || 'STORAGE_METRICS_UNAVAILABLE' }, 'Datentraeger-Metriken konnten nicht gelesen werden');
    }

    try {
      network = await this.sampleNetwork(procRoot, sysRoot);
      if (network.status === 'unavailable') diagnostics.push({ code: 'NETWORK_METRICS_UNAVAILABLE', message: 'Netzwerkauslastung konnte nicht gemessen werden.' });
      else if (network.usagePercent === null) diagnostics.push({ code: 'NETWORK_SPEED_FALLBACK', message: 'Netzwerkdurchsatz ist sichtbar, aber die Link-Geschwindigkeit wurde vom Host nicht bereitgestellt.' });
    } catch (error) {
      diagnostics.push({ code: 'NETWORK_METRICS_UNAVAILABLE', message: 'Netzwerkauslastung konnte nicht gelesen werden.' });
      logger.warn({ code: error?.code || 'NETWORK_METRICS_UNAVAILABLE' }, 'Netzwerk-Metriken konnten nicht gelesen werden');
    }

    try {
      gpu = await this.collectGpu(procRoot, sysRoot);
    } catch (error) {
      diagnostics.push({ code: 'GPU_METRICS_UNAVAILABLE', message: 'GPU-Metriken konnten nicht gelesen werden.' });
      logger.warn({ code: error?.code || 'GPU_METRICS_UNAVAILABLE' }, 'GPU-Metriken konnten nicht gelesen werden');
    }

    const loadAverage = String(loadText || '').trim().split(/\s+/).slice(0, 3).map((value) => finite(value, 0));
    const uptimeSeconds = finite(String(uptimeText || '').trim().split(/\s+/)[0], os.uptime());
    return {
      status: diagnostics.some((item) => !item.code.includes('FALLBACK')) ? 'degraded' : 'ok',
      generatedAt: new Date().toISOString(),
      refreshAfterMs: config.systemMetricsRefreshMs,
      scope,
      system: {
        platform: process.platform,
        architecture: process.arch,
        uptimeSeconds,
        serviceUptimeSeconds: Math.floor(process.uptime()),
        serviceStartedAt: new Date(Date.now() - (process.uptime() * 1000)).toISOString(),
        loadAverage,
      },
      cpu: {
        ...cpu,
        cores: cpu.perCorePercent.length || os.cpus().length,
        model: parseCpuModel(cpuInfo),
        temperatureC: cpuTemperature,
      },
      memory,
      storage,
      network,
      gpu,
      diagnostics,
    };
  }
}

export const systemMetricsService = new SystemMetricsService();

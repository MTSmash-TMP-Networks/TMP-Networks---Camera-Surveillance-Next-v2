import { describe, expect, it } from 'vitest';
import { calculateCpuUsage, calculateFilesystemUsagePercent, calculateNetworkRates, filesystemCapacityMatches, parseCpuStat, parseMemInfo, parseNetworkDev, parseNvidiaCsv } from '../src/services/systemMetricsParsers.js';

describe('SystemMetricsService', () => {
  it('berechnet CPU-Auslastung aus zwei /proc/stat-Samples', () => {
    const previous = parseCpuStat('cpu  100 0 50 850 0 0 0 0\ncpu0 50 0 25 425 0 0 0 0\n');
    const current = parseCpuStat('cpu  160 0 90 950 0 0 0 0\ncpu0 80 0 45 475 0 0 0 0\n');
    const usage = calculateCpuUsage(previous, current);
    expect(usage.cpu).toBe(50);
    expect(usage.cpu0).toBe(50);
  });

  it('liest RAM und Swap aus /proc/meminfo', () => {
    const memory = parseMemInfo('MemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 400 kB\nSwapFree: 100 kB\n');
    expect(memory.totalBytes).toBe(1024000);
    expect(memory.usedBytes).toBe(768000);
    expect(memory.usagePercent).toBe(75);
    expect(memory.swapUsagePercent).toBe(75);
  });

  it('berechnet Dateisystembelegung wie df mit fuer Prozesse verfuegbarem Speicher', () => {
    const used = 5_907_312 * 1024;
    const available = 8_786_668 * 1024;
    const total = 15_503_296 * 1024;
    expect(calculateFilesystemUsagePercent(used, available, total)).toBe(40.2);
  });

  it('erkennt den live Bind-Mount anhand der stabilen Host-Kapazitaet', () => {
    const total = 15_503_296 * 1024;
    expect(filesystemCapacityMatches(total, total)).toBe(true);
    expect(filesystemCapacityMatches(total, 100 * 1024 ** 3)).toBe(false);
  });


  it('berechnet Netzwerkdurchsatz aus /proc/net/dev', () => {
    const previous = parseNetworkDev('Inter-| Receive | Transmit\n eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n');
    const current = parseNetworkDev(' eth0: 3000 20 0 0 0 0 0 0 7000 40 0 0 0 0 0 0\n');
    const rates = calculateNetworkRates(previous, current, 1000);
    expect(rates.eth0.rxBytesPerSecond).toBe(2000);
    expect(rates.eth0.txBytesPerSecond).toBe(5000);
    expect(rates.eth0.totalBytesPerSecond).toBe(7000);
  });


  it('normalisiert NVIDIA-SMI-Ausgaben ohne sensible Kommandoinformationen', () => {
    const [gpu] = parseNvidiaCsv('0, NVIDIA Tesla V100-SXM2-32GB, GPU-123, 67, 32768, 8192, 54\n');
    expect(gpu).toMatchObject({
      id: 'nvidia-0', vendor: 'NVIDIA', utilizationPercent: 67,
      memoryUsagePercent: 25, temperatureC: 54, source: 'nvidia-smi',
    });
  });
});

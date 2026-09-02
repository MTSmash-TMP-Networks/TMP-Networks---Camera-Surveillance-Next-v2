import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { updaterClient } from './updater/UpdaterClient.js';

const updateStatusFile = path.join(config.updatesDir, 'status.json');

async function readUpdateStatus() {
  try { return JSON.parse(await fsp.readFile(updateStatusFile, 'utf8')); }
  catch { return {}; }
}

class SystemControlService {
  async restart({ requestedBy, requestId } = {}) {
    const updateStatus = await readUpdateStatus();
    if (updateStatus.state === 'running') {
      throw new AppError(409, 'SYSTEM_RESTART_BUSY', 'Während eines Updates oder Rollbacks kann das Kamera-System nicht neu gestartet werden.');
    }

    return updaterClient.post('/restart', {
      confirmation: 'NEUSTART',
      requestedBy: requestedBy || null,
      source: 'system-status',
    }, { requestId });
  }
}

export const systemControlService = new SystemControlService();

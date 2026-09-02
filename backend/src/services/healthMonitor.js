import { cameraRepository } from './cameraRepository.js';
import { OnvifClient } from './onvif/OnvifClient.js';
import { logger } from '../utils/logger.js';
import { streamOrchestrator } from './media/StreamOrchestrator.js';
import { cameraEventLog, sanitizeLogText } from './CameraEventLog.js';

class HealthMonitor {
  start() {
    this.timer = setInterval(() => this.run().catch((error) => logger.error({ err: error }, 'Kamera-Monitor fehlgeschlagen')), 30000);
    this.timer.unref();
    setTimeout(() => this.run().catch(() => {}), 3000).unref?.();
  }
  async run() {
    for (const camera of cameraRepository.list().filter((item) => item.enabled)) {
      const privateCamera = cameraRepository.getWithCredentials(camera.id);
      let nextStatus = 'online';
      let statusError = null;
      try {
        await new OnvifClient(privateCamera).deviceInfo();
      } catch (error) {
        if (streamOrchestrator.hasReady(camera.id)) statusError = `ONVIF-Steuerung voruebergehend nicht erreichbar: ${error.message}`;
        else { nextStatus = 'offline'; statusError = error.message; }
      }
      cameraRepository.updateStatus(camera.id, nextStatus, statusError);
      if (camera.status !== nextStatus) {
        cameraEventLog.append(camera.id, {
          level: nextStatus === 'online' ? 'info' : 'warn',
          component: 'health-monitor',
          code: nextStatus === 'online' ? 'CAMERA_ONLINE' : 'CAMERA_OFFLINE',
          message: nextStatus === 'online' ? 'Kamera ist wieder erreichbar' : 'Kamera ist nicht erreichbar',
          details: statusError ? { error: sanitizeLogText(statusError, 800) } : null,
        });
      }
    }
  }
}
export const healthMonitor = new HealthMonitor();

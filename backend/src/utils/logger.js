import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-updater-token"]',
      '*.headers.authorization',
      '*.headers["x-updater-token"]',
      '*.password',
      '*.username',
      '*.uri',
      '*.sourceUri',
      '*.streamUri',
      '*.token',
      '*.updaterToken',
      '*.jwtSecret',
      '*.mediaTokenSecret',
      '*.cameraCredentialKey',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'tmp-camera-backend' },
});

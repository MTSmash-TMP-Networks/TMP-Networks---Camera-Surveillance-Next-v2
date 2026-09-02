import { demoModeSettingsService } from '../services/DemoModeSettingsService.js';
import { demoModePolicyAllowsRequest } from '../services/DemoModePolicy.js';
import { AppError } from '../utils/errors.js';

function requestPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0] || '/';
}

export function demoModeStatus() {
  return demoModeSettingsService.status();
}

export function demoModeAllowsRequest(method, pathname, runtime = demoModeStatus()) {
  return demoModePolicyAllowsRequest(method, pathname, runtime);
}

export function demoModeGuard(req, _res, next) {
  if (demoModeAllowsRequest(req.method, requestPath(req))) return next();
  return next(new AppError(
    423,
    'DEMO_MODE_READ_ONLY',
    'Diese Aktion ist im Demo-Modus deaktiviert. Die öffentliche Demo ist schreibgeschützt.',
    { demoMode: true, readOnly: true },
  ));
}

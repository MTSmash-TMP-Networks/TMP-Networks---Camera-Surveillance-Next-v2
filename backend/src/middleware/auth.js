import { authService } from '../services/authService.js';
import { AppError } from '../utils/errors.js';

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'AUTH_REQUIRED', 'Anmeldung erforderlich'));
  try {
    req.user = authService.verifyAccessToken(token);
    next();
  } catch (error) { next(error); }
}

export const authorize = (role) => (req, _res, next) => {
  try {
    authService.requireRole(req.user?.role, role);
    next();
  } catch (error) { next(error); }
};

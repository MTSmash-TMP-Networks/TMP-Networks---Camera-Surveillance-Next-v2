import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/authService.js';
import { desktopDeviceSessionService, parseDesktopCookie, requireDesktopSameOrigin, setDesktopCookie } from '../services/DesktopDeviceSessionService.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { demoModeStatus } from '../middleware/demoMode.js';
import { config } from '../config.js';

export const authRouter = Router();
const loginSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(300) });
const userSchema = z.object({ username: z.string().min(3).max(100), password: z.string().min(12).max(300), role: z.enum(['admin', 'operator', 'viewer']) });
const updateUserSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
  enabled: z.boolean().optional(),
  password: z.string().min(12).max(300).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Mindestens eine Aenderung ist erforderlich' });
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(300), newPassword: z.string().min(12).max(300) });

authRouter.get('/runtime', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({ ...demoModeStatus(), version: config.appVersion });
});

authRouter.post('/login', asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ ...authService.authenticate(input.username, input.password), runtime: { ...demoModeStatus(), version: config.appVersion } });
}));
// Desktop enrollment explicitly requires a normal user/password login and
// user consent. It never turns an ordinary browser login into a device grant.
authRouter.post('/desktop/enroll', asyncHandler(async (req, res) => {
  requireDesktopSameOrigin(req);
  const input = loginSchema.extend({
    label: z.string().max(80).optional(),
    rememberDevice: z.literal(true),
  }).parse(req.body || {});
  const session = authService.authenticate(input.username, input.password);
  const grant = desktopDeviceSessionService.issue(session.user.id, input.label);
  setDesktopCookie(req, res, grant.token, grant.maxAgeSeconds);
  res.json({ ...session, runtime: { ...demoModeStatus(), version: config.appVersion } });
}));

authRouter.post('/desktop/renew', asyncHandler(async (req, res) => {
  requireDesktopSameOrigin(req);
  const grant = desktopDeviceSessionService.renew(parseDesktopCookie(req));
  setDesktopCookie(req, res, grant.token, grant.maxAgeSeconds);
  const session = authService.issueAccessToken(grant.user);
  // Keep renewal limited to same-origin explicit POST; cookie never readable
  // by frontend scripts, and is not accepted as a normal API bearer token.
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json({ ...session, runtime: { ...demoModeStatus(), version: config.appVersion } });
}));

authRouter.post('/desktop/revoke', asyncHandler(async (req, res) => {
  requireDesktopSameOrigin(req);
  desktopDeviceSessionService.revoke(parseDesktopCookie(req));
  setDesktopCookie(req, res, '', 0);
  res.json({ ok: true });
}));

authRouter.get('/me', authenticate, (req, res) => res.json({ user: req.user, runtime: { ...demoModeStatus(), version: config.appVersion } }));
authRouter.post('/ws-token', authenticate, (req, res) => {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.json(authService.signWebSocketToken(req.user.sub));
});
authRouter.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const input = passwordSchema.parse(req.body);
  res.json(authService.changePassword(req.user.sub, input.currentPassword, input.newPassword));
}));
authRouter.get('/users', authenticate, authorize('admin'), (_req, res) => res.json({ items: authService.listUsers() }));
authRouter.post('/users', authenticate, authorize('admin'), asyncHandler(async (req, res) => res.status(201).json({ user: authService.createUser(userSchema.parse(req.body)) })));
authRouter.patch('/users/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => res.json({ user: authService.updateUser(req.params.id, updateUserSchema.parse(req.body || {})) })));

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ptzService } from '../services/ptz/PtzService.js';

export const ptzRouter = Router();
ptzRouter.use(authenticate, authorize('operator'));

const interactionFields = {
  interactionId: z.string().trim().min(8).max(160).optional(),
  clientId: z.string().trim().min(1).max(160).optional(),
  sequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  profileToken: z.string().max(300).optional().nullable(),
};
const moveSchema = z.object({
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  zoom: z.number().min(-1).max(1).default(0),
  ...interactionFields,
});
const interactionSchema = z.object(interactionFields);
const stopSchema = z.object({
  ...interactionFields,
  reason: z.string().trim().max(120).optional(),
});

function actorContext(req, input = {}) {
  return {
    userId: req.user?.sub || 'unknown-user',
    clientId: input.clientId || req.headers['x-client-id'] || 'unknown-client',
  };
}

ptzRouter.post('/:id/move', asyncHandler(async (req, res) => {
  const input = moveSchema.parse(req.body || {});
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' });
  res.json(await ptzService.move(req.params.id, input, actorContext(req, input)));
}));

ptzRouter.post('/:id/heartbeat', asyncHandler(async (req, res) => {
  const input = interactionSchema.parse(req.body || {});
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' });
  res.json(ptzService.heartbeat(req.params.id, input, actorContext(req, input)));
}));

ptzRouter.post('/:id/stop', asyncHandler(async (req, res) => {
  const input = stopSchema.parse(req.body || {});
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' });
  res.json(await ptzService.stop(req.params.id, input, actorContext(req, input)));
}));

ptzRouter.post('/:id/home', asyncHandler(async (req, res) => {
  const input = interactionSchema.parse(req.body || {});
  res.json(await ptzService.home(req.params.id, input, actorContext(req, input)));
}));

ptzRouter.get('/:id/status', asyncHandler(async (req, res) => {
  res.set({ 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0' });
  res.json(ptzService.status(req.params.id));
}));

ptzRouter.get('/:id/presets', asyncHandler(async (req, res) => {
  res.json({ items: await ptzService.presets(req.params.id, req.query.profile) });
}));

ptzRouter.post('/:id/presets/:preset', asyncHandler(async (req, res) => {
  const input = interactionSchema.parse(req.body || {});
  res.json(await ptzService.gotoPreset(req.params.id, req.params.preset, input, actorContext(req, input)));
}));

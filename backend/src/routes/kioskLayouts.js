import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { kioskLayoutSettingsService } from '../services/KioskLayoutSettingsService.js';

export const kioskLayoutsRouter = Router();
kioskLayoutsRouter.use(authenticate);

const slotSchema = z.object({
  id: z.string().min(1).max(80),
  column: z.number().int().min(1).max(6),
  row: z.number().int().min(1).max(6),
  columnSpan: z.number().int().min(1).max(6),
  rowSpan: z.number().int().min(1).max(6),
  cameraId: z.string().max(120),
}).strict();

const layoutSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(80),
  templateId: z.string().min(1).max(80),
  columns: z.number().int().min(1).max(6),
  rows: z.number().int().min(1).max(6),
  slots: z.array(slotSchema).min(1).max(36),
}).strict().superRefine((layout, context) => {
  const ids = new Set();
  const occupied = new Set();
  for (const [index, slot] of layout.slots.entries()) {
    if (ids.has(slot.id)) context.addIssue({ code: 'custom', path: ['slots', index, 'id'], message: 'Doppelte Kachel-ID' });
    ids.add(slot.id);
    if (slot.column + slot.columnSpan - 1 > layout.columns || slot.row + slot.rowSpan - 1 > layout.rows) {
      context.addIssue({ code: 'custom', path: ['slots', index], message: 'Kachel liegt ausserhalb des Rasters' });
    }
    for (let r = slot.row; r < slot.row + slot.rowSpan; r++) {
      for (let c = slot.column; c < slot.column + slot.columnSpan; c++) {
        const key = r + ':' + c;
        if (occupied.has(key)) context.addIssue({ code: 'custom', path: ['slots', index], message: 'Rasterkacheln ueberlappen sich' });
        occupied.add(key);
      }
    }
  }
});

const settingsSchema = z.object({
  layouts: z.array(layoutSchema).max(30),
  activeLayoutId: z.string().min(1).max(120),
  expectedRevision: z.number().int().min(0),
}).strict().superRefine((value, context) => {
  const ids = value.layouts.map((layout) => layout.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['layouts'], message: 'Doppelte Raster-ID' });
});

kioskLayoutsRouter.get('/', (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json(kioskLayoutSettingsService.get());
});

kioskLayoutsRouter.put('/', authorize('operator'), (req, res) => {
  const input = settingsSchema.parse(req.body || {});
  res.set('Cache-Control', 'private, no-store');
  res.json(kioskLayoutSettingsService.save(input));
});

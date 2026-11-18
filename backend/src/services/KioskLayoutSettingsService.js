import { db } from '../db/database.js';
import { AppError } from '../utils/errors.js';

const KEY = 'kiosk_layouts_shared_v1';

function emptyState() {
  return { layouts: [], activeLayoutId: 'auto', revision: 0, updatedAt: null, initialized: false };
}

export class KioskLayoutSettingsService {
  get() {
    const row = db.prepare('SELECT value,updated_at FROM system_settings WHERE key=?').get(KEY);
    if (!row) return emptyState();
    try {
      const saved = JSON.parse(row.value);
      if (!Array.isArray(saved.layouts) || !Number.isSafeInteger(saved.revision)) throw new Error('Invalid kiosk settings');
      return {
        layouts: saved.layouts,
        activeLayoutId: saved.activeLayoutId || 'auto',
        revision: saved.revision,
        updatedAt: row.updated_at,
        initialized: true,
      };
    } catch {
      // Old/corrupt settings should be reported, not silently overwritten.
      throw new AppError(500, 'KIOSK_SETTINGS_CORRUPT', 'Gespeicherte Kiosk-Einstellungen sind ungueltig');
    }
  }

  save({ layouts, activeLayoutId, expectedRevision }) {
    // Atomic compare-and-swap. A kiosk can never silently overwrite a newer
    // change saved by another browser or by the independent Linux Electron app.
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get();
      if (expectedRevision !== current.revision) {
        throw new AppError(409, 'KIOSK_LAYOUT_CONFLICT',
          'Die Kiosk-Einstellungen wurden auf einem anderen Geraet geaendert. Bitte aktuelle Einstellungen laden.', {
            currentRevision: current.revision,
          });
      }
      const validId = activeLayoutId === 'auto' || layouts.some((item) => item.id === activeLayoutId);
      if (!validId) throw new AppError(422, 'KIOSK_LAYOUT_UNKNOWN', 'Ausgewaehltes Raster ist nicht vorhanden');
      const revision = current.revision + 1;
      const updatedAt = new Date().toISOString();
      db.prepare(`INSERT INTO system_settings (key,value,updated_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .run(KEY, JSON.stringify({ layouts, activeLayoutId, revision }), updatedAt);
      db.exec('COMMIT');
      return { layouts, activeLayoutId, revision, updatedAt, initialized: true };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export const kioskLayoutSettingsService = new KioskLayoutSettingsService();

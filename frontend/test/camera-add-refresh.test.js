import { describe, expect, it } from 'vitest';
import camerasReducer, { cameraUpserted } from '../src/features/cameras/camerasSlice.js';

describe('Kamera nach dem Hinzufügen sofort anzeigen', () => {
  it('übernimmt eine neu angelegte Kamera ohne Seitenneuladen in den Store', () => {
    const camera = { id: 'camera-new', name: 'Eingang', status: 'online', onvif: { ip: '192.168.1.155', port: 8080 } };
    const state = camerasReducer({ items: [], status: 'idle', error: null }, cameraUpserted(camera));
    expect(state.items).toEqual([camera]);
    expect(state.status).toBe('ready');
  });

  it('ersetzt vorhandene Kameradaten statt Duplikate anzulegen', () => {
    const initial = { items: [{ id: 'camera-1', name: 'Alt' }], status: 'ready', error: null };
    const state = camerasReducer(initial, cameraUpserted({ id: 'camera-1', name: 'Neu' }));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].name).toBe('Neu');
  });
});
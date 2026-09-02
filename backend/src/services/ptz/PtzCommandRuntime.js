import { EventEmitter } from 'node:events';
import { config } from '../../config.js';

function iso(value) { return value ? new Date(value).toISOString() : null; }

/**
 * Latest-wins continuous PTZ dispatcher.
 *
 * Only one ONVIF move request is in flight per camera. While it is running,
 * repeated browser pulses replace the pending move instead of building an
 * unbounded queue. Stop bypasses the move queue and advances a generation
 * fence. A stale move completion can therefore be followed by a corrective
 * stop without delaying the user's release action.
 */
export class PtzCommandRuntime extends EventEmitter {
  constructor() {
    super();
    this.states = new Map();
    this.closed = false;
  }

  stateFor(cameraId) {
    const id = String(cameraId);
    let state = this.states.get(id);
    if (!state) {
      state = {
        cameraId: id,
        generation: 0,
        inFlight: null,
        pendingMove: null,
        stopPromise: null,
        correctiveStopPromise: null,
        lastStopExecutor: null,
        lastStopGeneration: -1,
        correctedGenerations: new Set(),
        acceptedMoves: 0,
        coalescedMoves: 0,
        completedMoves: 0,
        failedMoves: 0,
        stopCount: 0,
        correctiveStops: 0,
        cancelledMoves: 0,
        lastCommandAt: 0,
        lastCompletedAt: 0,
        lastError: null,
      };
      this.states.set(id, state);
    }
    return state;
  }

  submitMove(cameraId, command, execute, options = {}) {
    if (this.closed) return { accepted: false, queued: false, reason: 'runtime-stopped' };
    const state = this.stateFor(cameraId);
    const item = {
      generation: state.generation,
      interactionId: String(command.interactionId || ''),
      sequence: Number(command.sequence || 0),
      command,
      execute,
      isInteractionActive: options.isInteractionActive || (() => false),
      acceptedAt: Date.now(),
    };
    state.acceptedMoves += 1;
    state.lastCommandAt = Date.now();
    if (state.inFlight || state.correctiveStopPromise || state.stopPromise) {
      if (state.pendingMove) state.coalescedMoves += 1;
      state.pendingMove = item;
      this.emit('accepted', { cameraId: state.cameraId, queued: true, command });
      return { accepted: true, queued: true, generation: state.generation, sequence: item.sequence };
    }
    this.startMove(state, item);
    this.emit('accepted', { cameraId: state.cameraId, queued: false, command });
    return { accepted: true, queued: false, generation: state.generation, sequence: item.sequence };
  }

  startMove(state, item) {
    if (this.closed) return;
    state.inFlight = item;
    Promise.resolve()
      .then(() => item.execute())
      .then(() => {
        state.completedMoves += 1;
        state.lastCompletedAt = Date.now();
        state.lastError = null;
        this.emit('completed', { cameraId: state.cameraId, command: item.command, generation: item.generation });
      })
      .catch((error) => {
        state.failedMoves += 1;
        state.lastCompletedAt = Date.now();
        state.lastError = String(error?.message || error);
        this.emit('error', { cameraId: state.cameraId, command: item.command, generation: item.generation, error });
      })
      .finally(() => {
        const stale = item.generation !== state.generation;
        state.inFlight = null;
        const pending = state.pendingMove;
        state.pendingMove = null;
        // If a newer move already exists, it is the desired post-stop command
        // and safely supersedes the stale completion. Otherwise issue one
        // corrective stop and hold later moves until that stop has completed.
        if (stale && !pending) {
          const correction = this.correctAfterStaleMove(state, item);
          state.correctiveStopPromise = correction;
          void correction.finally(() => {
            if (state.correctiveStopPromise === correction) state.correctiveStopPromise = null;
            const latest = state.pendingMove;
            state.pendingMove = null;
            if (latest && !this.closed && !state.inFlight) this.startMove(state, latest);
          });
          return;
        }
        if (pending && !this.closed) this.startMove(state, pending);
      });
  }

  async correctAfterStaleMove(state, item) {
    if (!state.lastStopExecutor || state.correctedGenerations.has(item.generation)) return;
    if (item.isInteractionActive(item.interactionId)) return;
    state.correctedGenerations.add(item.generation);
    try {
      await state.lastStopExecutor();
      state.correctiveStops += 1;
      this.emit('correctiveStop', { cameraId: state.cameraId, interactionId: item.interactionId, generation: item.generation });
    } catch (error) {
      this.emit('warning', { cameraId: state.cameraId, code: 'PTZ_CORRECTIVE_STOP_FAILED', error });
    } finally {
      if (state.correctedGenerations.size > 50) {
        state.correctedGenerations = new Set([...state.correctedGenerations].slice(-20));
      }
    }
  }

  cancelInteraction(cameraId, interactionId) {
    const state = this.states.get(String(cameraId));
    if (!state) return { cancelled: false };
    const id = String(interactionId || '');
    if (state.pendingMove?.interactionId !== id) return { cancelled: false };
    const sequence = state.pendingMove.sequence;
    state.pendingMove = null;
    state.cancelledMoves += 1;
    this.emit('cancelled', { cameraId: state.cameraId, interactionId: id, sequence });
    return { cancelled: true, sequence };
  }

  async stop(cameraId, executeStop, options = {}) {
    const state = this.stateFor(cameraId);
    state.generation += 1;
    state.pendingMove = null;
    state.lastStopExecutor = executeStop;
    state.lastStopGeneration = state.generation;
    state.stopCount += 1;
    state.lastCommandAt = Date.now();
    const currentGeneration = state.generation;
    const run = Promise.resolve().then(executeStop);
    state.stopPromise = run;
    try {
      await run;
      state.lastCompletedAt = Date.now();
      state.lastError = null;
      this.emit('stopped', { cameraId: state.cameraId, generation: currentGeneration, interactionId: options.interactionId || null });
      return { ok: true, generation: currentGeneration };
    } catch (error) {
      state.lastCompletedAt = Date.now();
      state.lastError = String(error?.message || error);
      this.emit('error', { cameraId: state.cameraId, command: { action: 'stop' }, generation: currentGeneration, error });
      throw error;
    } finally {
      if (state.stopPromise === run) state.stopPromise = null;
      const pending = state.pendingMove;
      state.pendingMove = null;
      if (pending && !this.closed && !state.inFlight && !state.correctiveStopPromise && !state.stopPromise) {
        this.startMove(state, pending);
      }
    }
  }

  async runDiscrete(cameraId, command, execute) {
    const state = this.stateFor(cameraId);
    state.generation += 1;
    state.pendingMove = null;
    state.lastCommandAt = Date.now();
    const generation = state.generation;
    try {
      const result = await execute();
      state.lastCompletedAt = Date.now();
      state.lastError = null;
      this.emit('completed', { cameraId: state.cameraId, command, generation });
      return result;
    } catch (error) {
      state.lastCompletedAt = Date.now();
      state.lastError = String(error?.message || error);
      this.emit('error', { cameraId: state.cameraId, command, generation, error });
      throw error;
    }
  }

  status(cameraId = null) {
    const states = [...this.states.values()].map((state) => ({
      cameraId: state.cameraId,
      generation: state.generation,
      inFlight: state.inFlight ? {
        interactionId: state.inFlight.interactionId,
        sequence: state.inFlight.sequence,
        startedAt: iso(state.inFlight.acceptedAt),
      } : null,
      pendingMove: state.pendingMove ? {
        interactionId: state.pendingMove.interactionId,
        sequence: state.pendingMove.sequence,
        acceptedAt: iso(state.pendingMove.acceptedAt),
      } : null,
      stopInFlight: Boolean(state.stopPromise),
      correctiveStopInFlight: Boolean(state.correctiveStopPromise),
      acceptedMoves: state.acceptedMoves,
      coalescedMoves: state.coalescedMoves,
      completedMoves: state.completedMoves,
      failedMoves: state.failedMoves,
      stopCount: state.stopCount,
      correctiveStops: state.correctiveStops,
      cancelledMoves: state.cancelledMoves,
      lastCommandAt: iso(state.lastCommandAt),
      lastCompletedAt: iso(state.lastCompletedAt),
      lastError: state.lastError,
    }));
    return cameraId === null ? states : states.filter((state) => state.cameraId === String(cameraId));
  }

  shutdown() {
    this.closed = true;
    for (const state of this.states.values()) state.pendingMove = null;
    this.states.clear();
    this.removeAllListeners();
  }
}

export const ptzCommandRuntime = new PtzCommandRuntime();

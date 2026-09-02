import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';

export class AutomaticRecordingSuppressedError extends AppError {
  constructor(cameraId, details = {}) {
    super(409, 'AUTOMATIC_RECORDING_SUPPRESSED_PTZ', 'Automatische Aufnahme ist waehrend einer aktiven PTZ-Steuerung gesperrt', {
      cameraId: String(cameraId),
      ...details,
    });
    this.name = 'AutomaticRecordingSuppressedError';
  }
}

function iso(timestamp) {
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function normalizedId(value, fallback = null) {
  const text = String(value || '').trim();
  return text || fallback;
}

/**
 * Per-camera, multi-user PTZ lease manager and automatic-recording fence.
 *
 * A PTZ gesture owns a short-lived lease. Several users may hold independent
 * leases at the same time; ending one lease never releases the camera while a
 * second lease is still active. Every PTZ begin/touch/end changes a monotonic
 * revision. Automatic recording starts acquire a revocable permit and must
 * assert it before and after asynchronous preparation steps. Beginning PTZ
 * aborts every outstanding permit synchronously, closing the race between the
 * recording scheduler and FFmpeg startup.
 */
export class PtzAutomationInterlock extends EventEmitter {
  constructor(options = {}) {
    super();
    this.leaseTtlMs = Math.max(500, Number(options.leaseTtlMs ?? config.ptzLeaseTtlMs) || 2500);
    this.settleMs = Math.max(0, Number(options.settleMs ?? config.ptzMotionSettleMs) || 0);
    this.tombstoneTtlMs = Math.max(1000, Number(options.tombstoneTtlMs ?? config.ptzTombstoneTtlMs) || 15000);
    this.maxLeasesPerCamera = Math.max(1, Number(options.maxLeasesPerCamera ?? config.ptzMaxLeasesPerCamera) || 16);
    this.states = new Map();
    this.closed = false;
    const sweepMs = Math.max(250, Number(options.sweepMs ?? config.ptzLeaseSweepMs) || 500);
    this.sweepTimer = options.disableSweep ? null : setInterval(() => this.sweep(), sweepMs);
    this.sweepTimer?.unref?.();
  }

  stateFor(cameraId) {
    const id = String(cameraId);
    let state = this.states.get(id);
    if (!state) {
      state = {
        cameraId: id,
        revision: 0,
        leases: new Map(),
        tombstones: new Map(),
        permits: new Map(),
        settleUntil: 0,
        lastActivityAt: 0,
        lastReleasedAt: 0,
        lastActor: null,
        lastAction: null,
        suppressedEvents: 0,
        suppressedStarts: 0,
      };
      this.states.set(id, state);
    }
    return state;
  }

  cleanupState(state, now = Date.now()) {
    const expired = [];
    for (const [interactionId, lease] of state.leases) {
      if (lease.expiresAt > now) continue;
      state.leases.delete(interactionId);
      state.tombstones.set(interactionId, {
        interactionId,
        userId: lease.userId,
        clientId: lease.clientId,
        closedAt: now,
        expiresAt: now + this.tombstoneTtlMs,
        reason: 'lease-expired',
        revision: state.revision + 1,
      });
      state.revision += 1;
      state.lastReleasedAt = now;
      state.settleUntil = Math.max(state.settleUntil, now + this.settleMs);
      expired.push(lease);
    }
    for (const [interactionId, tombstone] of state.tombstones) {
      if (tombstone.expiresAt <= now) state.tombstones.delete(interactionId);
    }
    if (expired.length) {
      this.emit('leasesExpired', {
        cameraId: state.cameraId,
        leases: expired.map((lease) => ({ ...lease })),
        revision: state.revision,
        settleUntil: state.settleUntil,
      });
      this.emitState(state, 'lease-expired');
    }
    return expired;
  }

  sweep(now = Date.now()) {
    if (this.closed) return;
    for (const [cameraId, state] of this.states) {
      this.cleanupState(state, now);
      const idle = !state.leases.size && !state.permits.size && !state.tombstones.size && state.settleUntil <= now;
      if (idle && now - Math.max(state.lastActivityAt, state.lastReleasedAt, 0) > this.tombstoneTtlMs * 2) {
        this.states.delete(cameraId);
      }
    }
  }

  abortPermits(state, reason, details = {}) {
    for (const permit of state.permits.values()) {
      if (!permit.controller.signal.aborted) {
        permit.controller.abort(new AutomaticRecordingSuppressedError(state.cameraId, {
          reason,
          revision: state.revision,
          ...details,
        }));
      }
    }
  }

  begin(cameraId, input = {}) {
    if (this.closed) throw new AppError(503, 'PTZ_INTERLOCK_STOPPED', 'PTZ-Steuerung wird gerade beendet');
    const state = this.stateFor(cameraId);
    const now = Date.now();
    this.cleanupState(state, now);
    const interactionId = normalizedId(input.interactionId, crypto.randomUUID());
    const userId = normalizedId(input.userId, 'unknown-user');
    const clientId = normalizedId(input.clientId, 'unknown-client');
    const existing = state.leases.get(interactionId);
    const tombstone = state.tombstones.get(interactionId);
    if (existing && (existing.userId !== userId || existing.clientId !== clientId)) {
      throw new AppError(403, 'PTZ_INTERACTION_OWNER_MISMATCH', 'PTZ-Interaktion gehoert zu einer anderen Sitzung');
    }
    const incomingSequence = Number(input.sequence || 0);
    if (existing && incomingSequence > 0 && incomingSequence <= existing.sequence) {
      return this.publicLeaseState(state, existing, { stale: true, duplicate: incomingSequence === existing.sequence });
    }
    if (tombstone && !existing) {
      throw new AppError(409, 'PTZ_INTERACTION_CLOSED', 'Diese PTZ-Interaktion wurde bereits beendet', {
        interactionId,
        reason: tombstone.reason,
      });
    }
    const supersededInteractions = [];
    if (!existing) {
      const leases = [...state.leases.values()];
      const foreign = leases.filter((lease) => lease.userId !== userId || lease.clientId !== clientId);
      if (foreign.length) {
        const retryAfterMs = Math.max(0, ...foreign.map((lease) => lease.expiresAt - now));
        throw new AppError(423, 'PTZ_BUSY', 'Diese Kamera wird bereits von einem anderen Benutzer oder Browser gesteuert', {
          activeLeases: foreign.length,
          retryAfterMs,
        });
      }
      for (const lease of leases) {
        state.leases.delete(lease.interactionId);
        state.revision += 1;
        state.tombstones.set(lease.interactionId, {
          interactionId: lease.interactionId,
          userId: lease.userId,
          clientId: lease.clientId,
          closedAt: now,
          expiresAt: now + this.tombstoneTtlMs,
          reason: 'superseded-same-client',
          revision: state.revision,
        });
        supersededInteractions.push(lease.interactionId);
      }
    }
    if (!existing && state.leases.size >= this.maxLeasesPerCamera) {
      throw new AppError(429, 'PTZ_TOO_MANY_SESSIONS', 'Zu viele gleichzeitige PTZ-Bedienungen fuer diese Kamera', {
        max: this.maxLeasesPerCamera,
      });
    }
    state.revision += 1;
    const ttlMs = Math.max(500, Math.min(30_000, Number(input.ttlMs || this.leaseTtlMs)));
    const lease = {
      interactionId,
      userId,
      clientId,
      action: normalizedId(input.action, 'move'),
      profileToken: normalizedId(input.profileToken, existing?.profileToken || null),
      startedAt: existing?.startedAt || now,
      lastSeenAt: now,
      expiresAt: now + ttlMs,
      sequence: Math.max(Number(existing?.sequence || 0), incomingSequence),
      revision: state.revision,
    };
    state.leases.set(interactionId, lease);
    state.tombstones.delete(interactionId);
    state.lastActivityAt = now;
    state.lastActor = userId;
    state.lastAction = lease.action;
    state.settleUntil = Math.max(state.settleUntil, now + this.settleMs);
    this.abortPermits(state, 'ptz-begin', { interactionId, userId, clientId });
    this.emitState(state, existing ? 'lease-refreshed' : (supersededInteractions.length ? 'lease-replaced' : 'lease-started'));
    return this.publicLeaseState(state, lease, {
      supersededInteractions,
      newLease: !existing,
    });
  }

  touch(cameraId, input = {}) {
    const state = this.stateFor(cameraId);
    const now = Date.now();
    this.cleanupState(state, now);
    const interactionId = normalizedId(input.interactionId);
    if (!interactionId) throw new AppError(400, 'PTZ_INTERACTION_REQUIRED', 'PTZ-Interaktions-ID fehlt');
    const lease = state.leases.get(interactionId);
    if (!lease) {
      const tombstone = state.tombstones.get(interactionId);
      throw new AppError(409, 'PTZ_INTERACTION_CLOSED', 'PTZ-Interaktion ist nicht mehr aktiv', {
        interactionId,
        reason: tombstone?.reason || 'unknown',
      });
    }
    const userId = normalizedId(input.userId, lease.userId);
    const clientId = normalizedId(input.clientId, lease.clientId);
    if (lease.userId !== userId || lease.clientId !== clientId) {
      throw new AppError(403, 'PTZ_INTERACTION_OWNER_MISMATCH', 'PTZ-Interaktion gehoert zu einer anderen Sitzung');
    }
    const sequence = Number(input.sequence || 0);
    if (sequence && sequence < lease.sequence) {
      return this.publicLeaseState(state, lease, { stale: true });
    }
    state.revision += 1;
    lease.lastSeenAt = now;
    lease.expiresAt = now + Math.max(500, Math.min(30_000, Number(input.ttlMs || this.leaseTtlMs)));
    lease.sequence = Math.max(lease.sequence, sequence);
    lease.revision = state.revision;
    lease.action = normalizedId(input.action, lease.action);
    lease.profileToken = normalizedId(input.profileToken, lease.profileToken || null);
    state.lastActivityAt = now;
    state.lastActor = userId;
    state.lastAction = lease.action;
    state.settleUntil = Math.max(state.settleUntil, now + this.settleMs);
    this.abortPermits(state, 'ptz-touch', { interactionId, userId, clientId });
    return this.publicLeaseState(state, lease);
  }

  end(cameraId, input = {}) {
    const state = this.stateFor(cameraId);
    const now = Date.now();
    this.cleanupState(state, now);
    const interactionId = normalizedId(input.interactionId);
    if (!interactionId) throw new AppError(400, 'PTZ_INTERACTION_REQUIRED', 'PTZ-Interaktions-ID fehlt');
    const lease = state.leases.get(interactionId);
    if (!lease) {
      const tombstone = state.tombstones.get(interactionId);
      return {
        ...this.publicState(state),
        interactionId,
        alreadyClosed: Boolean(tombstone),
        closeReason: tombstone?.reason || 'not-found',
      };
    }
    const userId = normalizedId(input.userId, lease.userId);
    const clientId = normalizedId(input.clientId, lease.clientId);
    if (lease.userId !== userId || lease.clientId !== clientId) {
      throw new AppError(403, 'PTZ_INTERACTION_OWNER_MISMATCH', 'PTZ-Interaktion gehoert zu einer anderen Sitzung');
    }
    state.leases.delete(interactionId);
    state.revision += 1;
    state.lastReleasedAt = now;
    state.lastActor = userId;
    state.lastAction = normalizedId(input.action, 'stop');
    state.settleUntil = Math.max(state.settleUntil, now + this.settleMs);
    state.tombstones.set(interactionId, {
      interactionId,
      userId,
      clientId,
      closedAt: now,
      expiresAt: now + this.tombstoneTtlMs,
      reason: normalizedId(input.reason, 'stopped'),
      revision: state.revision,
    });
    this.emitState(state, 'lease-ended');
    return {
      ...this.publicState(state),
      interactionId,
      alreadyClosed: false,
      closeReason: normalizedId(input.reason, 'stopped'),
    };
  }

  findLease(cameraId, input = {}) {
    const state = this.states.get(String(cameraId));
    if (!state) return null;
    this.cleanupState(state, Date.now());
    const interactionId = normalizedId(input.interactionId);
    if (interactionId) {
      const lease = state.leases.get(interactionId);
      return lease ? { ...lease } : null;
    }
    const userId = normalizedId(input.userId);
    const clientId = normalizedId(input.clientId);
    const candidates = [...state.leases.values()]
      .filter((lease) => (!userId || lease.userId === userId) && (!clientId || lease.clientId === clientId))
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
    return candidates[0] ? { ...candidates[0] } : null;
  }

  isBlocked(cameraId, now = Date.now()) {
    const state = this.states.get(String(cameraId));
    if (!state) return false;
    this.cleanupState(state, now);
    return state.leases.size > 0 || state.settleUntil > now;
  }

  blockDetails(cameraId, now = Date.now()) {
    const state = this.states.get(String(cameraId));
    if (!state) return null;
    this.cleanupState(state, now);
    if (!state.leases.size && state.settleUntil <= now) return null;
    return {
      cameraId: state.cameraId,
      activeLeases: state.leases.size,
      activeUsers: [...new Set([...state.leases.values()].map((lease) => lease.userId))].length,
      settleUntil: iso(state.settleUntil),
      revision: state.revision,
      reason: state.leases.size ? 'active-ptz-lease' : 'post-ptz-settle',
    };
  }

  noteSuppressedEvent(cameraId) {
    const state = this.stateFor(cameraId);
    state.suppressedEvents += 1;
  }

  noteSuppressedStart(cameraId) {
    const state = this.stateFor(cameraId);
    state.suppressedStarts += 1;
  }

  acquireAutomaticPermit(cameraId, context = {}) {
    const state = this.stateFor(cameraId);
    const now = Date.now();
    this.cleanupState(state, now);
    const blocked = this.blockDetails(cameraId, now);
    if (blocked) {
      state.suppressedStarts += 1;
      throw new AutomaticRecordingSuppressedError(cameraId, { ...blocked, context });
    }
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const permit = {
      id,
      cameraId: state.cameraId,
      revision: state.revision,
      createdAt: now,
      context,
      controller,
      released: false,
      assert: (stage = 'unknown') => {
        if (permit.released) throw new AutomaticRecordingSuppressedError(cameraId, { reason: 'permit-released', stage, context });
        if (controller.signal.aborted) throw controller.signal.reason || new AutomaticRecordingSuppressedError(cameraId, { reason: 'permit-aborted', stage, context });
        const current = this.stateFor(cameraId);
        this.cleanupState(current, Date.now());
        if (current.revision !== permit.revision || this.isBlocked(cameraId)) {
          const error = new AutomaticRecordingSuppressedError(cameraId, {
            reason: 'ptz-revision-changed',
            stage,
            permitRevision: permit.revision,
            currentRevision: current.revision,
            context,
            ...(this.blockDetails(cameraId) || {}),
          });
          if (!controller.signal.aborted) controller.abort(error);
          throw error;
        }
        return true;
      },
      release: () => {
        if (permit.released) return;
        permit.released = true;
        state.permits.delete(id);
      },
    };
    state.permits.set(id, permit);
    return permit;
  }

  publicLeaseState(state, lease, extra = {}) {
    return {
      ...this.publicState(state),
      interaction: {
        interactionId: lease.interactionId,
        action: lease.action,
        profileToken: lease.profileToken || null,
        startedAt: iso(lease.startedAt),
        lastSeenAt: iso(lease.lastSeenAt),
        expiresAt: iso(lease.expiresAt),
        sequence: lease.sequence,
        revision: lease.revision,
      },
      ...extra,
    };
  }

  publicState(state, now = Date.now()) {
    this.cleanupState(state, now);
    const leases = [...state.leases.values()];
    return {
      cameraId: state.cameraId,
      blocked: leases.length > 0 || state.settleUntil > now,
      active: leases.length > 0,
      settling: leases.length === 0 && state.settleUntil > now,
      activeLeases: leases.length,
      activeUsers: [...new Set(leases.map((lease) => lease.userId))].length,
      revision: state.revision,
      settleUntil: iso(state.settleUntil),
      lastActivityAt: iso(state.lastActivityAt),
      lastReleasedAt: iso(state.lastReleasedAt),
      lastAction: state.lastAction,
      pendingAutomaticStarts: state.permits.size,
      suppressedEvents: state.suppressedEvents,
      suppressedStarts: state.suppressedStarts,
      leases: leases.map((lease) => ({
        interactionId: lease.interactionId,
        action: lease.action,
        profileToken: lease.profileToken || null,
        startedAt: iso(lease.startedAt),
        lastSeenAt: iso(lease.lastSeenAt),
        expiresAt: iso(lease.expiresAt),
        sequence: lease.sequence,
      })),
    };
  }

  status(cameraId = null) {
    if (cameraId !== null && cameraId !== undefined) return this.publicState(this.stateFor(cameraId));
    return [...this.states.values()].map((state) => this.publicState(state));
  }

  emitState(state, reason) {
    const snapshot = this.publicState(state);
    this.emit('state', { reason, ...snapshot });
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const state of this.states.values()) {
      this.abortPermits(state, 'shutdown');
    }
    this.states.clear();
    this.removeAllListeners();
  }
}

export const ptzAutomationInterlock = new PtzAutomationInterlock();

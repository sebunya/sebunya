import { createHash } from 'crypto';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { DELIVERY_STATES, REPLAYABLE, type DeliveryRow, type DeliveryState, type MeasurementOperationsRepository, type AttributionPort } from '../../ports/MeasurementOperations';

type R<T> = { ok: true; value: T } | { ok: false; code: 'BAD_INPUT' | 'NOT_FOUND' | 'CONFLICT'; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BULK = 200;
/** Ad platforms refuse website events older than ~7 days; replaying those would only fail. */
const AD_MAX_AGE_MS = 7 * 24 * 3600_000;

export interface ReplayPreview { eligible: string[]; ineligible: Array<{ deliveryId: string; reason: string }>; digest: string }

/**
 * Operator actions on measurement deliveries (dossier §5.5, §10): bounded,
 * reason-required, previewed before bulk replay, audited, and never a new
 * business event — a replay is a new scheduling episode for the SAME delivery
 * and provider event id.
 */
export class MeasurementOperationsUseCases {
  constructor(private readonly repo: MeasurementOperationsRepository, private readonly audit: CreateAuditLogUseCase, private readonly attribution?: AttributionPort, private readonly now: () => Date = () => new Date()) {}

  attributionLatest() { if (!this.attribution) throw new Error('attribution not wired'); return this.attribution.latest(); }

  /** Run attribution now: still admitted by the host lease and headroom; audited. */
  async runAttribution(actorId: string | null, reason: string): Promise<R<{ state: string; reason: string | null; batchRunId: string }>> {
    if (!this.attribution) return { ok: false, code: 'BAD_INPUT', message: 'Attribution is not wired' };
    if (reason.trim().length < 5) return { ok: false, code: 'BAD_INPUT', message: 'Give a reason (5+ characters)' };
    const r = await this.attribution.runNow('operator');
    await this.audit.execute({ actorId, action: 'MEASUREMENT_ATTRIBUTION_RUN', entity: 'measurement_batch', entityId: r.batchRunId, newState: { reason: reason.trim().slice(0, 500), state: r.state, deferredBecause: r.reason } } as never);
    return { ok: true, value: r };
  }

  summary() { return this.repo.summary(); }

  list(q: { states?: string[]; sink?: string; limit?: number; before?: string }): Promise<DeliveryRow[]> {
    const states = (q.states ?? []).filter((s): s is DeliveryState => (DELIVERY_STATES as readonly string[]).includes(s));
    const sink = q.sink && /^[a-z0-9:_]{2,60}$/.test(q.sink) ? q.sink : undefined;
    const before = q.before && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before).toISOString() : undefined;
    return this.repo.list({ states: states.length ? states : undefined, sink, limit: Math.min(Math.max(q.limit ?? 50, 1), 200), before });
  }

  async get(id: string) {
    if (!UUID.test(id)) return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Delivery not found.' };
    const d = await this.repo.get(id);
    return d ? { ok: true as const, value: d } : { ok: false as const, code: 'NOT_FOUND' as const, message: 'Delivery not found.' };
  }

  /** Which of these deliveries a replay would schedule, and why the rest would not. */
  async previewReplay(ids: string[]): Promise<R<ReplayPreview>> {
    const clean = [...new Set(ids.filter((i) => UUID.test(i)))];
    if (clean.length === 0 || clean.length > MAX_BULK) return { ok: false, code: 'BAD_INPUT', message: `Select between 1 and ${MAX_BULK} deliveries.` };
    const rows = await this.repo.getMany(clean);
    const found = new Map(rows.map((r) => [r.deliveryId, r]));
    const eligible: string[] = []; const ineligible: Array<{ deliveryId: string; reason: string }> = [];
    for (const id of clean) {
      const r = found.get(id);
      if (!r) { ineligible.push({ deliveryId: id, reason: 'NOT_FOUND' }); continue; }
      if (!REPLAYABLE.includes(r.state)) { ineligible.push({ deliveryId: id, reason: `STATE_${r.state}` }); continue; }
      if (r.sink.startsWith('ad:') && this.now().getTime() - new Date(r.occurredAt).getTime() > AD_MAX_AGE_MS) { ineligible.push({ deliveryId: id, reason: 'EXPIRED_EVENT' }); continue; }
      eligible.push(id);
    }
    const digest = createHash('sha256').update(eligible.slice().sort().join(',')).digest('hex').slice(0, 16);
    return { ok: true, value: { eligible, ineligible, digest } };
  }

  /** Replays exactly what the preview showed (digest must match), with a reason. */
  async replay(actorId: string | null, ids: string[], digest: string, reason: string): Promise<R<{ scheduled: number }>> {
    if (!reason || reason.trim().length < 5) return { ok: false, code: 'BAD_INPUT', message: 'Give a reason (at least 5 characters).' };
    const p = await this.previewReplay(ids);
    if (!p.ok) return p;
    if (p.value.digest !== digest) return { ok: false, code: 'CONFLICT', message: 'The selection changed since the preview; preview again.' };
    const scheduled = p.value.eligible.length ? await this.repo.replay(p.value.eligible) : 0;
    await this.audit.execute({ actorId, action: 'MEASUREMENT_DELIVERY_REPLAYED', entity: 'measurement_delivery', entityId: 'bulk',
      newState: { scheduled, eligible: p.value.eligible, reason: reason.trim().slice(0, 500) } } as never);
    return { ok: true, value: { scheduled } };
  }

  async quarantine(actorId: string | null, ids: string[], reason: string, to: 'QUARANTINED' | 'CANCELLED'): Promise<R<{ changed: number }>> {
    const clean = [...new Set(ids.filter((i) => UUID.test(i)))];
    if (!reason || reason.trim().length < 5) return { ok: false, code: 'BAD_INPUT', message: 'Give a reason (at least 5 characters).' };
    if (clean.length === 0 || clean.length > MAX_BULK) return { ok: false, code: 'BAD_INPUT', message: `Select between 1 and ${MAX_BULK} deliveries.` };
    // Only undelivered work can be stopped; an accepted delivery stays as it is.
    const changed = await this.repo.setState(clean, ['PENDING', 'RETRY_WAIT', 'UNKNOWN_OUTCOME', 'DEAD_LETTER', 'QUARANTINED'], to, `OPERATOR: ${reason.trim().slice(0, 200)}`);
    await this.audit.execute({ actorId, action: to === 'CANCELLED' ? 'MEASUREMENT_DELIVERY_CANCELLED' : 'MEASUREMENT_DELIVERY_QUARANTINED', entity: 'measurement_delivery', entityId: 'bulk',
      newState: { changed, ids: clean, reason: reason.trim().slice(0, 500) } } as never);
    return { ok: true, value: { changed } };
  }

  async setKillSwitch(actorId: string | null, on: boolean, reason: string): Promise<R<{ on: boolean }>> {
    if (!reason || reason.trim().length < 5) return { ok: false, code: 'BAD_INPUT', message: 'Give a reason (at least 5 characters).' };
    await this.repo.setKillSwitch(on, reason.trim().slice(0, 500), actorId);
    await this.audit.execute({ actorId, action: on ? 'MEASUREMENT_KILL_SWITCH_ON' : 'MEASUREMENT_KILL_SWITCH_OFF', entity: 'measurement_control', entityId: 'kill_switch',
      newState: { on, reason: reason.trim().slice(0, 500) } } as never);
    return { ok: true, value: { on } };
  }
}

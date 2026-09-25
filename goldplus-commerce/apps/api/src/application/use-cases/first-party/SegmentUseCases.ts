import {
  SegmentDefinition, validateSegmentDefinition, segmentMembers, segmentContextFor, describeRule, segmentKeyFromName,
} from '../../../domain/first-party/Segments';
import type { ICustomerFactsReader, ISegmentRepository, IOrderIdentityBackfillReader, SegmentRecord } from '../../ports/first-party/FirstPartyPorts';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { StitchCustomerIdentityUseCase } from './StitchCustomerIdentityUseCase';

type Fail = { ok: false; code: string; message: string; errors?: string[] };
const fail = (code: string, message: string, errors?: string[]): Fail => ({ ok: false, code, message, ...(errors ? { errors } : {}) });

/** First eight characters only: a preview never lists raw customer ids. */
const maskId = (id: string) => `${id.slice(0, 8)}…`;

export class ManageSegmentsUseCase {
  constructor(
    private readonly segments: ISegmentRepository,
    private readonly facts: ICustomerFactsReader,
    private readonly audit: IAuditRepository,
  ) {}

  async list(includeArchived = false) {
    const [rows, categories] = await Promise.all([this.segments.list(includeArchived), this.facts.listCategories().catch(() => [])]);
    const name = (id: string) => categories.find((c) => c.id === id)?.name;
    return rows.map((s) => ({ ...s, rulesDescribed: s.definition.rules.map((r) => describeRule(r, name)) }));
  }

  categories() {
    return this.facts.listCategories();
  }

  async create(input: { name: string; description?: string | null; definition: unknown; actorId: string }): Promise<{ ok: true; segment: SegmentRecord } | Fail> {
    const name = (input.name ?? '').trim();
    if (name.length < 3 || name.length > 120) return fail('BAD_INPUT', 'Give the segment a name of 3 to 120 characters.');
    const key = segmentKeyFromName(name);
    if (!key) return fail('BAD_INPUT', 'The name needs at least three letters or numbers.');
    const v = validateSegmentDefinition(input.definition);
    if (!v.ok) return fail('BAD_DEFINITION', 'The rules are not valid.', v.errors);
    if (await this.segments.findByKey(key)) return fail('DUPLICATE', 'A segment with that name already exists.');
    const segment = await this.segments.create({ key, name, description: input.description?.trim() || null, definition: v.definition, actorId: input.actorId });
    await new CreateAuditLogUseCase(this.audit).execute({ actorId: input.actorId, action: 'CUSTOMER_SEGMENT_CREATED', entity: 'customer_segment', entityId: segment.id, newState: { key, definition: v.definition } });
    return { ok: true, segment };
  }

  async update(id: string, input: { name: string; description?: string | null; definition: unknown; actorId: string }): Promise<{ ok: true; segment: SegmentRecord } | Fail> {
    const existing = await this.segments.findById(id);
    if (!existing) return fail('NOT_FOUND', 'Segment not found.');
    const name = (input.name ?? '').trim();
    if (name.length < 3 || name.length > 120) return fail('BAD_INPUT', 'Give the segment a name of 3 to 120 characters.');
    const v = validateSegmentDefinition(input.definition);
    if (!v.ok) return fail('BAD_DEFINITION', 'The rules are not valid.', v.errors);
    const segment = await this.segments.update(id, { name, description: input.description?.trim() || null, definition: v.definition, actorId: input.actorId });
    if (!segment) return fail('NOT_FOUND', 'Segment not found.');
    await new CreateAuditLogUseCase(this.audit).execute({ actorId: input.actorId, action: 'CUSTOMER_SEGMENT_UPDATED', entity: 'customer_segment', entityId: id, previousState: { name: existing.name, definition: existing.definition }, newState: { name, definition: v.definition } });
    return { ok: true, segment };
  }

  async setArchived(id: string, archived: boolean, actorId: string): Promise<{ ok: true } | Fail> {
    const ok = await this.segments.setStatus(id, archived ? 'ARCHIVED' : 'ACTIVE', actorId);
    if (!ok) return fail('NOT_FOUND', 'Segment not found.');
    await new CreateAuditLogUseCase(this.audit).execute({ actorId, action: archived ? 'CUSTOMER_SEGMENT_ARCHIVED' : 'CUSTOMER_SEGMENT_RESTORED', entity: 'customer_segment', entityId: id });
    return { ok: true };
  }

  /** Count + masked sample for an unsaved definition. Reads live facts; stores nothing. */
  async preview(definition: unknown, now = new Date()): Promise<{ ok: true; count: number; customersEvaluated: number; sample: string[] } | Fail> {
    const v = validateSegmentDefinition(definition);
    if (!v.ok) return fail('BAD_DEFINITION', 'The rules are not valid.', v.errors);
    const facts = await this.facts.readAll(now);
    const members = segmentMembers(v.definition, facts, now);
    return { ok: true, count: members.length, customersEvaluated: facts.length, sample: members.slice(0, 20).map(maskId) };
  }

  async members(id: string, limit = 50) {
    const segment = await this.segments.findById(id);
    if (!segment) return fail('NOT_FOUND', 'Segment not found.');
    const rows = await this.segments.listMembers(id, Math.min(Math.max(1, limit), 200));
    return { ok: true as const, segment, members: rows.map((r) => ({ customer: maskId(r.canonicalCustomerId), canonicalCustomerId: r.canonicalCustomerId, firstMatchedAt: r.firstMatchedAt })) };
  }

  runs(limit = 10) {
    return this.segments.listRuns(Math.min(Math.max(1, limit), 50));
  }
}

const BACKFILL_BATCH = 500;

/**
 * The nightly job: (1) link historical orders to customers (the backfill that
 * makes LTV and segments cover orders placed before stitching switched on),
 * (2) materialise every ACTIVE segment. One run at a time is the caller's
 * lock; this records each run so "never run" and "ran, zero members" differ.
 */
export class MaterialiseSegmentsUseCase {
  constructor(
    private readonly segments: ISegmentRepository,
    private readonly facts: ICustomerFactsReader,
    private readonly backfill: IOrderIdentityBackfillReader,
    private readonly stitch: StitchCustomerIdentityUseCase,
  ) {}

  async execute(input: { trigger: string; now?: Date; backfillLimit?: number }): Promise<{ runId: string; status: 'COMPLETE' | 'FAILED'; ordersStitched: number; customersEvaluated: number; segments: Array<{ id: string; total: number; added: number; removed: number }>; error?: string }> {
    const now = input.now ?? new Date();
    const runId = await this.segments.startRun(input.trigger);
    let ordersStitched = 0;
    const out: Array<{ id: string; total: number; added: number; removed: number }> = [];
    try {
      const limit = Math.min(input.backfillLimit ?? BACKFILL_BATCH, 5000);
      const pending = limit > 0 ? await this.backfill.listUnlinkedOrders(limit) : [];
      for (const o of pending) {
        const r = await this.stitch.execute({
          moment: 'BACKFILL', accountUserId: o.userId, contactEmail: o.customerEmail, contactPhone: o.customerPhone,
          orderId: o.orderId, experienceProfileId: o.profileId, fpClientId: o.fpClientId,
        }).catch(() => null);
        if (r?.canonicalCustomerId) ordersStitched++;
      }
      const facts = await this.facts.readAll(now);
      const active = (await this.segments.list(false)).filter((s) => s.status === 'ACTIVE');
      const context = segmentContextFor(active.map((s) => s.definition), facts, now);
      for (const s of active) {
        const members = segmentMembers(s.definition, facts, now, context);
        const r = await this.segments.replaceMembers(s.id, runId, members, now);
        out.push({ id: s.id, ...r });
      }
      await this.segments.finishRun(runId, { status: 'COMPLETE', customersEvaluated: facts.length, segmentsEvaluated: active.length, ordersStitched, stats: { segments: out, backfillCandidates: pending.length } });
      return { runId, status: 'COMPLETE', ordersStitched, customersEvaluated: facts.length, segments: out };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'MATERIALISE_FAILED';
      await this.segments.finishRun(runId, { status: 'FAILED', ordersStitched, error: message }).catch(() => undefined);
      return { runId, status: 'FAILED', ordersStitched, customersEvaluated: 0, segments: out, error: message };
    }
  }
}

export type { SegmentDefinition };

import { randomBytes } from 'node:crypto';
import {
  ERASURE_KINDS, PrivacyRequestKind, isPrivacyRequestKind, mayFulfilErasure, mayRequestExport, privacyReference,
} from '../../../domain/first-party/PrivacyRequests';
import type {
  IPersonalDataEraser, IPersonalDataExporter, IPrivacyRequestRepository, PrivacyRequestRecord,
} from '../../ports/first-party/FirstPartyPorts';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/** What a customer sees about their own request (no staff identity). */
function forCustomer(r: PrivacyRequestRecord) {
  return {
    id: r.id, reference: r.reference, kind: r.kind, status: r.status,
    requestedAt: r.requestedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
    decisionReason: r.status === 'DECLINED' ? r.decisionReason : null,
  };
}

/**
 * A customer's own data rights (0157, docs/first-party/README.md).
 *
 * Customer side (signed in): download everything we hold about them now,
 * request that their history be anonymised or their account deleted, see and
 * withdraw their requests. Staff side (privacy.manage): list requests, carry an
 * erasure out (typing the reference to confirm) or decline it with a reason.
 * Every step writes an audit row; the request row keeps counts, never values.
 */
export class PrivacyRequestUseCases {
  constructor(
    private readonly requests: IPrivacyRequestRepository,
    private readonly exporter: IPersonalDataExporter,
    private readonly eraser: IPersonalDataEraser,
    private readonly audit: IAuditRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly reference: () => string = () => privacyReference(randomBytes(6)),
  ) {}

  private async log(actorId: string | null, action: string, entityId: string, newState: unknown, previousState?: unknown) {
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: actorId && UUID.test(actorId) ? actorId : null, action, entity: 'privacy_request', entityId, newState, previousState,
    });
  }

  async listMine(userId: string) {
    return (await this.requests.listForUser(userId, 20)).map(forCustomer);
  }

  /** The customer's data, served at once. Recorded and audited; rate-limited. */
  async exportMyData(userId: string): Promise<{ ok: true; reference: string; generatedAt: string; data: Record<string, unknown> } | Fail> {
    const now = this.now();
    const gate = mayRequestExport(await this.requests.countExportsSince(userId, new Date(now.getTime() - DAY_MS)));
    if (!gate.ok) return fail(gate.code, 'You have downloaded your data several times today. Please try again tomorrow, or contact support.');
    const collected = await this.exporter.collect(userId);
    if (!collected) return fail('ACCOUNT_NOT_FOUND', 'Sign in again to download your data.');
    const { record } = await this.requests.create({
      reference: this.reference(), userId, kind: 'EXPORT', status: 'COMPLETED', customerNote: null, idempotencyKey: null,
      result: { counts: collected.counts },
    });
    await this.log(userId, 'PRIVACY_EXPORT_SERVED', record.id, { reference: record.reference, counts: collected.counts });
    return {
      ok: true, reference: record.reference, generatedAt: now.toISOString(),
      data: {
        about: 'Everything GoldPlus holds about your account, as of the time shown. Order amounts are kept for accounting; supplier costs and internal notes are not personal data and are not included.',
        reference: record.reference,
        generatedAt: now.toISOString(),
        ...collected.sections,
      },
    };
  }

  async requestErasure(input: { userId: string; kind: string; note?: string | null; idempotencyKey?: string | null }): Promise<{ ok: true; request: ReturnType<typeof forCustomer>; alreadyOpen: boolean } | Fail> {
    if (!isPrivacyRequestKind(input.kind) || !ERASURE_KINDS.includes(input.kind)) return fail('BAD_INPUT', 'Choose what you would like us to do.');
    const note = (input.note ?? '').trim().slice(0, 1000) || null;
    const { record, created } = await this.requests.create({
      reference: this.reference(), userId: input.userId, kind: input.kind as PrivacyRequestKind, status: 'RECEIVED',
      customerNote: note, idempotencyKey: input.idempotencyKey?.trim().slice(0, 80) || null,
    });
    if (created) await this.log(input.userId, 'PRIVACY_REQUEST_RECEIVED', record.id, { reference: record.reference, kind: record.kind });
    return { ok: true, request: forCustomer(record), alreadyOpen: !created };
  }

  async withdraw(input: { userId: string; requestId: string }): Promise<{ ok: true } | Fail> {
    if (!UUID.test(input.requestId)) return fail('NOT_FOUND', 'Request not found.');
    const r = await this.requests.findById(input.requestId);
    if (!r || r.userId !== input.userId) return fail('NOT_FOUND', 'Request not found.');
    if (r.status !== 'RECEIVED') return fail('NOT_OPEN', 'This request is already closed.');
    const moved = await this.requests.transition(r.id, { to: 'WITHDRAWN', actorId: input.userId, reason: 'withdrawn by the customer' });
    if (!moved) return fail('NOT_OPEN', 'This request is already closed.');
    await this.log(input.userId, 'PRIVACY_REQUEST_WITHDRAWN', r.id, { reference: r.reference }, { status: r.status });
    return { ok: true };
  }

  // ── staff ────────────────────────────────────────────────────────────────

  async list(status: string | null) {
    const s = status === 'RECEIVED' || status === 'COMPLETED' || status === 'DECLINED' || status === 'WITHDRAWN' ? status : null;
    const rows = await this.requests.list({ status: s, limit: 100 });
    const withOrders = await Promise.all(rows.map(async (r) => ({
      ...r,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      openOrders: r.status === 'RECEIVED' && r.kind !== 'EXPORT' ? await this.eraser.openOrderCount(r.userId).catch(() => null) : null,
    })));
    return withOrders;
  }

  async fulfil(input: { requestId: string; actorId: string; confirmation: string; reason: string }): Promise<{ ok: true; counts: Record<string, number> } | Fail> {
    if (!UUID.test(input.requestId)) return fail('NOT_FOUND', 'Request not found.');
    const reason = (input.reason ?? '').trim();
    if (reason.length < 5) return fail('BAD_INPUT', 'Say how the customer\'s identity was confirmed or why this is being done (at least 5 characters).');
    const r = await this.requests.findById(input.requestId);
    if (!r) return fail('NOT_FOUND', 'Request not found.');
    const openOrders = r.kind === 'EXPORT' ? 0 : await this.eraser.openOrderCount(r.userId);
    const gate = mayFulfilErasure({ status: r.status, kind: r.kind, openOrders, confirmation: input.confirmation ?? '', reference: r.reference });
    if (!gate.ok) {
      const messages: Record<string, string> = {
        NOT_OPEN: 'This request is already closed.',
        NOT_AN_ERASURE: 'Only an anonymisation or deletion request is carried out here.',
        CONFIRMATION_MISMATCH: `Type the reference ${r.reference} to confirm.`,
        OPEN_ORDERS: `The customer has ${openOrders} order${openOrders === 1 ? '' : 's'} still open. Finish or cancel ${openOrders === 1 ? 'it' : 'them'} first: the delivery needs the contact details.`,
      };
      return fail(gate.code, messages[gate.code]);
    }
    const kind = r.kind as 'ANONYMISE_HISTORY' | 'DELETE_ACCOUNT';
    const done = await this.eraser.erase({ userId: r.userId, kind, requestId: r.id, actorId: input.actorId, reason: reason.slice(0, 1000) });
    if (!done.completed) return fail('NOT_OPEN', 'This request was closed by someone else meanwhile. Nothing was changed.');
    await this.log(input.actorId, 'PRIVACY_REQUEST_COMPLETED', r.id, { reference: r.reference, kind, counts: done.counts, reason }, { status: r.status });
    return { ok: true, counts: done.counts };
  }

  async decline(input: { requestId: string; actorId: string; reason: string }): Promise<{ ok: true } | Fail> {
    if (!UUID.test(input.requestId)) return fail('NOT_FOUND', 'Request not found.');
    const reason = (input.reason ?? '').trim();
    if (reason.length < 10) return fail('BAD_INPUT', 'Give the customer a reason (at least 10 characters). They will see it.');
    const r = await this.requests.findById(input.requestId);
    if (!r) return fail('NOT_FOUND', 'Request not found.');
    if (r.status !== 'RECEIVED') return fail('NOT_OPEN', 'This request is already closed.');
    const moved = await this.requests.transition(r.id, { to: 'DECLINED', actorId: input.actorId, reason: reason.slice(0, 1000) });
    if (!moved) return fail('NOT_OPEN', 'This request is already closed.');
    await this.log(input.actorId, 'PRIVACY_REQUEST_DECLINED', r.id, { reference: r.reference, reason }, { status: r.status });
    return { ok: true };
  }
}

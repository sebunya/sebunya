import { FulfilmentLine, FulfilmentLineSnapshot, deriveTaskFulfilment, unresolvedQuantity } from '../../../domain/fulfilment/FulfilmentLine';
import { isTerminalFulfilmentStatus } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IFulfilmentLineRepository, IPackingSessionRepository, PackingSessionSnapshot } from '../../ports/IFulfilmentLineRepository';
import { IFulfilmentLineSourceReader } from '../../ports/IFulfilmentLineSourceReader';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export type PackingError =
  | 'NOT_FOUND' | 'TASK_ON_HOLD' | 'TASK_NOT_PACKABLE' | 'INVALID_QUANTITY'
  | 'INSUFFICIENT_RESERVED_STOCK' | 'EXCEEDS_ORDERED' | 'STALE_FULFILMENT_VERSION'
  | 'UNRESOLVED_REMAINDER' | 'UNKNOWN_LINE';

type Fail = { ok: false; code: PackingError; message: string };
const fail = (code: PackingError, message: string): Fail => ({ ok: false, code, message });

async function audit(auditRepo: IAuditRepository, actorId: string, action: string, entityId: string, newState: unknown, previousState?: unknown) {
  await new CreateAuditLogUseCase(auditRepo).execute({ actorId, action, entity: 'fulfilment_line', entityId, previousState, newState });
}

/** Initialise fulfilment lines from authoritative order items + real reservations. Idempotent. */
export class InitialiseFulfilmentLinesUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly lines: IFulfilmentLineRepository,
    private readonly source: IFulfilmentLineSourceReader
  ) {}
  async execute(taskId: string): Promise<{ ok: true; created: number } | Fail> {
    const task = await this.tasks.findById(taskId);
    if (!task) return fail('NOT_FOUND', 'Fulfilment task not found.');
    const existing = await this.lines.findByTask(taskId);
    if (existing.length > 0) return { ok: true, created: 0 };
    const init = await this.source.readForOrder(task.orderId);
    const { created } = await this.lines.initialiseForTask(taskId, init);
    return { ok: true, created };
  }
}

export interface PackingDetail {
  taskId: string;
  status: string;
  onHold: boolean;
  lines: FulfilmentLineSnapshot[];
  session: PackingSessionSnapshot | null;
  derived: string;
  fullyResolved: boolean;
}

export class GetPackingDetailUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly lines: IFulfilmentLineRepository,
    private readonly sessions: IPackingSessionRepository
  ) {}
  async execute(taskId: string): Promise<{ ok: true; detail: PackingDetail } | Fail> {
    const task = await this.tasks.findById(taskId);
    if (!task) return fail('NOT_FOUND', 'Fulfilment task not found.');
    const lines = await this.lines.findByTask(taskId);
    const session = await this.sessions.getByTask(taskId);
    const fullyResolved = lines.length > 0 && lines.every((l) => unresolvedQuantity(l) === 0);
    return {
      ok: true,
      detail: {
        taskId, status: task.status, onHold: task.status === 'ON_HOLD',
        lines, session, derived: deriveTaskFulfilment(lines), fullyResolved,
      },
    };
  }
}

function packableGuard(status: string): Fail | null {
  if (status === 'ON_HOLD') return fail('TASK_ON_HOLD', 'Task is ON_HOLD and cannot be packed.');
  if (isTerminalFulfilmentStatus(status as any)) return fail('TASK_NOT_PACKABLE', `Task is ${status} and cannot be packed.`);
  return null;
}

export class StartPackingUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly sessions: IPackingSessionRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { taskId: string; actorId: string }): Promise<{ ok: true; session: PackingSessionSnapshot } | Fail> {
    const task = await this.tasks.findById(input.taskId);
    if (!task) return fail('NOT_FOUND', 'Fulfilment task not found.');
    const guard = packableGuard(task.status);
    if (guard) return guard;
    const session = await this.sessions.startForTask(input.taskId, input.actorId);
    await audit(this.audit, input.actorId, 'PACKING_STARTED', input.taskId, { status: session.status });
    return { ok: true, session };
  }
}

/** Apply absolute packed quantities per line with optimistic version checks. */
export class UpdatePackedQuantitiesUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly lines: IFulfilmentLineRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { taskId: string; actorId: string; updates: { lineId: string; packed: number; expectedVersion: number }[] }): Promise<{ ok: true; updated: number } | Fail> {
    const task = await this.tasks.findById(input.taskId);
    if (!task) return fail('NOT_FOUND', 'Fulfilment task not found.');
    const guard = packableGuard(task.status);
    if (guard) return guard;

    // Validate all lines first, then apply (per-line optimistic version).
    let updated = 0;
    for (const u of input.updates) {
      const snap = await this.lines.findById(u.lineId);
      if (!snap || snap.fulfilmentTaskId !== input.taskId) return fail('UNKNOWN_LINE', `Line ${u.lineId} not found on this task.`);
      if (snap.version !== u.expectedVersion) return fail('STALE_FULFILMENT_VERSION', `Line ${u.lineId} was modified concurrently.`);
      const line = FulfilmentLine.rehydrate(snap);
      try {
        line.setPacked(u.packed);
      } catch (e: any) {
        const code = (e?.message as PackingError) ?? 'INVALID_QUANTITY';
        return fail(['INSUFFICIENT_RESERVED_STOCK', 'EXCEEDS_ORDERED', 'INVALID_QUANTITY'].includes(code) ? code : 'INVALID_QUANTITY', e?.message ?? 'Invalid quantity.');
      }
      const res = await this.lines.updateWithVersion(line, u.expectedVersion);
      if (!res.updated) return fail('STALE_FULFILMENT_VERSION', `Line ${u.lineId} was modified concurrently.`);
      await audit(this.audit, input.actorId, 'PACKED_QUANTITIES_UPDATED', u.lineId, { packed: u.packed }, { packed: snap.packedQuantity });
      updated++;
    }
    return { ok: true, updated };
  }
}

/** Backorder or cancel a remainder on a line (optimistic version). */
export class ResolveRemainderUseCase {
  constructor(
    private readonly lines: IFulfilmentLineRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { taskId: string; actorId: string; lineId: string; quantity: number; action: 'backorder' | 'cancel'; expectedVersion: number; reason?: string }): Promise<{ ok: true } | Fail> {
    const snap = await this.lines.findById(input.lineId);
    if (!snap || snap.fulfilmentTaskId !== input.taskId) return fail('UNKNOWN_LINE', 'Line not found on this task.');
    if (snap.version !== input.expectedVersion) return fail('STALE_FULFILMENT_VERSION', 'Line was modified concurrently.');
    const line = FulfilmentLine.rehydrate(snap);
    try {
      if (input.action === 'backorder') line.backorder(input.quantity);
      else line.cancel(input.quantity);
    } catch (e: any) {
      const code = (e?.message as PackingError) ?? 'INVALID_QUANTITY';
      return fail(code === 'UNRESOLVED_REMAINDER' ? 'UNRESOLVED_REMAINDER' : 'INVALID_QUANTITY', e?.message ?? 'Invalid quantity.');
    }
    const res = await this.lines.updateWithVersion(line, input.expectedVersion);
    if (!res.updated) return fail('STALE_FULFILMENT_VERSION', 'Line was modified concurrently.');
    await audit(this.audit, input.actorId, input.action === 'backorder' ? 'ORDER_BACKORDERED' : 'PACKING_REMAINDER_CANCELLED', input.lineId, { quantity: input.quantity, reason: input.reason ?? null });
    return { ok: true };
  }
}

/** Complete packing — forbidden while any line has an unresolved remainder. */
export class CompletePackingUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly lines: IFulfilmentLineRepository,
    private readonly sessions: IPackingSessionRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { taskId: string; actorId: string; packageCount?: number; packageReference?: string; notes?: string }): Promise<{ ok: true; derived: string } | Fail> {
    const task = await this.tasks.findById(input.taskId);
    if (!task) return fail('NOT_FOUND', 'Fulfilment task not found.');
    const guard = packableGuard(task.status);
    if (guard) return guard;
    const lines = await this.lines.findByTask(input.taskId);
    if (lines.length === 0) return fail('TASK_NOT_PACKABLE', 'No fulfilment lines — initialise packing first.');
    if (lines.some((l) => unresolvedQuantity(l) > 0)) {
      return fail('UNRESOLVED_REMAINDER', 'Every remainder must be packed, backordered or cancelled before completion.');
    }
    const derived = deriveTaskFulfilment(lines);
    const sessionStatus = derived === 'PACKED' ? 'COMPLETED' : 'PARTIAL';
    await this.sessions.patch(input.taskId, {
      status: sessionStatus, completedAt: new Date(),
      packageCount: input.packageCount ?? null, packageReference: input.packageReference ?? null, packingNotes: input.notes ?? null,
    });
    await audit(this.audit, input.actorId, 'PACKING_COMPLETED', input.taskId, { derived, sessionStatus });
    return { ok: true, derived };
  }
}

export class RecordPackingExceptionUseCase {
  constructor(private readonly sessions: IPackingSessionRepository, private readonly audit: IAuditRepository) {}
  async execute(input: { taskId: string; actorId: string; reason: string; hold?: boolean }): Promise<{ ok: true } | Fail> {
    const session = await this.sessions.getByTask(input.taskId);
    if (!session) return fail('NOT_FOUND', 'No packing session for this task.');
    await this.sessions.patch(input.taskId, { exceptionReason: input.reason, status: input.hold ? 'ON_HOLD' : session.status });
    await audit(this.audit, input.actorId, 'PACKING_EXCEPTION_RECORDED', input.taskId, { reason: input.reason, hold: !!input.hold });
    return { ok: true };
  }
}

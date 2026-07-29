import { CONTROL_CENTRE_MODULES } from '@goldplus/shared';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

/**
 * Governed module activation approvals.
 *
 * Activation is a recorded human decision, never a deploy-time flag. Each approval
 * names the actor, the reason and the authorising reference, and every approval or
 * revocation writes an audit record.
 *
 * Scope limit that matters: an approval here only ever moves a module's
 * `activationStatus` from DORMANT to ACTIVE, and only for modules whose registry
 * policy is OPERATOR_APPROVAL. It never enables provider delivery, customer
 * communications, payment mutation, loyalty issuance, price or promotion
 * publication, behavioural interventions or experiment traffic — those keep their
 * own domain gates. Approving "automation" makes the automation module active; it
 * does not let automation send anything.
 */

export interface ModuleApprovalRecord {
  id: string;
  moduleKey: string;
  approvedBy: string;
  approvedAt: string;
  reason: string;
  approvalReference: string;
  revokedBy: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  traceId: string | null;
}

export interface IModuleApprovalRepository {
  list(): Promise<ModuleApprovalRecord[]>;
  findLive(moduleKey: string): Promise<ModuleApprovalRecord | null>;
  approve(input: {
    moduleKey: string;
    approvedBy: string;
    reason: string;
    approvalReference: string;
    traceId: string;
  }): Promise<ModuleApprovalRecord>;
  revoke(input: {
    moduleKey: string;
    revokedBy: string;
    revocationReason: string;
  }): Promise<ModuleApprovalRecord | null>;
}

export type ApprovalFailure =
  | { ok: false; code: 'UNKNOWN_MODULE'; message: string }
  | { ok: false; code: 'MODULE_NOT_APPROVAL_GATED'; message: string }
  | { ok: false; code: 'BAD_INPUT'; message: string }
  | { ok: false; code: 'ALREADY_APPROVED'; message: string }
  | { ok: false; code: 'NOT_APPROVED'; message: string };

export type ApprovalResult = { ok: true; record: ModuleApprovalRecord } | ApprovalFailure;

/** Modules the registry says may be activated by approval. */
export function approvalGatedModuleKeys(): string[] {
  return CONTROL_CENTRE_MODULES.filter((m) => m.activationPolicy === 'OPERATOR_APPROVAL').map(
    (m) => m.key,
  );
}

export class ListModuleApprovalsUseCase {
  constructor(private readonly repo: IModuleApprovalRepository) {}

  async execute(): Promise<{
    approvalGatedModules: string[];
    approvals: ModuleApprovalRecord[];
  }> {
    return {
      approvalGatedModules: approvalGatedModuleKeys(),
      approvals: await this.repo.list(),
    };
  }
}

export class ApproveModuleActivationUseCase {
  constructor(
    private readonly repo: IModuleApprovalRepository,
    private readonly audit: CreateAuditLogUseCase,
  ) {}

  async execute(input: {
    moduleKey: string;
    actorId: string;
    reason: string;
    approvalReference: string;
    traceId: string;
  }): Promise<ApprovalResult> {
    const module = CONTROL_CENTRE_MODULES.find((m) => m.key === input.moduleKey);
    if (!module) {
      return { ok: false, code: 'UNKNOWN_MODULE', message: `Unknown module "${input.moduleKey}".` };
    }
    if (module.activationPolicy !== 'OPERATOR_APPROVAL') {
      // Refusing here keeps the ledger meaningful: an approval row for a module
      // that activation approval does not govern would imply a control that does
      // not exist.
      return {
        ok: false,
        code: 'MODULE_NOT_APPROVAL_GATED',
        message: `Module "${module.key}" activates by ${module.activationPolicy}, not operator approval.`,
      };
    }

    const reason = input.reason?.trim() ?? '';
    const reference = input.approvalReference?.trim() ?? '';
    if (!reason) {
      return { ok: false, code: 'BAD_INPUT', message: 'A reason is required to approve activation.' };
    }
    if (!reference) {
      return {
        ok: false,
        code: 'BAD_INPUT',
        message: 'An approval reference (policy, ticket or decision record) is required.',
      };
    }

    const existing = await this.repo.findLive(module.key);
    if (existing) {
      return {
        ok: false,
        code: 'ALREADY_APPROVED',
        message: `Module "${module.key}" already has a live approval. Revoke it before approving again.`,
      };
    }

    const record = await this.repo.approve({
      moduleKey: module.key,
      approvedBy: input.actorId,
      reason,
      approvalReference: reference,
      traceId: input.traceId,
    });

    await this.audit.execute({
      actorId: input.actorId,
      action: 'MODULE_ACTIVATION_APPROVED',
      entity: 'module_activation',
      entityId: record.id,
      previousState: { moduleKey: module.key, activation: 'DORMANT' },
      newState: {
        moduleKey: module.key,
        activation: 'ACTIVE',
        reason,
        approvalReference: reference,
        traceId: input.traceId,
      },
    });

    return { ok: true, record };
  }
}

export class RevokeModuleActivationUseCase {
  constructor(
    private readonly repo: IModuleApprovalRepository,
    private readonly audit: CreateAuditLogUseCase,
  ) {}

  async execute(input: {
    moduleKey: string;
    actorId: string;
    revocationReason: string;
    traceId: string;
  }): Promise<ApprovalResult> {
    const module = CONTROL_CENTRE_MODULES.find((m) => m.key === input.moduleKey);
    if (!module) {
      return { ok: false, code: 'UNKNOWN_MODULE', message: `Unknown module "${input.moduleKey}".` };
    }

    const reason = input.revocationReason?.trim() ?? '';
    if (!reason) {
      return { ok: false, code: 'BAD_INPUT', message: 'A reason is required to revoke activation.' };
    }

    const record = await this.repo.revoke({
      moduleKey: module.key,
      revokedBy: input.actorId,
      revocationReason: reason,
    });
    if (!record) {
      return {
        ok: false,
        code: 'NOT_APPROVED',
        message: `Module "${module.key}" has no live approval to revoke.`,
      };
    }

    await this.audit.execute({
      actorId: input.actorId,
      action: 'MODULE_ACTIVATION_REVOKED',
      entity: 'module_activation',
      entityId: record.id,
      previousState: { moduleKey: module.key, activation: 'ACTIVE' },
      newState: {
        moduleKey: module.key,
        activation: 'DORMANT',
        revocationReason: reason,
        traceId: input.traceId,
      },
    });

    return { ok: true, record };
  }
}

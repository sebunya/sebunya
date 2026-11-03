import { isPaymentsOpsConfigKey, validatePaymentsOpsValue } from '../../../domain/payments/PaymentsOpsConfig';

/** Storage for the payments ops switches (closed registry, ships empty). */
export interface IPaymentsOpsConfigStore {
  values(): Promise<Record<string, string>>;
  upsert(key: string, value: string, actorId: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PaymentsOpsConfigAudit {
  execute(input: {
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    previousState: Record<string, unknown>;
    newState: Record<string, unknown>;
  }): Promise<unknown>;
}

/**
 * The one write path for the payments ops switches (abandonment, synthetic
 * probe, owner review threshold): validated and audited here, not in the Registry.
 */
export class PaymentsOpsConfigUseCase {
  constructor(
    private readonly store: IPaymentsOpsConfigStore,
    private readonly audit: PaymentsOpsConfigAudit,
  ) {}

  values(): Promise<Record<string, string>> {
    return this.store.values();
  }

  async set(input: { key: string; value: string; actorId: string }) {
    if (!isPaymentsOpsConfigKey(input.key)) {
      return { ok: false as const, message: `"${input.key}" is not a payments operational setting.` };
    }
    const check = validatePaymentsOpsValue(input.key, input.value);
    if (!check.ok) return { ok: false as const, message: check.message };
    const before = await this.store.values();
    await this.store.upsert(input.key, String(check.value), input.actorId);
    await this.audit.execute({
      actorId: input.actorId,
      action: 'PAYMENTS_OPS_CONFIG_SET',
      entity: 'payments_ops_config',
      entityId: input.key,
      previousState: { value: before[input.key] ?? null },
      newState: { value: String(check.value) },
    });
    return { ok: true as const };
  }

  /**
   * Unset — the documented way each mechanism is switched OFF (a blank value
   * fails validation, so without this a switch could only be cleared in SQL).
   */
  async unset(input: { key: string; actorId: string }) {
    if (!isPaymentsOpsConfigKey(input.key)) {
      return { ok: false as const, message: `"${input.key}" is not a payments operational setting.` };
    }
    const before = await this.store.values();
    await this.store.remove(input.key);
    await this.audit.execute({
      actorId: input.actorId,
      action: 'PAYMENTS_OPS_CONFIG_UNSET',
      entity: 'payments_ops_config',
      entityId: input.key,
      previousState: { value: before[input.key] ?? null },
      newState: { value: null },
    });
    return { ok: true as const, wasSet: before[input.key] !== undefined };
  }
}

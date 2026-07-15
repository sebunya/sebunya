import { IMerchandisingRuleRepository } from '../../../ports/IRecommendationAdminRepositories';
import { IProductRepository } from '../../../ports/IProductRepository';
import { validateMerchandisingRule, AdminMerchandisingRule } from '../../../../domain/recommendation/AdminMerchandising';

export type MerchandisingRuleResult =
  | { ok: true; rule: AdminMerchandisingRule }
  | { ok: false; code: string; message: string };

function parseDates<T extends { startsAt?: unknown; endsAt?: unknown }>(input: T): T & { startsAt?: Date | null; endsAt?: Date | null } {
  const toDate = (v: unknown): Date | null | undefined => {
    if (v == null || v === '') return null;
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return { ...input, startsAt: toDate(input.startsAt), endsAt: toDate(input.endsAt) };
}

/**
 * Safety gate shared by create/update: a rule that PINS a product to a
 * public shelf must target a product that is safe to show publicly
 * (published, retail-visible). Merchandising can never leak private SKUs.
 */
async function assertPinTargetSafe(
  input: { action?: string; productId?: string | null },
  products: IProductRepository
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (input.action !== 'pin' || !input.productId) return { ok: true };
  const rows = await products.findPublicViewList({ ids: [input.productId], limit: 1 });
  if (rows.length === 0) {
    return { ok: false, code: 'PIN_TARGET_NOT_PUBLIC', message: 'You can only pin products that are published and publicly available.' };
  }
  return { ok: true };
}

export class CreateMerchandisingRuleUseCase {
  constructor(private readonly repo: IMerchandisingRuleRepository, private readonly products: IProductRepository) {}

  async execute(input: Record<string, unknown>, createdBy: string): Promise<MerchandisingRuleResult> {
    const validation = validateMerchandisingRule(parseDates(input as any));
    if (!validation.ok) return validation;
    const safety = await assertPinTargetSafe(validation.value, this.products);
    if (!safety.ok) return safety;
    const rule = await this.repo.create(validation.value, createdBy);
    return { ok: true, rule };
  }
}

export class UpdateMerchandisingRuleUseCase {
  constructor(private readonly repo: IMerchandisingRuleRepository, private readonly products: IProductRepository) {}

  async execute(id: string, input: Record<string, unknown>, _actorId: string): Promise<MerchandisingRuleResult> {
    const existing = await this.repo.findById(id);
    if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Rule not found.' };
    const merged = parseDates({ ...existing, ...input } as any);
    const validation = validateMerchandisingRule(merged);
    if (!validation.ok) return validation;
    const safety = await assertPinTargetSafe(validation.value, this.products);
    if (!safety.ok) return safety;
    const rule = await this.repo.update(id, validation.value);
    if (!rule) return { ok: false, code: 'NOT_FOUND', message: 'Rule not found.' };
    return { ok: true, rule };
  }
}

export class ListMerchandisingRulesUseCase {
  constructor(private readonly repo: IMerchandisingRuleRepository) {}
  execute(): Promise<AdminMerchandisingRule[]> {
    return this.repo.list();
  }
}

export class DeleteMerchandisingRuleUseCase {
  constructor(private readonly repo: IMerchandisingRuleRepository) {}
  async execute(id: string): Promise<{ ok: boolean }> {
    return { ok: await this.repo.delete(id) };
  }
}

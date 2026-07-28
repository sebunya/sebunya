import { ICompatibilityRuleRepository } from '../../../ports/IRecommendationAdminRepositories';
import { validateCompatibilityRule, AdminCompatibilityRule } from '../../../../domain/recommendation/AdminMerchandising';

export type CompatibilityRuleResult =
  | { ok: true; rule: AdminCompatibilityRule }
  | { ok: false; code: string; message: string };

function parseDates(input: any) {
  const toDate = (v: unknown): Date | null | undefined => {
    if (v == null || v === '') return null;
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  return { ...input, startsAt: toDate(input.startsAt), endsAt: toDate(input.endsAt) };
}

export class CreateCompatibilityRuleUseCase {
  constructor(private readonly repo: ICompatibilityRuleRepository) {}
  async execute(input: Record<string, unknown>, createdBy: string): Promise<CompatibilityRuleResult> {
    const validation = validateCompatibilityRule(parseDates(input));
    if (!validation.ok) return validation;
    return { ok: true, rule: await this.repo.create(validation.value, createdBy) };
  }
}

export class UpdateCompatibilityRuleUseCase {
  constructor(private readonly repo: ICompatibilityRuleRepository) {}
  async execute(id: string, input: Record<string, unknown>): Promise<CompatibilityRuleResult> {
    const existing = await this.repo.findById(id);
    if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Rule not found.' };
    const validation = validateCompatibilityRule(parseDates({ ...existing, ...input }));
    if (!validation.ok) return validation;
    const rule = await this.repo.update(id, validation.value);
    if (!rule) return { ok: false, code: 'NOT_FOUND', message: 'Rule not found.' };
    return { ok: true, rule };
  }
}

export class ListCompatibilityRulesUseCase {
  constructor(private readonly repo: ICompatibilityRuleRepository) {}
  execute(): Promise<AdminCompatibilityRule[]> {
    return this.repo.list();
  }
}

export class DeleteCompatibilityRuleUseCase {
  constructor(private readonly repo: ICompatibilityRuleRepository) {}
  async execute(id: string): Promise<{ ok: boolean }> {
    return { ok: await this.repo.delete(id) };
  }
}

import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

/**
 * The programme-config fields an admin may change, and what each one is.
 *
 * PATCH semantics: only the keys PRESENT in the body change. The route used to
 * map every missing key to null (and a missing boolean to false), so the
 * documented kill step — `{"chanceEnabled": false}` — also deleted the point
 * value, the budget cap and every bonus earn source, and released the kill
 * switch. An explicit null still clears a nullable field.
 */
const NULLABLE_INTEGER_FIELDS = [
  'pointValueUgx',
  'redemptionMinPoints',
  'redemptionMaxShareBps',
  'budgetCapPoints',
  'guestBackfillLookbackDays',
  'guestBackfillCapPoints',
  'referralReferrerPoints',
  'referralRefereePoints',
  'birthdayPoints',
  'streakTargetOrders',
  'streakWindowDays',
  'streakRewardPoints',
] as const;
const BOOLEAN_FIELDS = ['killSwitch', 'chanceEnabled'] as const;

type IntegerField = (typeof NULLABLE_INTEGER_FIELDS)[number];
type BooleanField = (typeof BOOLEAN_FIELDS)[number];
export type LoyaltyProgrammeConfigPatch = Partial<Record<IntegerField, number | null> & Record<BooleanField, boolean>>;

export type ParsedPatch = { ok: true; patch: LoyaltyProgrammeConfigPatch } | { ok: false; code: string; message: string };

export function parseProgrammeConfigPatch(body: unknown): ParsedPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'BAD_JSON', message: 'Body must be a JSON object.' };
  const raw = body as Record<string, unknown>;
  const patch: LoyaltyProgrammeConfigPatch = {};
  for (const key of NULLABLE_INTEGER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const v = raw[key];
    if (v === null || v === '') {
      patch[key] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || (key === 'redemptionMaxShareBps' && n > 10_000)) {
      return { ok: false, code: 'INVALID_VALUE', message: `"${key}" is out of range.` };
    }
    patch[key] = n;
  }
  for (const key of BOOLEAN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    if (typeof raw[key] !== 'boolean') return { ok: false, code: 'INVALID_VALUE', message: `"${key}" must be true or false.` };
    patch[key] = raw[key] as boolean;
  }
  if (Object.keys(patch).length === 0) return { ok: false, code: 'NOTHING_TO_SAVE', message: 'Name at least one setting to change.' };
  return { ok: true, patch };
}

export interface LoyaltyProgrammeConfigWriterPort {
  save(patch: LoyaltyProgrammeConfigPatch): Promise<void>;
}

export class SaveLoyaltyProgrammeConfigUseCase {
  constructor(
    private readonly writer: LoyaltyProgrammeConfigWriterPort,
    private readonly readConfig: () => Promise<unknown>,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(body: unknown, actorId: string): Promise<{ ok: true; config: unknown } | { ok: false; code: string; message: string }> {
    const parsed = parseProgrammeConfigPatch(body);
    if (!parsed.ok) return parsed;
    const before = await this.readConfig().catch(() => null);
    await this.writer.save(parsed.patch);
    const config = await this.readConfig();
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId,
      action: 'LOYALTY_PROGRAMME_CONFIG_SAVED',
      entity: 'loyalty_config',
      entityId: 'config',
      previousState: before,
      newState: { changed: parsed.patch, config },
    });
    return { ok: true, config };
  }
}

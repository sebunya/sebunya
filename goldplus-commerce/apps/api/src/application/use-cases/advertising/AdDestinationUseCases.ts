import type { AdDestinationRepository, AdDestinationRow, SecretCipher } from '../../ports/Advertising';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export interface AdPlatformInfo {
  key: string; name: string; secretLabel: string; unavailable?: string;
  fields: Array<{ key: string; label: string; pattern: RegExp; hint: string }>;
  events: Record<string, string>;
}
type R<T> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'BAD_INPUT' | 'NOT_CONFIGURED'; message: string };

/**
 * Admin operations on advertising destinations. A platform is LIVE only when
 * it is implemented, every id is valid, a token is stored and a person switched
 * it on. Tokens are write-only: stored encrypted, shown as a mask, never returned.
 */
export class AdDestinationUseCases {
  constructor(
    private readonly repo: AdDestinationRepository,
    private readonly platforms: AdPlatformInfo[],
    private readonly cipher: SecretCipher | null,
    private readonly audit: CreateAuditLogUseCase,
  ) {}

  async list(): Promise<Array<AdPlatformInfo & { state: 'LIVE' | 'READY_OFF' | 'NOT_CONFIGURED' | 'NOT_AVAILABLE'; row: AdDestinationRow | null }>> {
    const rows = new Map((await this.repo.list()).map((r) => [r.platform, r]));
    return this.platforms.map((p) => {
      const row = rows.get(p.key) ?? null;
      const complete = !p.unavailable && !!row?.hasSecret && p.fields.every((f) => f.pattern.test(row?.config?.[f.key] ?? ''));
      const state = p.unavailable ? 'NOT_AVAILABLE' : !complete ? 'NOT_CONFIGURED' : row?.enabled ? 'LIVE' : 'READY_OFF';
      return { ...p, state, row };
    });
  }

  /** Names of platforms actually receiving data (for the privacy page). */
  async recipients(): Promise<string[]> {
    return (await this.list()).filter((p) => p.state === 'LIVE').map((p) => p.name);
  }

  async configure(actorId: string | null, key: string, input: { config?: Record<string, unknown>; secret?: string; enabled?: boolean; removeSecret?: boolean }): Promise<R<AdDestinationRow>> {
    const p = this.platforms.find((x) => x.key === key);
    if (!p) return { ok: false, code: 'NOT_FOUND', message: 'Unknown advertising platform.' };
    if (p.unavailable) return { ok: false, code: 'NOT_CONFIGURED', message: `Not configured: ${p.unavailable}` };
    const current = await this.repo.get(key);
    const config: Record<string, string> = { ...(current?.config ?? {}) };
    for (const f of p.fields) {
      const v = input.config?.[f.key];
      if (v === undefined) continue;
      const s = String(v).trim();
      if (!f.pattern.test(s)) return { ok: false, code: 'BAD_INPUT', message: `${f.label} does not look right (${f.hint}).` };
      config[f.key] = s;
    }
    let secretEnc: string | null | undefined;
    let secretMask: string | null | undefined;
    if (typeof input.secret === 'string' && input.secret.trim()) {
      if (!this.cipher) return { ok: false, code: 'NOT_CONFIGURED', message: 'Not configured: the credential vault key is not set on the server.' };
      const s = input.secret.trim();
      if (s.length < 20 || s.length > 4000) return { ok: false, code: 'BAD_INPUT', message: `${p.secretLabel} does not look right.` };
      secretEnc = this.cipher.encrypt(s);
      secretMask = this.cipher.mask(s);
    }
    if (input.removeSecret) {
      // A leaked or retired token: gone, and the platform switched off with it.
      const row = await this.repo.save(key, { enabled: false, config, secretEnc: null, secretMask: null, updatedBy: actorId });
      await this.audit.execute({ actorId, action: 'AD_DESTINATION_TOKEN_REMOVED', entity: 'ad_destination', entityId: key, newState: { enabled: false } } as never);
      return { ok: true, value: row };
    }
    const willBeComplete = p.fields.every((f) => f.pattern.test(config[f.key] ?? '')) && (!!secretEnc || !!current?.hasSecret);
    if (input.enabled === true && !willBeComplete) return { ok: false, code: 'BAD_INPUT', message: `Enter the ${p.fields.map((f) => f.label).join(', ')} and the ${p.secretLabel} before switching ${p.name} on.` };
    const row = await this.repo.save(key, { enabled: input.enabled, config, secretEnc, secretMask, updatedBy: actorId });
    await this.audit.execute({ actorId, action: 'AD_DESTINATION_CONFIGURED', entity: 'ad_destination', entityId: key,
      newState: { enabled: row.enabled, config, secretChanged: secretEnc !== undefined } } as never);
    return { ok: true, value: row };
  }
}

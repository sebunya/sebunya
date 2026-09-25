import type { AdDestinationRepository, AdDestinationRow, SecretCipher } from '../../ports/Advertising';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { cleanSelection } from '../../../domain/advertising/OptimisationEvents';

export interface AdPlatformInfo {
  key: string; name: string; secretLabel: string; secretHint?: string; unavailable?: string;
  fields: Array<{ key: string; label: string; pattern: RegExp; hint: string; optional?: boolean }>;
  events: Record<string, string>;
  /** Documents a test channel (0154 Test mode). */
  testable?: boolean;
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

  async list(): Promise<Array<AdPlatformInfo & { state: 'LIVE' | 'TEST' | 'READY_OFF' | 'NOT_CONFIGURED' | 'NOT_AVAILABLE'; row: AdDestinationRow | null }>> {
    const rows = new Map((await this.repo.list()).map((r) => [r.platform, r]));
    return this.platforms.map((p) => {
      const row = rows.get(p.key) ?? null;
      const complete = !p.unavailable && (!p.secretLabel || !!row?.hasSecret) && p.fields.every((f) => (f.optional && !row?.config?.[f.key]) || f.pattern.test(row?.config?.[f.key] ?? ''));
      const state = p.unavailable ? 'NOT_AVAILABLE' : !complete ? 'NOT_CONFIGURED' : row?.enabled ? (row.mode === 'test' ? 'TEST' : 'LIVE') : 'READY_OFF';
      return { ...p, state, row } as AdPlatformInfo & { state: 'LIVE' | 'TEST' | 'READY_OFF' | 'NOT_CONFIGURED' | 'NOT_AVAILABLE'; row: AdDestinationRow | null };
    });
  }

  /** Names of platforms actually receiving data (for the privacy page). */
  async recipients(): Promise<string[]> {
    // Test mode sends real shoppers' (hashed) data too: a recipient all the same.
    return (await this.list()).filter((p) => p.state === 'LIVE' || p.state === 'TEST').map((p) => p.name);
  }

  async configure(actorId: string | null, key: string, input: { config?: Record<string, unknown>; secret?: string; enabled?: boolean; removeSecret?: boolean; mode?: 'live' | 'test'; eventSelection?: unknown }): Promise<R<AdDestinationRow>> {
    const p = this.platforms.find((x) => x.key === key);
    if (!p) return { ok: false, code: 'NOT_FOUND', message: 'Unknown advertising platform.' };
    if (p.unavailable) return { ok: false, code: 'NOT_CONFIGURED', message: `Not configured: ${p.unavailable}` };
    const current = await this.repo.get(key);
    const config: Record<string, string> = { ...(current?.config ?? {}) };
    for (const f of p.fields) {
      const v = input.config?.[f.key];
      if (v === undefined) continue;
      const s = String(v).trim();
      if (f.optional && s === '') { delete config[f.key]; continue; }
      if (!f.pattern.test(s)) return { ok: false, code: 'BAD_INPUT', message: `${f.label} does not look right (${f.hint}).` };
      config[f.key] = s;
    }
    let secretEnc: string | null | undefined;
    let secretMask: string | null | undefined;
    if (typeof input.secret === 'string' && input.secret.trim() && p.secretLabel) {
      if (!this.cipher) return { ok: false, code: 'NOT_CONFIGURED', message: 'Not configured: the credential vault key is not set on the server.' };
      const s = input.secret.trim();
      if (s.length < 20 || s.length > 4000) return { ok: false, code: 'BAD_INPUT', message: `${p.secretLabel} does not look right.` };
      if (p.secretHint?.startsWith('{')) {
        // A JSON bundle: check its shape now, not at the first failed send.
        let o: Record<string, unknown> | null = null;
        try { o = JSON.parse(s); } catch { /* reported below */ }
        const want = [...p.secretHint.matchAll(/"(\w+)"\s*:/g)].map((m) => m[1]);
        const missing = !o ? want : want.filter((k) => typeof o![k] !== 'string' || !(o![k] as string).trim());
        if (missing.length) return { ok: false, code: 'BAD_INPUT', message: `${p.secretLabel}: paste JSON with ${want.join(', ')} (missing: ${missing.join(', ')}).` };
      }
      secretEnc = this.cipher.encrypt(s);
      secretMask = this.cipher.mask(s);
    }
    if (input.removeSecret) {
      // A leaked or retired token: gone, and the platform switched off with it.
      const row = await this.repo.save(key, { enabled: false, config, secretEnc: null, secretMask: null, updatedBy: actorId });
      await this.audit.execute({ actorId, action: 'AD_DESTINATION_TOKEN_REMOVED', entity: 'ad_destination', entityId: key, newState: { enabled: false } } as never);
      return { ok: true, value: row };
    }
    const willBeComplete = p.fields.every((f) => (f.optional && !config[f.key]) || f.pattern.test(config[f.key] ?? '')) && (!p.secretLabel || !!secretEnc || !!current?.hasSecret);
    // 0154: Test mode only where the platform documents a test channel, and
    // with the code it needs; otherwise a "test" would count as a real sale.
    if (input.mode !== undefined && input.mode !== 'live' && input.mode !== 'test') return { ok: false, code: 'BAD_INPUT', message: 'Mode is live or test.' };
    if (input.mode === 'test' && !p.testable) return { ok: false, code: 'BAD_INPUT', message: `${p.name} has no documented test channel here; it can only be live or off.` };
    if (input.mode === 'test' && p.fields.some((f) => f.key === 'testEventCode') && !config.testEventCode) return { ok: false, code: 'BAD_INPUT', message: 'Enter the test event code from the platform\'s Test events screen before switching to Test mode.' };
    const eventSelection = input.eventSelection === undefined ? undefined : input.eventSelection === null ? null : cleanSelection(input.eventSelection, Object.keys(p.events));
    if (input.enabled === true && !willBeComplete) return { ok: false, code: 'BAD_INPUT', message: `Enter the ${p.fields.filter((f) => !f.optional).map((f) => f.label).join(', ')}${p.secretLabel ? ` and the ${p.secretLabel}` : ''} before switching ${p.name} on.` };
    const row = await this.repo.save(key, { enabled: input.enabled, config, secretEnc, secretMask, updatedBy: actorId, mode: input.mode, eventSelection });
    await this.audit.execute({ actorId, action: 'AD_DESTINATION_CONFIGURED', entity: 'ad_destination', entityId: key,
      newState: { enabled: row.enabled, config, secretChanged: secretEnc !== undefined, mode: row.mode, eventSelection: row.eventSelection } } as never);
    return { ok: true, value: row };
  }
}

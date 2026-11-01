import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workItemMarker } from '../../apps/api/src/infrastructure/seo/OrganicIntelligenceRunner';
import { isPrivateAddress } from '../../apps/api/src/infrastructure/seo/adapters/CustomReadOnlyRestAdapter';
import { IntegrationCredentialVault } from '../../apps/api/src/infrastructure/seo/IntegrationCredentialVault';
import { adminTransitionKey } from '../../apps/api/src/interfaces/http/routes/governance';
import { ShortAnswerCache } from '../../apps/api/src/interfaces/http/shortAnswerCache';
import { isMaintenanceExempt } from '../../apps/api/src/interfaces/http/middleware/maintenance';
import { isValidUuid } from '../../apps/api/src/application/recommendations/RecommendationValidation';
import { ResolveFakeReportUseCase } from '../../apps/api/src/application/use-cases/governance/ResolveFakeReportUseCase';

const src = (f: string) => readFileSync(join(__dirname, '../../apps/api/src', f), 'utf8');

describe('2026-11 review 237', () => {
  it('a work item is found by its whole opportunity marker, never a prefix', () => {
    const power = workItemMarker('opp:x:category:power');
    expect('detail\n\n[opportunity:opp:x:category:power-devices]'.includes(power)).toBe(false);
    expect(`detail\n\n${power}`.includes(power)).toBe(true);
    const s = src('infrastructure/seo/OrganicIntelligenceRunner.ts');
    expect(s).toContain('strpos(detail, ${workItemMarker(opportunityKey)}) > 0');
    expect(s).not.toMatch(/detail like \$\{`%\$\{opportunityKey\}%`\}/);
  });

  it('the SSRF guard covers the remaining reserved ranges and IPv4 inside IPv6', () => {
    for (const a of ['198.18.0.1', '198.19.255.1', '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255', '192.0.2.5', '198.51.100.7', '203.0.113.9',
      '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b::169.254.169.254', '::ffff:127.0.0.1', 'ff02::1', '2001:db8::1', 'fec0::1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808', '64:ff9b::808:808']) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
  });

  it('an empty vault key falls back to JWT_SECRET, and JWT_SECRET_PREVIOUS still decrypts', () => {
    const v = IntegrationCredentialVault.fromEnv({ SEO_CREDENTIAL_VAULT_KEY: '  ', JWT_SECRET: 'a'.repeat(40) });
    expect(v).not.toBeNull();
    const old = IntegrationCredentialVault.fromEnv({ JWT_SECRET: 'old-'.repeat(10) })!;
    const ct = old.encrypt({ apiKey: 'k' });
    const rotated = IntegrationCredentialVault.fromEnv({ JWT_SECRET: 'new-'.repeat(10), JWT_SECRET_PREVIOUS: 'old-'.repeat(10) })!;
    expect(rotated.decrypt<{ apiKey: string }>(ct).apiKey).toBe('k');
    const noPrevious = IntegrationCredentialVault.fromEnv({ JWT_SECRET: 'new-'.repeat(10) })!;
    expect(() => noPrevious.decrypt(ct)).toThrow();
    // A dedicated vault key does not take JWT_SECRET_PREVIOUS.
    const dedicated = IntegrationCredentialVault.fromEnv({ SEO_CREDENTIAL_VAULT_KEY: 'v'.repeat(40), JWT_SECRET_PREVIOUS: 'old-'.repeat(10) })!;
    expect(() => dedicated.decrypt(ct)).toThrow();
  });

  it('the admin transition key names the move and a nonce, within varchar(120)', () => {
    const id = '00000000-0000-0000-0000-000000000001';
    const a = adminTransitionKey(id, 'delivery_failed', 'dispatched');
    const b = adminTransitionKey(id, 'delivery_failed', 'dispatched');
    expect(a).not.toBe(b);
    expect(adminTransitionKey(id, 'received', 'processing', 'k1')).toBe(adminTransitionKey(id, 'received', 'processing', 'k1'));
    expect(adminTransitionKey(id, 'pending_owner_review', 'pending_owner_review', 'x'.repeat(500)).length).toBeLessThanOrEqual(120);
    expect(a).toContain('delivery_failed->dispatched');
  });

  it("the guardian's 500-row cut ranks by the busier week, so a drop to zero is kept", () => {
    const s = src('infrastructure/seo/SearchConsoleGuardianRunner.ts');
    expect(s).not.toContain('order by 2 desc nulls last');
    expect(s).toMatch(/order by greatest\(/);
  });

  it('return-state answers are shared for a short while', async () => {
    let t = 0;
    const cache = new ShortAnswerCache<string>(10_000, 2, () => t);
    const compute = vi.fn(async () => 'answer');
    await Promise.all([cache.get('k', compute), cache.get('k', compute)]);
    t = 9_999;
    await cache.get('k', compute);
    expect(compute).toHaveBeenCalledTimes(1);
    t = 10_000;
    await cache.get('k', compute);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(src('interfaces/http/routes/commerce.ts')).toContain('returnStateAnswers.get(');
  });

  it('a failed answer is not cached', async () => {
    const cache = new ShortAnswerCache<string>(10_000, 5);
    await expect(cache.get('k', async () => { throw new Error('x'); })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get('k', async () => 'ok')).toBe('ok');
  });

  it('MFA enrolment works during a freeze', () => {
    expect(isMaintenanceExempt('/auth/mfa/enrol')).toBe(true);
    expect(isMaintenanceExempt('/auth/mfa/confirm')).toBe(true);
    expect(isMaintenanceExempt('/auth/register')).toBe(false);
  });

  it('a GA4 property id must be numeric before it goes into the URL', () => {
    const s = src('infrastructure/seo/adapters/SeoIntegrationAdapters.ts');
    expect(s).toContain('if (!/^\\d{1,20}$/.test(propertyId))');
    expect(s).toContain('properties/${encodeURIComponent(propertyId)}:runReport');
  });

  it('cap list: an empty storage directory gives /name, not //name', () => {
    const s = src('infrastructure/storage/LocalProductImageStorage.ts');
    expect(s).toContain('const storageKey = safeDir ? `${safeDir}/${safeName}` : safeName;');
  });

  it('cap list: recommendation ids accept any uuid shape', () => {
    expect(isValidUuid('00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(isValidUuid('0190f5a8-7b2c-7def-8abc-0123456789ab')).toBe(true);
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });

  it('cap list: resolving a fake report goes through a use case', async () => {
    const setStatus = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    const audit = { execute: vi.fn(async () => undefined) };
    const uc = new ResolveFakeReportUseCase({
      reports: { findByIdRaw: async () => ({ id: 'r', reporterUserId: 'u', loyaltyEntryId: null }), setStatus },
      earn: { execute: async () => ({ ok: true, points: 50, entryId: 'e1' }) },
      notify: { enqueue },
      audit,
    });
    expect((await uc.execute({ reportId: 'r', status: 'nope', actorId: 'a' })).ok).toBe(false);
    const r = await uc.execute({ reportId: 'r', status: 'verified_fake', actorId: 'a' });
    expect(r).toEqual({ ok: true, id: 'r', status: 'verified_fake', loyalty: { points: 50 } });
    expect(setStatus).toHaveBeenCalledWith('r', 'verified_fake', 'e1');
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'counterfeit-confirmed:r' }));
    expect(audit.execute).toHaveBeenCalledWith(expect.objectContaining({ action: 'FAKE_REPORT_STATUS_CHANGED' }));
    expect(src('interfaces/http/routes/governance.ts')).not.toContain('registry.fakeReportRepo.setStatus');
  });
});

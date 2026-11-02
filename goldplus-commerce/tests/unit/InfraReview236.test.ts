import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path, { join } from 'node:path';
import { DeploymentService, nextFreezeState, shadowSafeHeaders, type DeploymentFlagStore } from '../../apps/api/src/infrastructure/deployment/DeploymentService';
import { sendMayHaveReachedProvider } from '../../apps/api/src/infrastructure/http/HttpClient';
import { metadataField } from '../../apps/api/src/infrastructure/db/repositories/DrizzleSupportRepository';
import { PREVIOUS_VALUE_MAX } from '../../apps/api/src/infrastructure/first-party/DrizzlePhoneHygieneRepository';
import { SharpVariantGenerator, rawIsEightBit } from '../../apps/api/src/infrastructure/media/SharpVariantGenerator';

const src = (f: string) => readFileSync(join(__dirname, '../../apps/api/src', f), 'utf8');

function memoryStore(initial: { maintenance: string | null; shadow: string | null }) {
  const state = { ...initial };
  let failWrites = false;
  const store: DeploymentFlagStore & { state: typeof state; failWrites(v: boolean): void } = {
    state,
    failWrites: (v) => { failWrites = v; },
    read: async () => ({ ...state }),
    write: async (key, value) => {
      if (failWrites) throw new Error('redis down');
      state[key] = value;
    },
  };
  return store;
}

describe('2026-11 review 236: deployment flags', () => {
  it('a missing shared key or a stale read keeps the local freeze', () => {
    expect(nextFreezeState({ current: true, shared: null, staleRead: false })).toBe(true);
    expect(nextFreezeState({ current: true, shared: '0', staleRead: true })).toBe(true);
    expect(nextFreezeState({ current: true, shared: '0', staleRead: false })).toBe(false);
    expect(nextFreezeState({ current: false, shared: '1', staleRead: false })).toBe(true);
  });

  it('a freeze Redis did not accept is pushed on the next refresh instead of being lifted', async () => {
    const svc = DeploymentService.getInstance();
    const store = memoryStore({ maintenance: '0', shadow: null });
    svc.useFlagStore(store);
    store.failWrites(true);
    expect(await svc.setMaintenanceMode(true)).toBe(false);
    store.failWrites(false);
    expect(await svc.refreshFlags({ force: true })).toBe(true);
    expect(store.state.maintenance).toBe('1');
    await svc.setMaintenanceMode(false);
    svc.useFlagStore(null);
  });

  it('the maintenance middleware refreshes the shared flag and the admin route awaits the write', () => {
    expect(src('interfaces/http/middleware/maintenance.ts')).toContain('await deploymentService.refreshFlags()');
    expect(src('interfaces/http/routes/admin/deployment.ts')).toContain('await deploymentService.setMaintenanceMode(enabled)');
  });

  it('shadow headers drop Host and the client address, and the body is not cloned', () => {
    const out = shadowSafeHeaders({ host: 'goldplus.ug', 'x-forwarded-for': '41.1.1.1', 'x-real-ip': '41.1.1.1', 'cf-connecting-ip': '41.1.1.1', forwarded: 'for=41.1.1.1', accept: 'text/html' });
    expect(out).toEqual({ accept: 'text/html' });
    expect(src('interfaces/http/app.ts')).not.toMatch(/c\.req\.raw\.clone\(\)\.text\(\)/);
  });
});

describe('2026-11 review 236: infrastructure', () => {
  it('a 502/504 means the provider may have sent; other statuses mean not sent', () => {
    expect(sendMayHaveReachedProvider(new Error('HTTP error status 504'))).toBe(true);
    expect(sendMayHaveReachedProvider(new Error('HTTP error status 502: Bad Gateway'))).toBe(true);
    expect(sendMayHaveReachedProvider(new Error('HTTP error status 500'))).toBe(false);
    expect(sendMayHaveReachedProvider(new Error('HTTP error status 503'))).toBe(false);
  });

  it('SEO credential rotation is serialised per connection', () => {
    const s = src('infrastructure/db/repositories/DrizzleSeoIntegrationRepository.ts');
    const fn = s.slice(s.indexOf('async addCredential'), s.indexOf('async getActiveCredential'));
    expect(fn.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(-1);
    expect(fn.indexOf('pg_advisory_xact_lock')).toBeLessThan(fn.indexOf("set status = 'ROTATED'"));
  });

  it('support tickets match a guest email only once the customer proved it, and read jsonb strings', () => {
    const s = src('infrastructure/db/repositories/DrizzleSupportRepository.ts');
    expect(s).toContain('ui.email_verified');
    const raw = JSON.stringify(metadataField('email'));
    expect(raw).toContain("jsonb_typeof(metadata) = 'string'");
  });

  it('phone hygiene skips a unique collision and never truncates what a revert puts back', () => {
    const s = src('infrastructure/first-party/DrizzlePhoneHygieneRepository.ts');
    expect(PREVIOUS_VALUE_MAX).toBe(50);
    expect(s).toContain('if (n.from.length > PREVIOUS_VALUE_MAX) return false;');
    expect(s).not.toContain('n.from.slice(0, 50)');
    expect(s).toContain('if (isUniqueViolation(err)) return false;');
  });

  it('one failing hero signal keeps the others, stock included', async () => {
    const { HeroSignalsService } = await import('../../apps/api/src/infrastructure/hero/HeroSignalsService');
    const svc = new HeroSignalsService() as any;
    svc.categoryAffinity = async () => [];
    svc.hasOrdered = async () => true;
    svc.loyaltyFor = async () => { throw new Error('missing table'); };
    svc.stockFor = async () => ({ 'gp-1': 3 });
    svc.visitStrength = async () => 4;
    svc.customerIdentity = async () => null;
    const out = await svc.getSignals('00000000-0000-0000-0000-000000000001', ['gp-1']);
    expect(out.stockBySlug).toEqual({ 'gp-1': 3 });
    expect(out.hasOrdered).toBe(true);
    expect(out.loyalty).toBeNull();
    expect(out.visits).toBe(4);
  });

  it('a CMYK JPEG keeps its colour (the raw base is sRGB before the re-wrap)', async () => {
    const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');
    const cmyk = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#93D500' } }).toColourspace('cmyk').jpeg().toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');
    const saved: Array<{ key: string; buffer: Buffer }> = [];
    await new SharpVariantGenerator().generate({
      buffer: cmyk, mime: 'image/jpeg', checksum: 'cmyk',
      saveVariant: async (key: string, buffer: Buffer) => { saved.push({ key, buffer }); return { url: `/${key}`, storageKey: key }; },
    });
    const webp = saved.find((s) => s.key.includes('webp'))!;
    const { data } = await sharp(webp.buffer).raw().toBuffer({ resolveWithObject: true });
    const ref = await sharp(cmyk).toColourspace('srgb').raw().toBuffer();
    for (let i = 0; i < 3; i++) expect(Math.abs(data[i] - ref[i])).toBeLessThan(8);
  }, 30_000);

  it('a 16-bit PNG still yields 8-bit renditions', async () => {
    expect(rawIsEightBit({ width: 2, height: 2, channels: 3 }, 12)).toBe(true);
    expect(rawIsEightBit({ width: 2, height: 2, channels: 3 }, 24)).toBe(false);
    const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');
    const png16 = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#93D500' } }).toColourspace('rgb16').png().toBuffer();
    expect((await sharp(png16).metadata()).depth).toBe('ushort');
    const saved: Array<{ key: string; buffer: Buffer }> = [];
    const out = await new SharpVariantGenerator().generate({
      buffer: png16, mime: 'image/png', checksum: 'c16',
      saveVariant: async (key: string, buffer: Buffer) => { saved.push({ key, buffer }); return { url: `/${key}`, storageKey: key }; },
    });
    expect(out.variants.length).toBeGreaterThan(0);
    const thumb = saved.find((s) => s.key.includes('webp'))!;
    const { data, info } = await sharp(thumb.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBeGreaterThanOrEqual(3);
    // The colour survives (garbled 16-bit-as-8-bit data would not be #93D500-ish).
    expect(Math.abs(data[0] - 0x93)).toBeLessThan(12);
    expect(Math.abs(data[1] - 0xd5)).toBeLessThan(12);
  }, 30_000);
});

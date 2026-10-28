import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * The fit index (GET /batteries/finder/fit-index) on REAL PostgreSQL: the
 * phones that get an indexable /phone-batteries/<slug> page and a sitemap
 * entry. Proves the SQL, not a fake: a phone appears only with a live claim
 * on a sellable battery; a supplier-listed fit counts only while the finder
 * shows awaiting fits; a rejected (archived) claim, a draft claim, an
 * unapproved product and an archived phone never make a page.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('battery finder fit index (real PostgreSQL)', () => {
  let raw: any; let repo: any; let fx: Fixtures;
  const tag = `itfit${Date.now().toString(36)}`;
  let brandId = '';
  let actor = '';
  const deviceIds: string[] = [];
  const slugs = { listed: `${tag}-listed`, verified: `${tag}-verified`, rejected: `${tag}-rejected`, draft: `${tag}-draft`, unapproved: `${tag}-unapproved`, archived: `${tag}-archived`, none: `${tag}-none` };

  async function device(slug: string, status = 'ACTIVE'): Promise<string> {
    const [d] = await raw`insert into devices (brand, model, brand_normalised, model_normalised, slug, brand_id, status)
      values (${'Itfit'}, ${slug}, ${'itfit'}, ${slug}, ${slug}, ${brandId}, ${status}) returning id`;
    deviceIds.push(d.id);
    return d.id;
  }
  // A live (ACTIVE) claim must name who published it and when (0125 product_device_compat_active_chk).
  async function claim(productId: string, deviceId: string, evidence: string, workflow: string): Promise<void> {
    const live = workflow === 'ACTIVE';
    await raw`insert into product_device_compatibility (product_id, device_id, fit_type, confidence, evidence_status, workflow_status, published_by, published_at)
      values (${productId}, ${deviceId}, 'exact', 'declared', ${evidence}, ${workflow}, ${live ? actor : null}, ${live ? new Date() : null})`;
  }

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    repo = Registry.getInstance().batteryFinderRepo;
    fx = new Fixtures(raw);
    actor = await fx.user();
    const [b] = await raw`insert into device_brands (name, name_normalised, slug) values (${`Itfit ${tag}`}, ${`itfit ${tag}`}, ${tag}) returning id`;
    brandId = b.id;

    const listedBattery = await fx.battery();                 // record still in review: supplier-listed fits only
    const verifiedBattery = await fx.battery();
    // An ACTIVE record must name who published it (0125 battery_profiles_active_published_chk).
    await raw`update battery_profiles set lifecycle_status = 'ACTIVE', published_by = ${actor}, published_at = now() where product_id = ${verifiedBattery.productId}`;
    const unapprovedBattery = await fx.battery();
    await raw`update products set approval_status = 'draft' where id = ${unapprovedBattery.productId}`;

    await claim(listedBattery.productId, await device(slugs.listed), 'SUPPLIER_LISTED', 'ACTIVE');
    await claim(verifiedBattery.productId, await device(slugs.verified), 'PACKAGE_VERIFIED', 'ACTIVE');
    await claim(verifiedBattery.productId, await device(slugs.rejected), 'REJECTED', 'ARCHIVED'); // a rejected claim can never be ACTIVE
    await claim(verifiedBattery.productId, await device(slugs.draft), 'PACKAGE_VERIFIED', 'DRAFT');
    await claim(unapprovedBattery.productId, await device(slugs.unapproved), 'SUPPLIER_LISTED', 'ACTIVE');
    await claim(verifiedBattery.productId, await device(slugs.archived, 'ARCHIVED'), 'PACKAGE_VERIFIED', 'ACTIVE');
    await device(slugs.none);
  }, 60_000);

  afterAll(async () => {
    if (deviceIds.length) {
      await raw`delete from product_device_compatibility where device_id = any(${deviceIds}::uuid[])`;
      await raw`delete from devices where id = any(${deviceIds}::uuid[])`;
    }
    if (brandId) await raw`delete from device_brands where id = ${brandId}`;
    await fx?.cleanup();
    await raw?.end();
  });

  const ours = (rows: Array<{ slug: string }>) => rows.filter((r) => r.slug.startsWith(tag)).map((r) => r.slug).sort();

  it('with awaiting fits shown: the verified phone and the supplier-listed phone, nothing else', async () => {
    const rows = await repo.devicesWithPublicFits(true);
    expect(ours(rows)).toEqual([slugs.listed, slugs.verified].sort());
    const listed = rows.find((r: any) => r.slug === slugs.listed);
    const verified = rows.find((r: any) => r.slug === slugs.verified);
    expect([listed.verifiedFits, listed.listedFits]).toEqual([0, 1]);
    expect([verified.verifiedFits, verified.listedFits]).toEqual([1, 0]);
    expect(listed.brandSlug).toBe(tag);
    expect(listed.brandDisplayName).toBe(`Itfit ${tag}`);
  }, 30_000);

  it('with awaiting fits hidden: only the verified phone, and listed counts read 0', async () => {
    const rows = await repo.devicesWithPublicFits(false);
    expect(ours(rows)).toEqual([slugs.verified]);
    expect(rows.find((r: any) => r.slug === slugs.verified).listedFits).toBe(0);
  }, 30_000);
});

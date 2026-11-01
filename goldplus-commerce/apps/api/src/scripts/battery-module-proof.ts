import '../config/env';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, endDbConnection } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';
import { STOREFRONT_PRICE_FLOOR_UGX } from '@goldplus/shared';

/**
 * End-to-end proof of the battery module against a REAL database (0125).
 *
 * It drives the operator journey the brief defines and asserts the guarantees
 * that must hold: one code resolves to one battery, an unverified fit is never
 * public, a maker cannot verify their own claim, a battery below the storefront
 * price floor cannot be published, stock never moves without a movement row,
 * and the same file imported twice creates nothing twice.
 *
 * Usage: DATABASE_URL=... tsx battery-module-proof.ts
 * It writes to whatever DATABASE_URL points at, so point it at a scratch clone.
 */

const assert: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new Error(`FAILED: ${message}`);
  console.log(`  ok  ${message}`);
};
const step = (name: string) => console.log(`\n== ${name}`);

const MAKER = '11111111-1111-4111-8111-111111111111';
const CHECKER = '22222222-2222-4222-8222-222222222222';

async function main() {
  const r = Registry.getInstance();
  const suffix = randomUUID().slice(0, 8).toUpperCase();

  step('Setup: catalogue category and the default stock location');
  await db.execute(sql`INSERT INTO categories (name, slug) VALUES ('Power Devices', 'power-devices') ON CONFLICT (slug) DO NOTHING`);
  const seeded = await r.inventoryLedgerUseCases.seedDefaultLocation();
  await r.batteryFinderUseCases.seedConfig();
  const locations = await r.inventoryLedgerUseCases.listLocations();
  assert(locations.some((l) => l.isDefault), `a default stock location exists (inserted now: ${seeded.inserted})`);

  step('1. An operator creates a battery without touching code or SQL');
  const code = `BL-${suffix.slice(0, 2)}FT`;
  const created = await r.batteryCatalogueUseCases.create({
    actorId: MAKER, canonicalCode: code, brand: 'TECNO', batteryCategory: 'PHONE',
    aliases: [{ alias: `GP-${suffix.slice(0, 2)}FT` }, { alias: `${suffix.slice(0, 2)}FT` }],
  });
  assert(created.productId, `created ${code} as a draft product`);

  step('2. One code resolves to one battery, through every form a person types');
  for (const typed of [code, code.replace('-', ''), code.toLowerCase(), `GP-${suffix.slice(0, 2)}FT`, `${suffix.slice(0, 2)}FT`]) {
    const hit = await r.batteryCatalogueUseCases.lookup(typed);
    assert(hit.kind === 'FOUND' && hit.battery?.product.productId === created.productId, `"${typed}" resolves to ${code}`);
  }

  step('3. A code that already belongs to another battery is refused');
  const second = await r.batteryCatalogueUseCases.create({ actorId: MAKER, canonicalCode: `BL-${suffix.slice(2, 4)}XT`, brand: 'Infinix' });
  let aliasRefused = '';
  try {
    await r.batteryCatalogueUseCases.addAlias(second.productId, { alias: code }, MAKER);
  } catch (error) {
    aliasRefused = error instanceof Error ? error.message : '';
  }
  assert(/already resolves to/.test(aliasRefused), `an alias conflict is refused: ${aliasRefused}`);

  step('4. Brand, series and an exact phone are added from the admin surface');
  const brand = await r.deviceCatalogueUseCases.createBrand({ name: `TECNO ${suffix}`, searchAliases: ['Techno'] }, MAKER);
  const series = await r.deviceCatalogueUseCases.createSeries({ brandId: brand.id, name: 'Spark' }, MAKER);
  const phone = await r.deviceCatalogueUseCases.createDevice({ brandId: brand.id, seriesId: series.id, model: `Spark ${suffix.slice(0, 2)}`, modelNumber: `KF6${suffix.slice(0, 1)}` }, MAKER);
  assert(phone.modelNumber && phone.model !== phone.modelNumber, 'the marketing name and the exact model number are separate columns');

  step('5. A compatibility claim: the maker cannot verify their own');
  const claim = await r.batteryCompatibilityUseCases.create({ productId: created.productId, deviceIds: [phone.id], actorId: MAKER, evidenceStatus: 'SUPPLIER_LISTED' });
  assert(claim.created.length === 1, 'one draft claim per phone');
  await r.batteryCompatibilityUseCases.transition(claim.created[0].id, 'SUBMIT', MAKER);
  let makerChecker = '';
  try {
    await r.batteryCompatibilityUseCases.transition(claim.created[0].id, 'VERIFY', MAKER, { evidenceStatus: 'FIT_TESTED', reason: 'x' });
  } catch (error) {
    makerChecker = error instanceof Error ? error.message : '';
  }
  assert(/cannot verify/.test(makerChecker), `maker/checker is enforced: ${makerChecker}`);

  step('6. Verification needs real evidence, then a publisher makes it live');
  let weak = '';
  try {
    await r.batteryCompatibilityUseCases.transition(claim.created[0].id, 'VERIFY', CHECKER, { evidenceStatus: 'SUPPLIER_LISTED' });
  } catch (error) {
    weak = error instanceof Error ? error.message : '';
  }
  assert(/needs evidence/.test(weak), `a supplier listing alone cannot be verified: ${weak}`);
  await r.batteryCompatibilityUseCases.transition(claim.created[0].id, 'VERIFY', CHECKER, { evidenceStatus: 'FIT_TESTED', reason: 'Fitted on the bench' });
  await r.batteryCompatibilityUseCases.transition(claim.created[0].id, 'PUBLISH', CHECKER);
  const live = await r.batteryCompatibilityUseCases.list({ productId: created.productId, workflowStatus: 'ACTIVE' });
  assert(live.length === 1 && live[0].confidence === 'verified', 'the claim is live and the legacy confidence column says verified');

  step('7. The battery still cannot be published: the checklist says exactly why');
  const notReady = await r.batteryCatalogueUseCases.readiness(created.productId);
  const codes: string[] = notReady.blockers.map((b) => b.code);
  assert(!notReady.ready, `not ready, blocked by: ${codes.join(', ')}`);
  for (const expected of ['NO_CANONICAL_CODE', 'NO_PRIMARY_IMAGE', 'NO_PRICE', 'NO_STOCK_LINKAGE', 'BATTERY_UNVERIFIED', 'MISSING_REQUIRED_SPECS']) {
    assert(codes.includes(expected), `the checklist names ${expected}`);
  }

  step('8. Stock only moves through the ledger, and never below zero or below reserved');
  const opening = await r.inventoryLedgerUseCases.recordMovement({ productId: created.productId, movementType: 'OPENING', quantity: 12, reason: 'Opening count', actorId: MAKER, canRecordCost: true });
  assert(opening.after === 12, 'opening stock recorded, balance 12');
  const receipt = await r.inventoryLedgerUseCases.createReceipt({ supplierName: 'Acme', supplierReference: `INV-${suffix}`, locationCode: null, notes: null, createdBy: MAKER, canRecordCost: true, lines: [{ scannedCode: code, productId: null, quantity: 8, unitCostUgx: 30_000, notes: null }] });
  const applied = await r.inventoryLedgerUseCases.applyReceipt(receipt.id, CHECKER, true);
  assert(applied?.status === 'APPLIED', 'the receipt applied');
  const stock = await r.inventoryLedgerUseCases.movementsFor(created.productId, true);
  assert(stock.length === 2 && stock[0].quantityAfter === 20, `every change left a movement; balance is ${stock[0].quantityAfter}`);
  let negative = '';
  try {
    await r.inventoryLedgerUseCases.recordMovement({ productId: created.productId, movementType: 'DAMAGED', quantity: 999, reason: 'test', actorId: MAKER, canRecordCost: false });
  } catch (error) {
    negative = error instanceof Error ? error.message : '';
  }
  assert(/Refused/.test(negative), `stock cannot go negative: ${negative}`);
  const before = (await r.inventoryLedgerUseCases.movementsFor(created.productId, true)).length;
  assert(before === 2, 'the refused movement left no ledger row');

  step('9. The storefront price floor is a publication check');
  await r.batteryCatalogueUseCases.update(created.productId, { priceUgx: STOREFRONT_PRICE_FLOOR_UGX - 1000, capacityMah: 5000, nominalVoltageMv: 3850, codeStatus: 'CONFIRMED' }, MAKER);
  await r.batteryCatalogueUseCases.verify(created.productId, CHECKER, 'Read from the pack');
  await db.execute(sql`UPDATE products SET image_url = 'https://example.test/x.jpg', has_image = true WHERE id = ${created.productId}`);
  const cheap = await r.batteryCatalogueUseCases.readiness(created.productId);
  assert(cheap.blockers.some((b) => b.code === 'PRICE_BELOW_FLOOR'), 'a price below the floor blocks publication');
  await r.batteryCatalogueUseCases.update(created.productId, { priceUgx: 175_000 }, MAKER);
  const ready = await r.batteryCatalogueUseCases.readiness(created.productId);
  assert(ready.ready, `ready to publish (warnings: ${ready.warnings.map((w) => w.code).join(', ') || 'none'})`);

  step('10. Publishing puts it on the site; the public finder answers by phone and by code');
  await r.batteryCatalogueUseCases.transition(created.productId, 'MARK_READY', CHECKER, null);
  await r.batteryCatalogueUseCases.transition(created.productId, 'PUBLISH', CHECKER, null);
  const byDevice = await r.batteryFinderUseCases.device(phone.slug);
  assert(byDevice.results.length === 1 && byDevice.results[0].fitState === 'VERIFIED_IN_STOCK', `the finder answers the phone: ${byDevice.results[0]?.fitLabel}`);
  const byCode = await r.batteryFinderUseCases.search(code);
  assert(byCode.kind === 'BATTERY', `searching the code resolves the battery (${byCode.kind})`);
  const byAlias = await r.batteryFinderUseCases.search(`GP-${suffix.slice(0, 2)}FT`);
  assert(byAlias.kind === 'BATTERY', 'searching the shop label resolves the same battery');
  const byModelNumber = await r.batteryFinderUseCases.search(`KF6${suffix.slice(0, 1)}`);
  assert(byModelNumber.kind === 'DEVICE', 'searching the exact model number resolves the phone');
  const nonsense = await r.batteryFinderUseCases.search('zzqq-not-a-thing');
  assert(nonsense.kind === 'NO_RESULT', 'nonsense returns no result rather than a guess');

  step('11. An unpublished fit is never shown as confirmed');
  const phone2 = await r.deviceCatalogueUseCases.createDevice({ brandId: brand.id, model: `Spark ${suffix.slice(2, 4)}`, modelNumber: `KF7${suffix.slice(0, 1)}` }, MAKER);
  await r.batteryCompatibilityUseCases.create({ productId: created.productId, deviceIds: [phone2.id], actorId: MAKER, evidenceStatus: 'SUPPLIER_LISTED' });
  const unpublished = await r.batteryFinderUseCases.device(phone2.slug);
  assert(unpublished.results.length === 0, 'a draft claim is not public at all');

  step('12. Archiving a fit removes it from the site and keeps the history');
  await r.batteryCompatibilityUseCases.transition(live[0].id, 'ARCHIVE', CHECKER, { reason: 'proof' });
  const afterArchive = await r.batteryFinderUseCases.device(phone.slug);
  assert(afterArchive.results.length === 0, 'the archived fit disappears publicly');
  const stillThere = await r.batteryCompatibilityUseCases.list({ productId: created.productId, workflowStatus: 'ARCHIVED' });
  assert(stillThere.length >= 1, 'the record and its history remain');
  await r.batteryCompatibilityUseCases.transition(live[0].id, 'RESTORE', CHECKER);
  await r.batteryCompatibilityUseCases.transition(live[0].id, 'PUBLISH', CHECKER);

  step('13. One SKU reports the same stock through every route');
  const viaFinder = await r.batteryFinderUseCases.device(phone.slug);
  const viaAdmin = await r.batteryCatalogueUseCases.detail(created.productId, true);
  assert(viaFinder.results[0].inStock === (viaAdmin.inventory.stock > 0), 'the finder and the admin agree on stock');
  assert(viaFinder.results[0].priceUgx === viaAdmin.price.retailUgx, 'the finder and the admin agree on price');

  step('14. A repeated import creates nothing twice');
  const rows = [{ ITEM: `GP-${suffix.slice(4, 6)}CT` }, { ITEM: 'GP-49CI / CT' }, { ITEM: 'GP-NOTE 4 EDGE' }, { ITEM: 'GP- DC3650 WIFI BIG' }];
  const csv = ['NO.,CATEGORY,ITEM', ...rows.map((x, i) => `${i + 1},BATTERIES,"${x.ITEM}"`)].join('\n');
  const upload = { importType: 'BATTERY_CATALOGUE', name: `proof-${suffix}`, filename: 'batteries.csv', mime: 'text/csv', buffer: Buffer.from(csv), sheetName: null, actorId: MAKER };
  const first = await r.batteryImportUseCases.upload(upload);
  const again = await r.batteryImportUseCases.upload(upload);
  assert(!first.existed && again.existed && again.session.id === first.session.id, 'the same file resolves to the same import session');
  await r.batteryImportUseCases.saveMapping({ id: first.session.id, expectedVersion: first.session.version, mapping: { sourceItem: 'ITEM' }, actorId: MAKER });
  const mapped = await r.batteryImportUseCases.detail(first.session.id);
  const preview = await r.batteryImportUseCases.preview({ id: first.session.id, expectedVersion: mapped.session.version, actorId: MAKER });
  const held = preview.rows.filter((row) => row.status === 'HELD');
  assert(held.length === 2, `the compound and the conflicting line are held (${held.map((h) => h.rowKey).join(', ')})`);
  assert(preview.session.validRows === 2, `${preview.session.validRows} rows are ready to apply`);

  step('15. The person who uploaded an import cannot approve it');
  let fourEyes = '';
  try {
    await r.batteryImportUseCases.approve({ id: first.session.id, expectedVersion: preview.session.version, actorId: MAKER, decision: 'APPROVED', reason: 'mine' });
  } catch (error) {
    fourEyes = error instanceof Error ? error.message : '';
  }
  assert(/cannot approve/.test(fourEyes), `four eyes on the import: ${fourEyes}`);
  await r.batteryImportUseCases.approve({ id: first.session.id, expectedVersion: preview.session.version, actorId: CHECKER, decision: 'APPROVED', reason: 'checked the preview' });
  const approved = await r.batteryImportUseCases.detail(first.session.id);
  const appliedImport = await r.batteryImportUseCases.apply({ id: first.session.id, expectedVersion: approved.session.version, actorId: CHECKER, canRecordCost: false });
  assert(appliedImport.appliedRows === 2, `${appliedImport.appliedRows} rows applied, status ${appliedImport.status}`);
  const mifi = (await r.batteryCatalogueUseCases.list({ category: 'MIFI_ROUTER', status: 'ALL' })).filter((b) => b.profile.canonicalCode.includes('DC3650'));
  assert(mifi.length === 1, 'the MiFi line landed under MiFi and router batteries, not phone batteries');
  const importedDraft = await r.batteryCatalogueUseCases.list({ q: `${suffix.slice(4, 6)}CT`, status: 'ALL' });
  assert(importedDraft.length === 1 && importedDraft[0].profile.lifecycleStatus === 'DRAFT', 'an imported battery is a draft, never published by the import');

  step('16. The error report lists exactly what a person must fix');
  const report = await r.batteryImportUseCases.errorReport(first.session.id);
  assert(report.csv.includes('hold_reason') && report.csv.split('\r\n').length >= 3, 'the error report names the held rows');

  step('17. Demand: an unanswered search reaches the admin queue');
  await r.batteryFinderUseCases.search('galaxy note 400 ultra', 'proof-session');
  const request = await r.batteryFinderUseCases.submitRequest({ queryText: 'galaxy note 400 ultra', brandText: 'Samsung', deviceText: 'Note 400 Ultra', modelNumberText: null, batteryCodeText: null, contactName: 'A customer', contactPhone: '0700000000', notes: null, source: 'FINDER_NO_RESULT', sessionId: 'proof-session' });
  const demand = await r.batteryFinderUseCases.demandOverview(30);
  assert(demand.noResultQueries.some((q) => q.query.includes('galaxy note 400 ultra')), 'the unanswered search is in the demand queue');
  const open = await r.batteryFinderUseCases.listRequests('OPEN');
  assert(open.some((q) => q.id === request.id), 'the customer request is in the open queue');
  await r.batteryFinderUseCases.resolveRequest(request.id, { action: 'INVALID', note: 'Not a real Samsung model.' }, CHECKER);
  assert((await r.batteryFinderUseCases.listRequests('OPEN')).every((q) => q.id !== request.id), 'resolving it clears it from the open queue');

  step('18. Merging two phones moves the fits and keeps the history');
  // Both phones carry a claim for the same battery, so the duplicate is
  // archived rather than moved; the preview must say so before anyone commits.
  const impact = await r.deviceCatalogueUseCases.mergePreview(phone2.id, phone.id);
  assert(impact.impact.blocked === null, 'the merge is allowed');
  assert(impact.impact.mappingsToMove === 0 && impact.impact.mappingsAlreadyOnTarget === 1,
    `the preview states the facts: ${impact.impact.mappingsToMove} to move, ${impact.impact.mappingsAlreadyOnTarget} already on the phone we keep`);
  assert(impact.impact.aliasesToCarry.includes(phone2.model), 'the duplicate name is carried over so old searches still land');
  const merged = await r.deviceCatalogueUseCases.merge(phone2.id, phone.id, CHECKER, 'Same phone recorded twice');
  assert(merged.archivedDuplicates === 1 && merged.moved === 0, 'the duplicate claim was archived, not deleted, and nothing was double-counted');
  const keptFits = await r.batteryCompatibilityUseCases.list({ deviceId: phone.id, workflowStatus: 'ALL' });
  assert(keptFits.length >= 1, 'the phone we kept still has its fit');
  const mergedDevice = await r.deviceCatalogueUseCases.findDevice(phone2.id);
  assert(mergedDevice.status === 'MERGED' && mergedDevice.mergedIntoDeviceId === phone.id, 'the duplicate is marked merged, not deleted');

  step('19. The dashboard counts what an operator must act on');
  const dashboard = await r.batteryCatalogueUseCases.dashboard();
  assert(dashboard.total >= 4 && dashboard.active >= 1, `dashboard: ${dashboard.total} batteries, ${dashboard.active} live, ${dashboard.unresolvedImportRows} import rows to resolve`);

  step('20. Nothing supplier-facing leaks into a public answer');
  const publicJson = JSON.stringify(await r.batteryFinderUseCases.battery(viaAdmin.product.slug));
  for (const secret of ['unitCost', 'supplierName', 'supplierReference', 'internalNotes', 'costPrice', 'Acme']) {
    assert(!publicJson.includes(secret), `the public battery answer never contains ${secret}`);
  }

  console.log('\nALL BATTERY MODULE CHECKS PASSED');
  await endDbConnection();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('\n', error instanceof Error ? error.stack : error);
  await endDbConnection().catch(() => {});
  process.exit(1);
});

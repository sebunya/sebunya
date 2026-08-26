import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '../../packages/shared/src/permissions';

const catalogue = vi.hoisted(() => ({
  dashboard: vi.fn(), list: vi.fn(), lookup: vi.fn(), create: vi.fn(), detail: vi.fn(), readiness: vi.fn(), update: vi.fn(), verify: vi.fn(), transition: vi.fn(), bulk: vi.fn(), addAlias: vi.fn(), setAliasActive: vi.fn(), attachEvidence: vi.fn(),
}));
const devices = vi.hoisted(() => ({ listBrands: vi.fn(), createBrand: vi.fn(), updateBrand: vi.fn(), setBrandStatus: vi.fn(), reorderBrands: vi.fn(), listSeries: vi.fn(), createSeries: vi.fn(), updateSeries: vi.fn(), setSeriesStatus: vi.fn(), reorderSeries: vi.fn(), listDevices: vi.fn(), findDevice: vi.fn(), createDevice: vi.fn(), updateDevice: vi.fn(), setDeviceStatus: vi.fn(), mergePreview: vi.fn(), merge: vi.fn() }));
const compatibility = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn(), transition: vi.fn() }));
const ledger = vi.hoisted(() => ({ listLocations: vi.fn(), recordMovement: vi.fn(), movementsFor: vi.fn(), recentMovements: vi.fn(), matchCode: vi.fn(), createReceipt: vi.fn(), listReceipts: vi.fn(), findReceipt: vi.fn(), updateReceiptLines: vi.fn(), applyReceipt: vi.fn(), cancelReceipt: vi.fn(), createCount: vi.fn(), listCounts: vi.fn(), findCount: vi.fn(), applyCount: vi.fn(), cancelCount: vi.fn() }));
const finder = vi.hoisted(() => ({ config: vi.fn(), configWithVersion: vi.fn(), saveConfig: vi.fn(), brands: vi.fn(), brand: vi.fn(), device: vi.fn(), battery: vi.fn(), check: vi.fn(), search: vi.fn(), recordEvent: vi.fn(), submitRequest: vi.fn(), listRequests: vi.fn(), resolveRequest: vi.fn(), demandOverview: vi.fn(), indexable: vi.fn() }));
const imports = vi.hoisted(() => ({ list: vi.fn(), fields: vi.fn(), listTemplates: vi.fn(), listSheetNames: vi.fn(), upload: vi.fn(), detail: vi.fn(), saveMapping: vi.fn(), preview: vi.fn(), resolveRow: vi.fn(), approve: vi.fn(), apply: vi.fn(), rollback: vi.fn(), errorReport: vi.fn() }));

vi.mock('../../apps/api/src/infrastructure/Registry', () => ({
  Registry: { getInstance: () => ({ batteryCatalogueUseCases: catalogue, deviceCatalogueUseCases: devices, batteryCompatibilityUseCases: compatibility, inventoryLedgerUseCases: ledger, batteryFinderUseCases: finder, batteryImportUseCases: imports }) },
}));
vi.mock('../../apps/api/src/interfaces/http/middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth) return c.json({ success: false }, 401);
    const map: Record<string, string[]> = {
      read: [PERMISSIONS.BATTERIES_READ],
      catalogue: [PERMISSIONS.BATTERIES_READ, PERMISSIONS.BATTERIES_CATALOGUE_MANAGE],
      propose: [PERMISSIONS.BATTERIES_READ, PERMISSIONS.BATTERIES_COMPAT_PROPOSE],
      verify: [PERMISSIONS.BATTERIES_READ, PERMISSIONS.BATTERIES_COMPAT_VERIFY],
      publish: [PERMISSIONS.BATTERIES_READ, PERMISSIONS.BATTERIES_PUBLISH],
      warehouse: [PERMISSIONS.INVENTORY_READ, PERMISSIONS.INVENTORY_ADJUST],
      costs: [PERMISSIONS.INVENTORY_READ, PERMISSIONS.INVENTORY_ADJUST, PERMISSIONS.PRODUCT_COSTS_MANAGE],
      pimread: [PERMISSIONS.PIM_READ],
      all: Object.values(PERMISSIONS),
    };
    c.set('user', { id: `${auth.replace('Bearer ', '')}-id`, permissions: map[auth.replace('Bearer ', '')] ?? [] });
    await next();
  },
}));
import app from '../../apps/api/src/interfaces/http/app';

const json = { 'Content-Type': 'application/json' };
const post = (url: string, token: string, body: unknown) => app.request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...json }, body: JSON.stringify(body) });
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

describe('Batteries admin API: authentication and per-responsibility rights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogue.dashboard.mockResolvedValue({ total: 0 });
    catalogue.list.mockResolvedValue([]);
    catalogue.create.mockResolvedValue({ productId: 'p', profileId: 'q' });
    catalogue.transition.mockResolvedValue({});
    catalogue.detail.mockResolvedValue({});
    compatibility.transition.mockResolvedValue({});
    compatibility.create.mockResolvedValue({ created: [], skipped: [] });
    ledger.recordMovement.mockResolvedValue({ movement: { id: 'm' }, before: 0, after: 1 });
    ledger.listReceipts.mockResolvedValue([]);
    finder.configWithVersion.mockResolvedValue({ config: {}, version: 1 });
    finder.saveConfig.mockResolvedValue({ config: {}, version: 2 });
    imports.list.mockResolvedValue([]);
  });

  it('requires authentication and the read right', async () => {
    expect((await app.request('/admin/batteries/dashboard')).status).toBe(401);
    expect((await app.request('/admin/batteries/dashboard', { headers: { Authorization: 'Bearer pimread' } })).status).toBe(403);
    expect((await app.request('/admin/batteries/dashboard', { headers: { Authorization: 'Bearer read' } })).status).toBe(200);
  });

  it('keeps catalogue writes behind batteries.catalogue.manage', async () => {
    const body = { canonicalCode: 'BL-49FT', brand: 'TECNO' };
    expect((await post('/admin/batteries/catalogue', 'read', body)).status).toBe(403);
    const created = await post('/admin/batteries/catalogue', 'catalogue', body);
    expect(created.status).toBe(201);
    expect(catalogue.create).toHaveBeenCalledWith(expect.objectContaining({ canonicalCode: 'BL-49FT', actorId: 'catalogue-id' }));
  });

  it('validates the body before touching a use case', async () => {
    const res = await post('/admin/batteries/catalogue', 'catalogue', { canonicalCode: '' });
    expect(res.status).toBe(400);
    expect(catalogue.create).not.toHaveBeenCalled();
  });

  it('splits battery transitions: editors submit, only publishers publish or archive', async () => {
    expect((await post('/admin/batteries/catalogue/00000000-0000-4000-8000-000000000001/transition', 'catalogue', { action: 'SUBMIT_REVIEW' })).status).toBe(200);
    expect((await post('/admin/batteries/catalogue/00000000-0000-4000-8000-000000000001/transition', 'catalogue', { action: 'PUBLISH' })).status).toBe(403);
    expect((await post('/admin/batteries/catalogue/00000000-0000-4000-8000-000000000001/transition', 'publish', { action: 'PUBLISH' })).status).toBe(200);
    expect(catalogue.transition).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000001', 'PUBLISH', 'publish-id', null);
  });

  it('splits compatibility: proposers submit, verifiers verify, publishers publish', async () => {
    const id = '00000000-0000-4000-8000-000000000002';
    expect((await post(`/admin/batteries/compatibility/${id}/transition`, 'propose', { action: 'SUBMIT' })).status).toBe(200);
    expect((await post(`/admin/batteries/compatibility/${id}/transition`, 'propose', { action: 'VERIFY', evidenceStatus: 'FIT_TESTED' })).status).toBe(403);
    expect((await post(`/admin/batteries/compatibility/${id}/transition`, 'verify', { action: 'VERIFY', evidenceStatus: 'FIT_TESTED' })).status).toBe(200);
    expect((await post(`/admin/batteries/compatibility/${id}/transition`, 'verify', { action: 'PUBLISH' })).status).toBe(403);
    expect((await post(`/admin/batteries/compatibility/${id}/transition`, 'publish', { action: 'PUBLISH' })).status).toBe(200);
  });

  it('a maker/checker refusal from the use case surfaces as 422 with its code', async () => {
    const { BatteryOperationError } = await import('../../apps/api/src/application/use-cases/batteries/BatteryOperationError');
    compatibility.transition.mockRejectedValueOnce(new BatteryOperationError('MAKER_CHECKER', 'The person who entered or submitted a claim cannot verify it.', 422));
    const res = await post('/admin/batteries/compatibility/00000000-0000-4000-8000-000000000002/transition', 'verify', { action: 'VERIFY', evidenceStatus: 'FIT_TESTED' });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('MAKER_CHECKER');
  });

  it('stock movements need inventory.adjust and only cost managers may record a unit cost', async () => {
    const body = { productId: '00000000-0000-4000-8000-000000000003', movementType: 'RECEIPT', quantity: 5, reason: 'Delivery', supplierName: 'Acme', unitCostUgx: 30000 };
    expect((await post('/admin/batteries/stock/movements', 'read', body)).status).toBe(403);
    expect((await post('/admin/batteries/stock/movements', 'warehouse', body)).status).toBe(201);
    expect(ledger.recordMovement).toHaveBeenLastCalledWith(expect.objectContaining({ canRecordCost: false, unitCostUgx: 30000 }));
    await post('/admin/batteries/stock/movements', 'costs', body);
    expect(ledger.recordMovement).toHaveBeenLastCalledWith(expect.objectContaining({ canRecordCost: true }));
  });

  it('receipt reads strip costs unless the caller may see them', async () => {
    await app.request('/admin/batteries/stock/receipts', { headers: { Authorization: 'Bearer warehouse' } });
    expect(ledger.listReceipts).toHaveBeenLastCalledWith(false, 50);
    await app.request('/admin/batteries/stock/receipts', { headers: { Authorization: 'Bearer costs' } });
    expect(ledger.listReceipts).toHaveBeenLastCalledWith(true, 50);
  });

  it('finder settings are read with batteries.read and written with batteries.publish', async () => {
    expect((await app.request('/admin/batteries/finder-config', { headers: { Authorization: 'Bearer read' } })).status).toBe(200);
    expect((await app.request('/admin/batteries/finder-config', { method: 'PUT', headers: { Authorization: 'Bearer read', ...json }, body: JSON.stringify({ expectedVersion: 1, config: {} }) })).status).toBe(403);
    expect((await app.request('/admin/batteries/finder-config', { method: 'PUT', headers: { Authorization: 'Bearer publish', ...json }, body: JSON.stringify({ expectedVersion: 1, config: {} }) })).status).toBe(200);
  });

  it('imports use the pim.* rights and refuse an upload without a file', async () => {
    expect((await app.request('/admin/batteries/imports', { headers: { Authorization: 'Bearer read' } })).status).toBe(403);
    expect((await app.request('/admin/batteries/imports', { headers: { Authorization: 'Bearer pimread' } })).status).toBe(200);
    const form = new FormData();
    form.set('importType', 'BATTERY_CATALOGUE');
    expect((await app.request('/admin/batteries/imports', { method: 'POST', headers: { Authorization: 'Bearer all' }, body: form })).status).toBe(400);
  });
});

describe('Batteries public finder API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    finder.config.mockResolvedValue({ headline: 'x' });
    finder.indexable.mockResolvedValue(false);
    finder.brands.mockResolvedValue([]);
    finder.search.mockResolvedValue({ kind: 'NO_RESULT', message: 'none', query: 'q', config: {} });
    finder.battery.mockResolvedValue(null);
    finder.recordEvent.mockResolvedValue(undefined);
    finder.submitRequest.mockResolvedValue({ id: 'r' });
  });

  it('is public, cacheable and passes the finder session through as a header', async () => {
    const res = await app.request('/batteries/finder/brands', { headers: { 'x-gp-finder-session': 'sess' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/max-age=60/);
    await app.request('/batteries/finder/search?q=spark', { headers: { 'x-gp-finder-session': 'sess' } });
    expect(finder.search).toHaveBeenCalledWith('spark', 'sess');
  });

  it('an unknown battery slug is a 404, not an empty page', async () => {
    expect((await app.request('/batteries/products/nope')).status).toBe(404);
  });

  it('a request needs at least a phone or a code; a beacon is accepted quietly', async () => {
    finder.submitRequest.mockRejectedValueOnce(Object.assign(new (await import('../../apps/api/src/application/use-cases/batteries/BatteryOperationError')).BatteryOperationError('BAD_INPUT', 'Tell us the phone model.', 400)));
    expect((await app.request('/batteries/finder/requests', { method: 'POST', headers: json, body: JSON.stringify({}) })).status).toBe(400);
    expect((await app.request('/batteries/finder/events', { method: 'POST', headers: json, body: JSON.stringify({ eventType: 'PRODUCT_VIEWED', mode: 'PRODUCT_PAGE', productId: '00000000-0000-4000-8000-000000000003' }) })).status).toBe(202);
  });
});

describe('Batteries module wiring', () => {
  it('registers migration 0125 in the journal after 0124 and exports the schema from the barrel', () => {
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    const entry = journal.entries.find((e: any) => e.tag === '0125_battery_catalogue');
    expect(entry).toBeTruthy();
    const prior = journal.entries.find((e: any) => e.idx === entry.idx - 1);
    expect(entry.when).toBeGreaterThan(prior.when);
    expect(fs.existsSync(path.resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations/0125_battery_catalogue.sql'))).toBe(true);
    expect(read('apps/api/src/infrastructure/db/schema/index.ts')).toContain("export * from './batteries'");
  });

  it('mounts every battery prefix and lists it for the Control Centre', () => {
    const src = read('apps/api/src/interfaces/http/app.ts');
    for (const prefix of ['/admin/batteries', '/admin/batteries/imports', '/batteries']) {
      expect(src).toContain(`app.route('${prefix}'`);
      expect(src).toContain(`'${prefix}',`);
    }
  });

  it('every admin handler carries a permission guard and the public finder never reaches a cost column', () => {
    const admin = read('apps/api/src/interfaces/http/routes/admin/batteries.ts');
    const handlers = admin.match(/routes\.(get|post|put|delete)\(/g) ?? [];
    const guarded = admin.match(/requirePermissions\(/g) ?? [];
    expect(guarded.length).toBe(handlers.length);
    const finderRepo = read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryFinderRepository.ts');
    expect(finderRepo).not.toMatch(/unit_cost|unitCost|supplier_name|supplierName|dealer|cost_price|internal_notes|internalNotes/);
  });

  it('the migration holds the invariants the domain relies on', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0125_battery_catalogue.sql');
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS battery_aliases_active_idx ON battery_aliases (alias_normalised) WHERE is_active");
    expect(sql).toContain('product_device_compat_conditional_chk');
    expect(sql).toContain('product_device_compat_active_chk');
    expect(sql).toContain('inventory_movements_balance_chk');
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS battery_import_sessions_source_idx ON battery_import_sessions (import_type, source_sha256)");
  });
});

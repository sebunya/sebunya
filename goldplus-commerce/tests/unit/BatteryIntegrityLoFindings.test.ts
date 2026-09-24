import { describe, expect, it, vi } from 'vitest';
import { BatteryCatalogueUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases';
import { DeviceCatalogueUseCases } from '../../apps/api/src/application/use-cases/batteries/DeviceCatalogueUseCases';
import { InventoryLedgerUseCases } from '../../apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases';
import { BatteryImportUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryImportUseCases';
import { normaliseImportRow, suggestMapping } from '../../apps/api/src/domain/batteries/BatteryImport';

const audit = { save: vi.fn() } as never;

describe('a pack-fact edit re-opens verification', () => {
  function catalogue(profile: Record<string, unknown>) {
    const updateProfile = vi.fn();
    const repo = {
      findByProductId: vi.fn(async () => ({ profile: { canonicalCode: 'BL-5C', canonicalCodeNormalised: 'BL5C', verificationStatus: 'VERIFIED', lifecycleStatus: 'READY', capacityMah: 4000, ...profile }, product: { name: 'x', shortDescription: '', longDescription: '', priceUgx: 0 } })),
      updateProfile,
      updateProduct: vi.fn(),
    };
    const uc = new BatteryCatalogueUseCases(repo as never, {} as never, {} as never, {} as never, {} as never, audit);
    return { uc, updateProfile };
  }

  it('changing capacity clears VERIFIED', async () => {
    const { uc, updateProfile } = catalogue({});
    await uc.update('p1', { capacityMah: 9999 }, 'maker');
    expect(updateProfile.mock.calls[0][1]).toMatchObject({ capacityMah: 9999, verificationStatus: 'UNVERIFIED', verifiedBy: null, verifiedAt: null });
  });

  it('a live battery must be unpublished first', async () => {
    const { uc, updateProfile } = catalogue({ lifecycleStatus: 'ACTIVE' });
    await expect(uc.update('p1', { capacityMah: 9999 }, 'maker')).rejects.toThrow(/Unpublish the battery before changing pack facts/);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('a non-pack edit keeps the verification', async () => {
    const { uc, updateProfile } = catalogue({});
    await uc.update('p1', { publicNotes: 'Genuine pack' }, 'maker');
    expect(updateProfile.mock.calls[0][1]).not.toHaveProperty('verificationStatus');
  });
});

describe('the importer resolves a merged phone to its target', () => {
  it('ensureDevice follows mergedIntoDeviceId', async () => {
    const repo = {
      findBrand: async () => ({ id: 'b', nameNormalised: 'TECNO' }),
      findDeviceByIdentity: async () => ({ id: 'old', status: 'MERGED', mergedIntoDeviceId: 'new' }),
      findDevice: async (id: string) => ({ id, status: 'ACTIVE', mergedIntoDeviceId: null }),
    };
    const uc = new DeviceCatalogueUseCases(repo as never, audit);
    const out = await uc.ensureDevice({ brandId: 'b', model: 'Spark 7' } as never, 'a');
    expect(out).toEqual({ device: { id: 'new', status: 'ACTIVE', mergedIntoDeviceId: null }, created: false });
  });
});

describe('the dry run refuses what apply would refuse', () => {
  const cols = ['Battery Reference', 'Device Brand', 'Marketing Name'];
  const mapping = suggestMapping('COMPATIBILITY', cols);
  const ctx = (archived = false) => ({
    resolveBattery: () => ({ productId: 'p', canonicalCode: 'BL-5C', lifecycle: 'REVIEW' }),
    findClaim: () => null, deviceArchived: () => archived, locationExists: () => true, receiptAlreadyApplied: () => false, currentStock: () => null,
  }) as never;

  it('a model name longer than the device catalogue allows is an error, not a live orphan brand', () => {
    const r = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-5C', 'Device Brand': 'Nokia', 'Marketing Name': 'x'.repeat(130) }, mapping, ctx());
    expect(r.errors.join(' ')).toMatch(/120 characters/);
  });

  it('an archived phone is an error', () => {
    const r = normaliseImportRow('COMPATIBILITY', { 'Battery Reference': 'BL-5C', 'Device Brand': 'Nokia', 'Marketing Name': '1100' }, mapping, ctx(true));
    expect(r.errors.join(' ')).toMatch(/archived/);
  });
});

describe('rollback removes what the import created', () => {
  function rollbackHarness(rows: unknown[], counts: { liveClaims: number; activeDevices: number }) {
    const setDeviceStatus = vi.fn(async () => undefined);
    const setSeriesStatus = vi.fn(async () => undefined);
    const setBrandStatus = vi.fn(async () => undefined);
    const markRowRolledBack = vi.fn();
    const uc = new BatteryImportUseCases(
      { beginRollback: async () => ({ id: 's', importType: 'COMPATIBILITY' }), rows: async () => rows, markRowRolledBack, finishRollback: async () => ({}) } as never,
      {} as never, {} as never,
      { find: async () => ({ id: 'c', workflowStatus: 'ARCHIVED', device: { label: 'x' } }) } as never,
      { liveClaimCount: async () => counts.liveClaims, activeDeviceCount: async () => counts.activeDevices } as never,
      {} as never, {} as never,
      { transition: vi.fn() } as never,
      { setDeviceStatus, setSeriesStatus, setBrandStatus } as never,
      {} as never,
    );
    return { uc, setDeviceStatus, setSeriesStatus, setBrandStatus, markRowRolledBack };
  }

  it('devices whose only claims were archived by the rollback, and their empty brand and series, are archived', async () => {
    const h = rollbackHarness([{ id: 'r1', rowNumber: 1, status: 'APPLIED', appliedRecordIds: { claims: ['c'], devices: ['d'], brands: ['b'], series: ['s1'] } }], { liveClaims: 0, activeDevices: 0 });
    const out = await h.uc.rollback({ id: 's', expectedVersion: 1, actorId: 'a', reason: 'wrong file' });
    expect(h.setDeviceStatus).toHaveBeenCalledWith('d', 'ARCHIVED', 'a');
    expect(h.setSeriesStatus).toHaveBeenCalledWith('s1', 'ARCHIVED', 'a');
    expect(h.setBrandStatus).toHaveBeenCalledWith('b', 'ARCHIVED', 'a');
    expect(out.rolledBack).toBe(1);
  });

  it('a FAILED row that created a brand is cleaned up without counting as rolled back', async () => {
    const h = rollbackHarness([{ id: 'r2', rowNumber: 2, status: 'FAILED', appliedRecordIds: { brands: ['b2'], series: [], devices: [] } }], { liveClaims: 0, activeDevices: 0 });
    const out = await h.uc.rollback({ id: 's', expectedVersion: 1, actorId: 'a', reason: 'wrong file' });
    expect(h.setBrandStatus).toHaveBeenCalledWith('b2', 'ARCHIVED', 'a');
    expect(h.markRowRolledBack).not.toHaveBeenCalled();
    expect(out.rolledBack).toBe(0);
  });

  it('a device other claims still use is kept, and said so', async () => {
    const h = rollbackHarness([{ id: 'r1', rowNumber: 1, status: 'APPLIED', appliedRecordIds: { claims: ['c'], devices: ['d'] } }], { liveClaims: 2, activeDevices: 1 });
    const out = await h.uc.rollback({ id: 's', expectedVersion: 1, actorId: 'a', reason: 'wrong file' });
    expect(h.setDeviceStatus).not.toHaveBeenCalled();
    expect(out.notes.join(' ')).toMatch(/kept/);
  });
});

describe('a receipt being applied cannot be cancelled, and a lost apply is not reported as success', () => {
  it('cancel refuses a claimed receipt', async () => {
    const repo = { findReceipt: async () => ({ id: 'r', status: 'DRAFT', appliedBy: 'someone', lines: [] }), markReceipt: vi.fn() };
    const uc = new InventoryLedgerUseCases(repo as never, {} as never, audit);
    await expect(uc.cancelReceipt('r', 'b', 'wrong supplier')).rejects.toThrow(/being applied/);
    expect(repo.markReceipt).not.toHaveBeenCalled();
  });

  it('apply that ends CANCELLED throws a state conflict', async () => {
    const repo = {
      findReceipt: async () => ({ id: 'r', status: 'DRAFT', appliedBy: null, supplierName: 'S', supplierReference: null, locationId: null, lines: [{ id: 'l1', productId: 'p', scannedCode: 'BL', quantity: 1, unitCostUgx: null, matchKind: 'EXACT', canonicalCode: 'BL' }] }),
      claimReceiptForApply: async () => true,
      defaultLocation: async () => null,
      applyMovement: async () => ({ ok: true, movement: { id: 'm1' } }),
      markReceipt: async () => ({ id: 'r', status: 'CANCELLED' }),
    };
    const uc = new InventoryLedgerUseCases(repo as never, {} as never, audit);
    await expect(uc.applyReceipt('r', 'a', false)).rejects.toThrow(/posted to stock/);
  });
});

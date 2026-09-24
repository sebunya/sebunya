import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BatteryImportUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryImportUseCases';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

function make(session: Record<string, unknown>, opts: { rows?: unknown[]; events?: unknown[]; resolveResult?: unknown } = {}) {
  const calls: unknown[][] = [];
  const repo = {
    find: async () => session,
    rows: async () => opts.rows ?? [{ id: 'r1', status: 'HELD', normalizedData: { hold: 'compound' } }],
    events: async () => opts.events ?? [],
    resolveRow: async (...a: unknown[]) => { calls.push(a); return opts.resolveResult ?? { session, row: {} }; },
    approve: vi.fn(async () => ({ ...session, status: 'APPROVED' })),
  };
  const uc = Object.create(BatteryImportUseCases.prototype) as BatteryImportUseCases;
  (uc as unknown as Record<string, unknown>).repo = repo;
  return { uc, calls, repo };
}

describe('a row override is a canonical code, nothing else', () => {
  const catalogue = { id: 's', importType: 'BATTERY_CATALOGUE', status: 'READY_FOR_APPROVAL', createdBy: 'uploader', validRows: 2 };

  it('only canonicalCode reaches the repository', async () => {
    const { uc, calls } = make(catalogue);
    await uc.resolveRow({ id: 's', rowId: 'r1', resolution: 'INCLUDE', note: null, override: { canonicalCode: ' BL-4C ' }, actorId: 'b' });
    expect(calls[0][4]).toEqual({ canonicalCode: 'BL-4C' });
  });

  it('refuses any other key, and any override on another import type', async () => {
    await expect(make(catalogue).uc.resolveRow({ id: 's', rowId: 'r1', resolution: 'INCLUDE', note: null, override: { canonicalCode: 'BL-4C', proposedAction: 'CREATE_BATTERY' }, actorId: 'b' })).rejects.toThrow(/Only the canonical code/);
    const stock = { ...catalogue, importType: 'STOCK_RECEIPT' };
    await expect(make(stock, { rows: [{ id: 'r1', status: 'VALID', normalizedData: { productId: 'p', quantity: 1 } }] }).uc.resolveRow({ id: 's', rowId: 'r1', resolution: 'INCLUDE', note: null, override: { productId: 'phone', quantity: 5000 }, actorId: 'b' })).rejects.toThrow(/Only a battery catalogue row/);
  });

  it('a resolve that lost the race to approval says so and changes nothing', async () => {
    const { uc } = make(catalogue, { resolveResult: 'NOT_EDITABLE' });
    await expect(uc.resolveRow({ id: 's', rowId: 'r1', resolution: 'INCLUDE', note: null, override: { canonicalCode: 'BL-4C' }, actorId: 'b' })).rejects.toThrow(/approved or applied/);
  });

  it('whoever rewrote a row cannot approve the import', async () => {
    const events = [{ action: 'ROW_RESOLVED', actorId: 'b', evidence: { override: { canonicalCode: 'BL-4C' } } }];
    const { uc, repo } = make(catalogue, { events });
    await expect(uc.approve({ id: 's', expectedVersion: 1, actorId: 'b', decision: 'APPROVED', reason: 'ok' })).rejects.toThrow(/second person/);
    expect(repo.approve).not.toHaveBeenCalled();
    await expect(make(catalogue, { events }).uc.approve({ id: 's', expectedVersion: 1, actorId: 'c', decision: 'APPROVED', reason: 'ok' })).resolves.toBeTruthy();
  });

  it('the repository locks the session, sends an override back to a fresh dry run, and never takes an action from the override', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryImportRepository.ts');
    const resolveRow = repo.slice(repo.indexOf('async resolveRow('), repo.indexOf('async linkRowBattery('));
    expect(resolveRow).toMatch(/lockEditableSession\(tx, sessionId\)/);
    expect(resolveRow).toMatch(/\.\.\.\(override \? \{ status: 'MAPPED', previewDigest: null \} : \{\}\)/);
    expect(resolveRow).not.toMatch(/override\.proposedAction/);
    const link = repo.slice(repo.indexOf('async linkRowBattery('), repo.indexOf('async approve('));
    expect(link.indexOf('lockEditableSession')).toBeLessThan(link.indexOf('tx.update(batteryImportRows)'));
    expect(link).not.toMatch(/if \(!s\) return null;/);
  });
});

describe('re-saving the mapping clears the row decisions made against the old one', () => {
  it('resolution fields reset with the row, and an unresolved compound never counts as valid', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryImportRepository.ts');
    const saveMapping = repo.slice(repo.indexOf('async saveMapping('), repo.indexOf('async savePreview('));
    expect(saveMapping).toMatch(/resolution: null, resolutionNote: null, resolvedBy: null, resolvedAt: null/);
    const savePreview = repo.slice(repo.indexOf('async savePreview('), repo.indexOf('async resolveRow('));
    expect(savePreview).toMatch(/r\.hold && !overridden\.has\(r\.rowId\) && \(r\.proposedAction === 'HOLD_COMPOUND' \|\| r\.proposedAction === 'HOLD_CONFLICT'\)/);
  });
});

describe('imported batteries and claims are authored by the uploader', () => {
  it('apply records the session creator as the maker, not the applier', () => {
    const src = read('apps/api/src/application/use-cases/batteries/BatteryImportUseCases.ts');
    expect(src).toMatch(/sourceImportSessionId: session\.id,\s+\/\/ The uploader wrote the research; the applier only carried it out\.\s+createdBy: session\.createdBy,/);
    expect(src).toMatch(/this\.compatibility\.create\(\{ productId, deviceIds: \[device\.id\], actorId, createdBy: session\.createdBy,/);
    expect(read('apps/api/src/application/use-cases/batteries/BatteryCompatibilityUseCases.ts')).toMatch(/createdBy: input\.createdBy \?\? input\.actorId,/);
    expect(read('apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases.ts')).toMatch(/createdBy: input\.createdBy \?\? input\.actorId,/);
  });
});

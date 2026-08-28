import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InventoryLedgerUseCases } from '../../apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases';

/**
 * Two integrity defects in the battery module.
 *
 * 1. A RECEIPT COULD BE APPLIED TWICE.
 *    applyReceipt read the status, then posted every line's movement, then set
 *    APPLIED unconditionally. A double-click on the plain HTML form, or two
 *    operators on the same draft, both passed the status check and both posted
 *    every line: a receipt of 20 units added 40, and the ledger disagreed with
 *    the shelf with no record of why.
 *
 * 2. MAKER/CHECKER COULD BE DEFEATED THROUGH THE ARCHIVE.
 *    A material edit reopened a claim for review only when it was READY or
 *    ACTIVE. An ARCHIVED claim kept its reviewedBy through a change of device or
 *    evidence, and RESTORE decides between READY and DRAFT from exactly that
 *    field, so the claim came back READY carrying one person's verification of a
 *    DIFFERENT device.
 */

function ledger(opts: { claimSucceeds: boolean }) {
  const posted: number[] = [];
  const repo = {
    findReceipt: async () => ({
      id: 'r1',
      status: 'DRAFT',
      supplierName: 'Acme',
      supplierReference: 'INV-1',
      locationId: null,
      lines: [
        { id: 'l1', productId: 'p1', scannedCode: 'BL-49FT', canonicalCode: 'BL-49FT', quantity: 20, unitCostUgx: 1000, matchKind: 'EXISTING' },
      ],
    }),
    claimReceiptForApply: async () => opts.claimSucceeds,
    defaultLocation: async () => ({ id: 'loc1' }),
    listLocations: async () => [{ id: 'loc1' }],
    applyMovement: async (input: { delta: number }) => {
      posted.push(input.delta);
      return { ok: true, movement: { id: 'm1' } };
    },
    markReceipt: async () => ({ id: 'r1', status: 'APPLIED' }),
  };
  const useCase = new InventoryLedgerUseCases(
    repo as never,
    {} as never, // battery catalogue repo, unused on this path
    { save: async () => undefined } as never, // audit repo
  );
  return { useCase, posted };
}

describe('a receipt applies once, or not at all', () => {
  it('posts every line when it wins the claim', async () => {
    const { useCase, posted } = ledger({ claimSucceeds: true });
    await useCase.applyReceipt('r1', 'actor', true);
    expect(posted).toEqual([20]);
  });

  it('posts NOTHING when another caller already holds it', async () => {
    // The whole point: the loser must not move stock a second time.
    const { useCase, posted } = ledger({ claimSucceeds: false });
    await expect(useCase.applyReceipt('r1', 'actor', true)).rejects.toThrow();
    expect(posted).toEqual([]);
  });

  it('claims before any movement, not after', () => {
    const src = readFileSync(
      resolve(__dirname, '../../apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('async applyReceipt('), src.indexOf('async cancelReceipt('));
    expect(body.indexOf('claimReceiptForApply')).toBeGreaterThan(-1);
    expect(body.indexOf('claimReceiptForApply')).toBeLessThan(body.indexOf('applyMovement'));
  });

  it('the claim and the settle are both conditional in SQL', () => {
    const repo = readFileSync(
      resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleInventoryLedgerRepository.ts'),
      'utf8',
    );
    // Atomic claim: only a DRAFT nobody holds can be taken.
    expect(repo).toMatch(/eq\(stockReceipts\.status, 'DRAFT'\), isNull\(stockReceipts\.appliedBy\)/);
    // A late duplicate settle matches nothing.
    const mark = repo.slice(repo.indexOf('async markReceipt('));
    expect(mark).toMatch(/and\(eq\(stockReceipts\.id, id\), eq\(stockReceipts\.status, 'DRAFT'\)\)/);
  });
});

describe('a material edit invalidates the verification in every status', () => {
  const src = readFileSync(
    resolve(__dirname, '../../apps/api/src/application/use-cases/batteries/BatteryCompatibilityUseCases.ts'),
    'utf8',
  );

  it('clears the review whenever there was one, not only for READY and ACTIVE', () => {
    expect(src).toMatch(/const hadVerification = !!\(before\.reviewedBy \|\| before\.verifiedBy \|\| before\.publishedBy\);/);
    expect(src).toMatch(/isMaterialEdit\(changed\) && \(hadVerification \|\| before\.workflowStatus === 'READY' \|\| before\.workflowStatus === 'ACTIVE'\)/);
  });

  it('clears the exact field RESTORE reads', () => {
    // CompatibilityWorkflow: `const verified = !!state.reviewedBy && ...`
    const workflow = readFileSync(
      resolve(__dirname, '../../apps/api/src/domain/batteries/CompatibilityWorkflow.ts'),
      'utf8',
    );
    expect(workflow).toMatch(/const verified = !!state\.reviewedBy/);
    expect(src).toMatch(/write\.reviewedBy = null;/);
  });

  it('leaves an archived claim archived, so it returns as a draft', () => {
    // Reopening the status is still limited to READY and ACTIVE.
    expect(src).toMatch(/if \(before\.workflowStatus === 'READY' \|\| before\.workflowStatus === 'ACTIVE'\) \{\s*\n\s*write\.workflowStatus = 'DRAFT';/);
  });
});

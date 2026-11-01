import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FraudTriageOperationError, FraudTriageOperationsUseCase } from '../../apps/api/src/application/use-cases/fraud/FraudTriageOperationsUseCase';

/** #41: a fraud signal used to open a case against any well-formed sourceRef, real or not. */
const signal = {
  referenceKey: 'ref-1', signalKey: 'velocity:primary', sourceType: 'ORDER' as const, sourceRef: 'GP-202609-ABCD',
  signalType: 'PAYMENT_VELOCITY', severity: 'HIGH' as const, reasonCode: 'VELOCITY_THRESHOLD', evidence: { attempts: 4 }, actorId: 'admin-1',
};

function repo() {
  const recorded: unknown[] = [];
  return { recorded, recordSignal: async (input: unknown) => { recorded.push(input); return { fraudCase: {}, signal: {}, duplicate: false }; } };
}

describe('fraud signal sourceRef must name a real record', () => {
  it('refuses a signal whose source does not exist, and records nothing', async () => {
    const r = repo();
    const asked: string[] = [];
    const uc = new FraudTriageOperationsUseCase(r as any, undefined, { exists: async (type, ref) => { asked.push(`${type}:${ref}`); return false; } });
    const err = await uc.recordSignal(signal).catch((e) => e);
    expect(err).toBeInstanceOf(FraudTriageOperationError);
    expect(err.code).toBe('SOURCE_NOT_FOUND');
    expect(asked).toEqual(['ORDER:GP-202609-ABCD']);
    expect(r.recorded).toHaveLength(0);
  });

  it('records a signal whose source exists', async () => {
    const r = repo();
    const uc = new FraudTriageOperationsUseCase(r as any, undefined, { exists: async () => true });
    await uc.recordSignal(signal);
    expect(r.recorded).toHaveLength(1);
  });

  it('checks the shape first: a malformed reference never reaches the lookup', async () => {
    let lookups = 0;
    const uc = new FraudTriageOperationsUseCase(repo() as any, undefined, { exists: async () => { lookups += 1; return true; } });
    const err = await uc.recordSignal({ ...signal, sourceRef: 'bad ref with spaces' }).catch((e) => e);
    expect(err.code).toBe('INVALID_SIGNAL');
    expect(lookups).toBe(0);
  });

  it('production wires the directory, which resolves every source type as text (never a uuid cast error)', () => {
    const registry = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/Registry.ts'), 'utf8');
    expect(registry).toMatch(/new DrizzleFraudSourceDirectory\(\)\);/);
    const dir = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleFraudSourceDirectory.ts'), 'utf8');
    for (const t of ["'ORDER'", "'PAYMENT'", "'CHECKOUT'", "'IDENTITY'"]) expect(dir).toContain(`case ${t}`);
    expect(dir).not.toMatch(/::uuid/);
  });
});

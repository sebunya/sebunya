import { describe, it, expect } from 'vitest';
import { AddAddressUseCase, UpdateAddressUseCase } from '../../../apps/api/src/application/use-cases/addresses/AddressUseCases';

function fakes() {
  const created: any[] = [];
  const patched: any[] = [];
  const repo: any = {
    createForUser: async (input: any) => { created.push(input); return { id: 'a1', ...input }; },
    updateForUser: async (_u: string, _id: string, patch: any) => { patched.push(patch); return { before: { id: 'a1' }, after: { id: 'a1', ...patch } }; },
  };
  const audit: any = { append: async () => undefined };
  return { repo, audit, created, patched };
}

const base = {
  userId: 'u1', label: 'Home', recipientName: 'Ann', phone: '0772123456', district: 'Wakiso', areaDetails: 'Near the church',
  makeDefault: false,
};

describe('customer address input cannot set ops-only fields', () => {
  it('a manual address claiming ops_confirmed still enters the review queue', async () => {
    const f = fakes();
    await new AddAddressUseCase(f.repo, f.audit).execute({
      ...base, rawAddressText: 'Behind Total', resolutionStatus: 'ops_confirmed', gpsSource: 'ops_entered',
      snapshotAreaLabel: 'Fake', snapshotDistrict: 'X', snapshotPostcode: '1', snapshotDataVersion: 9,
    } as any);
    const row = f.created[0];
    expect(row.resolutionStatus).toBe('needs_ops_review');
    expect(row.gpsSource).toBeUndefined();
    expect(row.snapshotAreaLabel).toBeUndefined();
    expect(row.snapshotDataVersion).toBeUndefined();
  });

  it('a patch cannot flip an address to resolved or claim an ops point', async () => {
    const f = fakes();
    await new UpdateAddressUseCase(f.repo, f.audit).execute('u1', 'a1', { resolutionStatus: 'resolved', gpsSource: 'ops_entered', snapshotAreaLabel: 'X' } as any);
    expect(f.patched[0].resolutionStatus).toBeUndefined();
    expect(f.patched[0].gpsSource).toBeUndefined();
    expect(f.patched[0].snapshotAreaLabel).toBeUndefined();
  });

  it('keeps customer gps sources', async () => {
    const f = fakes();
    await new UpdateAddressUseCase(f.repo, f.audit).execute('u1', ' a1 ', { gpsSource: 'device', gpsLat: 0.3, gpsLng: 32.6 });
    expect(f.patched[0].gpsSource).toBe('device');
  });
});

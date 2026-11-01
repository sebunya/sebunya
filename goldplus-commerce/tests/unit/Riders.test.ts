import { describe, expect, it } from 'vitest';
import { IRiderRepository, RiderRow, RiderUseCases, maskRiderPhone } from '../../apps/api/src/application/use-cases/delivery/RiderUseCases';

function repo() {
  const rows: RiderRow[] = [];
  const r: IRiderRepository = {
    list: async () => rows,
    create: async (i) => {
      const row = { id: `r${rows.length + 1}`, name: i.name, phoneE164: i.phoneE164, active: true, createdAt: new Date() };
      rows.push(row);
      return row;
    },
    setActive: async (id, active) => {
      const row = rows.find((x) => x.id === id);
      if (!row) return false;
      row.active = active;
      return true;
    },
  };
  return { r, rows };
}

describe('riders (0190)', () => {
  it('normalises the number, refuses a duplicate or a foreign number, and masks what it shows', async () => {
    const { r, rows } = repo();
    const uc = new RiderUseCases(r);
    const added = await uc.add({ name: '  musa  kato ', phone: '0772 123 456', addedBy: 'admin' });
    expect(added.ok && added.rider.name).toBe('musa kato');
    expect(rows[0].phoneE164).toBe('+256772123456');
    expect(added.ok && added.rider.phoneMasked).toBe('+256 772 ••• 456');
    expect(added.ok && added.rider.phone).toBe('+256772123456'); // admin shows the full number: riders are our own team
    expect((await uc.add({ name: 'Again', phone: '+256772123456', addedBy: null })).ok).toBe(false);
    expect((await uc.add({ name: 'Nairobi', phone: '+254712345678', addedBy: null })).ok).toBe(false);
    expect((await uc.add({ name: 'X', phone: '0700000000', addedBy: null })).ok).toBe(false);
    expect((await uc.list())[0].phone).toBe('+256772123456');
  });
  it('switching off keeps the row', async () => {
    const { r, rows } = repo();
    const uc = new RiderUseCases(r);
    await uc.add({ name: 'Musa', phone: '0772123456', addedBy: null });
    expect((await uc.setActive('r1', false)).ok).toBe(true);
    expect(rows[0].active).toBe(false);
    expect((await uc.setActive('nope', true)).ok).toBe(false);
    expect(maskRiderPhone('12')).toBe('•••');
  });
});

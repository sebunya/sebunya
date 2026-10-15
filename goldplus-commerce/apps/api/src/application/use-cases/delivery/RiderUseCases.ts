/**
 * Riders (0190). A rider has a name and a WhatsApp number; a location message
 * from that number while one of their stops is out for delivery is a
 * handover, not a customer pin. The number is a worker's personal data: shown
 * masked in admin, never exported, never in an audit row.
 */
import { normalisePhoneE164 } from '../../../domain/customer-dna/IdentityStitching';

export interface RiderRow {
  id: string;
  name: string;
  phoneE164: string;
  active: boolean;
  createdAt: Date;
}

export interface IRiderRepository {
  list(): Promise<RiderRow[]>;
  create(input: { name: string; phoneE164: string; addedBy: string | null }): Promise<RiderRow>;
  setActive(id: string, active: boolean): Promise<boolean>;
}

export type RiderResult = { ok: true; rider: RiderMasked } | { ok: false; code: 'BAD_NAME' | 'BAD_PHONE' | 'DUPLICATE' | 'NOT_FOUND'; message: string };

export interface RiderMasked {
  id: string;
  name: string;
  /** +256 7XX ••• 456 */
  phoneMasked: string;
  active: boolean;
  createdAt: Date;
}

export function maskRiderPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  if (d.length < 9) return '•••';
  return `+${d.slice(0, 3)} ${d.slice(3, 6)} ••• ${d.slice(-3)}`;
}

const mask = (r: RiderRow): RiderMasked => ({ id: r.id, name: r.name, phoneMasked: maskRiderPhone(r.phoneE164), active: r.active, createdAt: r.createdAt });

export class RiderUseCases {
  constructor(private readonly repo: IRiderRepository) {}

  async list(): Promise<RiderMasked[]> {
    return (await this.repo.list()).map(mask);
  }

  async add(input: { name: string; phone: string; addedBy: string | null }): Promise<RiderResult> {
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (name.length < 2) return { ok: false, code: 'BAD_NAME', message: "Give the rider's name." };
    const phoneE164 = normalisePhoneE164(input.phone);
    if (!phoneE164) return { ok: false, code: 'BAD_PHONE', message: 'That is not a Ugandan mobile number (07XX XXX XXX).' };
    if ((await this.repo.list()).some((r) => r.phoneE164 === phoneE164)) {
      return { ok: false, code: 'DUPLICATE', message: 'A rider with that number already exists.' };
    }
    return { ok: true, rider: mask(await this.repo.create({ name, phoneE164, addedBy: input.addedBy })) };
  }

  async setActive(id: string, active: boolean): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND'; message: string }> {
    const done = await this.repo.setActive(id, active);
    return done ? { ok: true } : { ok: false, code: 'NOT_FOUND', message: 'No rider with that id.' };
  }
}

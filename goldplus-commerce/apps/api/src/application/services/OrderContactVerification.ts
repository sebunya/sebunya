import { createHash } from 'node:crypto';

/**
 * The one way a customer without an account proves an order is theirs: the
 * order reference plus the phone number or email used at checkout. The
 * public lookup has always used exactly this proof; the guest pay-by-reference
 * path (2026-09-12) needs the same proof, so it lives here once and both
 * routes call it. Pure: the caller supplies the clock, the client address, the
 * shared failed-attempt map and the order finder.
 *
 * Five failed attempts per (address, reference) in ten minutes lock that pair
 * out; a success clears it. An unknown reference and a wrong contact are the
 * same answer — the response never says which half was wrong.
 */
export interface VerifiableOrder {
  id: string;
  orderNumber: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
}

export interface ContactVerificationDeps<O extends VerifiableOrder> {
  attempts: Map<string, { count: number; resetTime: number }>;
  findOrder(reference: string): Promise<O | null>;
}

export type ContactVerificationResult<O> =
  | { ok: true; order: O }
  | { ok: false; status: 400 | 401 | 429; code: 'VERIFICATION_FAILED' | 'TOO_MANY_REQUESTS'; message: string };

const FAILED_MESSAGE = 'We could not verify that order. Please check your reference and contact details.';
export const CONTACT_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
export const CONTACT_LOCKOUT_MAX_FAILURES = 5;

export async function verifyOrderByContact<O extends VerifiableOrder>(
  input: { reference: unknown; contact: unknown; ip: string; now: number },
  deps: ContactVerificationDeps<O>,
): Promise<ContactVerificationResult<O>> {
  const failed = (): ContactVerificationResult<O> => ({ ok: false, status: 400, code: 'VERIFICATION_FAILED', message: FAILED_MESSAGE });
  if (typeof input.reference !== 'string' || typeof input.contact !== 'string') return failed();
  const reference = input.reference.trim();
  const contact = input.contact.trim();
  if (!reference || !contact || reference.length > 80 || contact.length > 120) return failed();
  if (reference.toUpperCase().startsWith('GP-DRAFT-')) return failed();

  const fingerprint = createHash('sha256').update(`${input.ip}-${reference.toUpperCase()}`).digest('hex');
  for (const [key, val] of deps.attempts.entries()) {
    if (val.resetTime <= input.now) deps.attempts.delete(key);
  }
  const record = deps.attempts.get(fingerprint);
  if (record && record.resetTime > input.now && record.count >= CONTACT_LOCKOUT_MAX_FAILURES) {
    return { ok: false, status: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many lookup attempts. Please wait a few minutes and try again.' };
  }
  const registerFailure = (): ContactVerificationResult<O> => {
    const current = deps.attempts.get(fingerprint);
    if (current && current.resetTime > input.now) current.count += 1;
    else deps.attempts.set(fingerprint, { count: 1, resetTime: input.now + CONTACT_LOCKOUT_WINDOW_MS });
    return { ok: false, status: 401, code: 'VERIFICATION_FAILED', message: FAILED_MESSAGE };
  };

  const order = await deps.findOrder(reference);
  if (!order) return registerFailure();
  const normalizedContact = contact.toLowerCase();
  const storedEmail = (order.customerEmail ?? '').trim().toLowerCase();
  const storedPhone = (order.customerPhone ?? '').trim();
  const contactMatch =
    (storedEmail !== '' && normalizedContact === storedEmail) ||
    (storedPhone !== '' && normalizedContact.replace(/\s+/g, '') === storedPhone.replace(/\s+/g, ''));
  if (!contactMatch) return registerFailure();
  deps.attempts.delete(fingerprint);
  return { ok: true, order };
}

import { createHash } from 'node:crypto';
import type { FailureLockoutStore } from '../ports/FailureLockoutStore';
import { normalizeUgandanPhone } from '@goldplus/shared';

/**
 * The one way a customer without an account proves an order is theirs: the
 * order reference plus the phone number or email used at checkout. The
 * public lookup has always used exactly this proof; the guest pay-by-reference
 * path (2026-09-12) needs the same proof, so it lives here once and both
 * routes call it. Pure: the caller supplies the clock, the client address, the
 * shared failure-lockout store and the order finder.
 *
 * Five failed attempts against one reference in ten minutes lock that
 * reference out; a success clears it. The key is the reference ALONE, not
 * (address, reference): the reference is the thing being guessed, and the
 * client address is not a stable identity here — behind Cloudflare the API
 * sees a different edge address on consecutive requests (see D-1), and on
 * 2026-09-12 that spread eight failures over five keys so the sixth attempt
 * still answered 401 in production. An unknown reference and a wrong contact
 * are the same answer — the response never says which half was wrong.
 */
export interface VerifiableOrder {
  id: string;
  orderNumber: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
}

export interface ContactVerificationDeps<O extends VerifiableOrder> {
  /** Shared across replicas in production (Redis); in-memory in tests. */
  lockout: FailureLockoutStore;
  findOrder(reference: string): Promise<O | null>;
}

export type ContactVerificationResult<O> =
  | { ok: true; order: O }
  | { ok: false; status: 400 | 401 | 429; code: 'VERIFICATION_FAILED' | 'TOO_MANY_REQUESTS'; message: string };

const FAILED_MESSAGE = 'We could not verify that order. Please check your reference and contact details.';
export const CONTACT_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
export const CONTACT_LOCKOUT_MAX_FAILURES = 5;

/**
 * One comparable form for a phone number, applied to BOTH the stored and the
 * typed value. Checkout stores the number exactly as typed, so 0772123456,
 * +256772123456, 256772123456, 772123456 and 0772-123-456 are the same phone
 * and must verify as one — each honest mismatch used to count toward the
 * lockout. Anything that is not a recognisable Ugandan number compares on its
 * digits alone.
 */
export function comparablePhone(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  const ugandan = normalizeUgandanPhone(text) ?? (/^7\d{8}$/.test(digits) ? normalizeUgandanPhone(`0${digits}`) : null);
  return ugandan ? ugandan.e164 : digits;
}

/**
 * Order numbers are minted upper-case (GP-202609-2B3E4D39) and matched
 * exactly; a phone keyboard that lower-cases the hex part is still the same
 * reference. UUID references pass through untouched.
 */
function canonicalReference(reference: string): string {
  return /^gp-/i.test(reference) ? reference.toUpperCase() : reference;
}

export async function verifyOrderByContact<O extends VerifiableOrder>(
  input: { reference: unknown; contact: unknown; now: number },
  deps: ContactVerificationDeps<O>,
): Promise<ContactVerificationResult<O>> {
  const failed = (): ContactVerificationResult<O> => ({ ok: false, status: 400, code: 'VERIFICATION_FAILED', message: FAILED_MESSAGE });
  if (typeof input.reference !== 'string' || typeof input.contact !== 'string') return failed();
  const reference = input.reference.trim();
  const contact = input.contact.trim();
  if (!reference || !contact || reference.length > 80 || contact.length > 120) return failed();
  if (reference.toUpperCase().startsWith('GP-DRAFT-')) return failed();

  const fingerprint = createHash('sha256').update(reference.toUpperCase()).digest('hex');
  if ((await deps.lockout.failures(fingerprint, input.now)) >= CONTACT_LOCKOUT_MAX_FAILURES) {
    return { ok: false, status: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many attempts for this order reference. Please wait about 10 minutes and try again, or message us on WhatsApp and we will check it for you.' };
  }
  const registerFailure = async (): Promise<ContactVerificationResult<O>> => {
    await deps.lockout.recordFailure(fingerprint, input.now, CONTACT_LOCKOUT_WINDOW_MS);
    return { ok: false, status: 401, code: 'VERIFICATION_FAILED', message: FAILED_MESSAGE };
  };

  const order = await deps.findOrder(canonicalReference(reference));
  if (!order) return await registerFailure();
  const normalizedContact = contact.toLowerCase();
  const storedEmail = (order.customerEmail ?? '').trim().toLowerCase();
  const storedPhone = comparablePhone(order.customerPhone);
  const typedPhone = contact.includes('@') ? '' : comparablePhone(contact);
  const contactMatch =
    (storedEmail !== '' && normalizedContact === storedEmail) ||
    // Never an empty-vs-empty or a trivially short match: a phone is proven
    // only by at least seven matching digits.
    (storedPhone.replace(/\D/g, '').length >= 7 && typedPhone === storedPhone);
  if (!contactMatch) return await registerFailure();
  await deps.lockout.clear(fingerprint);
  return { ok: true, order };
}

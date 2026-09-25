/**
 * Phone hygiene (0155). The same Ugandan number is stored in up to four shapes
 * (0771…, 256771…, 771…, +256771…) because registration and checkout keep what
 * was typed. This plans two things from a list of stored values:
 *
 * 1. NORMALISATIONS — rewrite a value to its E.164 form. Safe: every reader
 *    that matters already compares on the normalised number (findByPhone
 *    searches all four shapes; loyalty matches E.164 and 0-local).
 * 2. PROPOSED MERGES — two or more ACCOUNTS whose phones are one number. These
 *    are listed for a person to approve and are NEVER applied: which account
 *    survives, and whose orders move, is a human decision.
 *
 * A normalisation that would give two accounts the same users.phone (a unique
 * column) is BLOCKED and appears only under the proposed merge.
 */
import { normalisePhoneE164 } from '../customer-dna/IdentityStitching';

export const PHONE_TABLES = ['users', 'orders', 'addresses', 'quote_requests', 'dealer_applications'] as const;
export type PhoneTable = (typeof PHONE_TABLES)[number];

export interface StoredPhone {
  table: PhoneTable;
  column: string;
  rowId: string;
  raw: string;
  /** users: the user id itself; other tables: the owning account when known. */
  accountUserId: string | null;
}

export interface PlannedNormalisation {
  table: PhoneTable;
  column: string;
  rowId: string;
  from: string;
  to: string;
}

export interface PhoneGroup {
  e164: string;
  masked: string;
  shapes: string[];
  records: number;
  accountUserIds: string[];
}

export interface ProposedMerge {
  e164Masked: string;
  accountUserIds: string[];
  reason: 'SAME_NUMBER_MULTIPLE_ACCOUNTS';
}

export interface PhoneHygienePlan {
  scanned: number;
  alreadyNormalised: number;
  normalisations: PlannedNormalisation[];
  blocked: Array<PlannedNormalisation & { reason: 'WOULD_DUPLICATE_ACCOUNT_PHONE' }>;
  unparseable: Array<{ table: PhoneTable; column: string; rowId: string; masked: string }>;
  /** Numbers stored in more than one shape. */
  mixedFormatGroups: PhoneGroup[];
  proposedMerges: ProposedMerge[];
}

/** +256•••••4567 — enough to recognise, not enough to dial. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `${value.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}•••••${digits.slice(-4)}`;
}

export function planPhoneHygiene(records: StoredPhone[]): PhoneHygienePlan {
  const plan: PhoneHygienePlan = { scanned: records.length, alreadyNormalised: 0, normalisations: [], blocked: [], unparseable: [], mixedFormatGroups: [], proposedMerges: [] };
  const groups = new Map<string, { shapes: Set<string>; records: number; accounts: Set<string> }>();

  for (const r of records) {
    const raw = (r.raw ?? '').trim();
    if (!raw) continue;
    const e164 = normalisePhoneE164(raw);
    if (!e164) {
      plan.unparseable.push({ table: r.table, column: r.column, rowId: r.rowId, masked: maskPhone(raw) });
      continue;
    }
    const g = groups.get(e164) ?? { shapes: new Set<string>(), records: 0, accounts: new Set<string>() };
    g.shapes.add(shapeOf(raw));
    g.records += 1;
    if (r.table === 'users' && r.accountUserId) g.accounts.add(r.accountUserId);
    groups.set(e164, g);
    if (raw === e164) plan.alreadyNormalised += 1;
  }

  for (const [e164, g] of groups) {
    if (g.shapes.size > 1) {
      plan.mixedFormatGroups.push({ e164, masked: maskPhone(e164), shapes: [...g.shapes].sort(), records: g.records, accountUserIds: [...g.accounts].sort() });
    }
    if (g.accounts.size > 1) {
      plan.proposedMerges.push({ e164Masked: maskPhone(e164), accountUserIds: [...g.accounts].sort(), reason: 'SAME_NUMBER_MULTIPLE_ACCOUNTS' });
    }
  }

  for (const r of records) {
    const raw = (r.raw ?? '').trim();
    const e164 = raw ? normalisePhoneE164(raw) : null;
    if (!e164 || raw === e164) continue;
    const item: PlannedNormalisation = { table: r.table, column: r.column, rowId: r.rowId, from: raw, to: e164 };
    const accounts = groups.get(e164)?.accounts.size ?? 0;
    if (r.table === 'users' && accounts > 1) plan.blocked.push({ ...item, reason: 'WOULD_DUPLICATE_ACCOUNT_PHONE' });
    else plan.normalisations.push(item);
  }
  return plan;
}

/** The storage shape, for reporting (never the number itself). */
export function shapeOf(raw: string): string {
  const c = raw.replace(/[\s\-().]/g, '');
  if (/^\+256\d{9}$/.test(c)) return '+256XXXXXXXXX';
  if (/^256\d{9}$/.test(c)) return '256XXXXXXXXX';
  if (/^0\d{9}$/.test(c)) return '0XXXXXXXXX';
  if (/^7\d{8}$/.test(c)) return '7XXXXXXXX';
  return c === raw ? 'OTHER' : 'WITH_SPACES_OR_DASHES';
}

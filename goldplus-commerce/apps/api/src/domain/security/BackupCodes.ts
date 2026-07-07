import { randomInt } from 'node:crypto';

/**
 * One-time recovery codes for when a user loses their authenticator or
 * phone. Generated once, shown once; only hashes are stored, and each
 * code is single-use (consumed on redemption in the application layer).
 */

export const BACKUP_CODE_COUNT = 10;
const GROUP = 4; // "abcd-ef12" style, easy to read/type
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function randomCode(): string {
  let raw = '';
  for (let i = 0; i < GROUP * 2; i++) raw += ALPHABET[randomInt(0, ALPHABET.length)];
  return `${raw.slice(0, GROUP)}-${raw.slice(GROUP)}`;
}

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomCode());
  return [...codes];
}

/** Normalises user input (case/whitespace/dashes) before hashing/compare. */
export function normalizeBackupCode(input: string): string {
  return (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

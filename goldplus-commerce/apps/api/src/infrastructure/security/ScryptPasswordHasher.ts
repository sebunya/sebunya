import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { IPasswordHasher } from '../../application/ports/IPasswordHasher';

const scryptAsync = promisify(scrypt) as (password: string | Buffer, salt: string | Buffer, keylen: number, options: any) => Promise<Buffer>;

// OWASP 2024 minimums for scrypt
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

export class ScryptPasswordHasher implements IPasswordHasher {
  async hash(plaintext: string): Promise<string> {
    if (!plaintext) throw new Error('Plaintext password must not be empty.');
    const salt = randomBytes(SALT_BYTES);
    const derived = (await scryptAsync(plaintext, salt, KEYLEN, { N, r, p })) as Buffer;
    return [
      'scrypt',
      `N=${N}`,
      `r=${r}`,
      `p=${p}`,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  async verify(plaintext: string, storedHash: string): Promise<boolean> {
    if (!plaintext || !storedHash) return false;
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const params: Record<string, number> = {};
    for (const segment of parts.slice(1, 4)) {
      const [k, v] = segment.split('=');
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n)) return false;
      params[k] = n;
    }
    const saltB64 = parts[4];
    const hashB64 = parts[5];

    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(saltB64, 'base64');
      expected = Buffer.from(hashB64, 'base64');
    } catch {
      return false;
    }

    let derived: Buffer;
    try {
      derived = (await scryptAsync(plaintext, salt, expected.length, {
        N: params.N,
        r: params.r,
        p: params.p,
      })) as Buffer;
    } catch {
      return false;
    }

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
}

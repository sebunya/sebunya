import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two defects that made account recovery quietly fail, found by the audit and
 * verified by hand.
 *
 * 1. SMS RESET COULD NOT FIND MOST ACCOUNTS.
 *    Registration accepts /^(\+?256|0)?[17]\d{8}$/ and stores the number as
 *    typed, removing only a leading '+'. So users.phone really holds four forms
 *    of one number: 256771234567, 0771234567, 771234567, and +256771234567 from
 *    phone verification. findByPhone searched only two of them, and one of those
 *    two was the '+' form that registration can NEVER produce.
 *
 *    A customer who typed +256..., 256... or a bare nine digits got the generic
 *    acknowledgement, no SMS was sent, and nothing told them anything was wrong.
 *
 * 2. THE WHOLE STOREFRONT SHARED ONE ABUSE BUDGET.
 *    The auth pages run server side and called the API with no X-Forwarded-For,
 *    so resolveClientAddress fell back to the web container's own address with
 *    confidence UNVERIFIED. publicAbuseControl then keyed every customer to one
 *    bucket, at half the budget. One person fumbling a password could lock out
 *    everybody, and a single visitor could exhaust recovery for the site.
 */

const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

describe('the reset lookup covers every shape the number is stored in', () => {
  const src = read('apps/api/src/infrastructure/db/repositories/DrizzleUserRepository.ts');
  const fn = src.slice(src.indexOf('async findByPhone'), src.indexOf('async findByEmail'));

  it('derives the national part and searches all four forms', () => {
    expect(fn).toMatch(/const national = e164\.slice\(4\);/);
    expect(fn).toMatch(/\[e164, `256\$\{national\}`, `0\$\{national\}`, national\]/);
  });

  it('the four candidates are exactly what registration can produce', () => {
    // Mirrors the real shapes rather than trusting the source text alone.
    const shape = /^(\+?256|0)?[17]\d{8}$/;
    const e164 = '+256771234567';
    const national = e164.slice(4);
    const candidates = [e164, `256${national}`, `0${national}`, national];

    for (const typed of ['+256771234567', '256771234567', '0771234567', '771234567']) {
      expect(shape.test(typed), `${typed} should be accepted at registration`).toBe(true);
      // Registration strips only a leading '+' before storing.
      const stored = typed.startsWith('+') ? typed.slice(1) : typed;
      expect(candidates, `stored form ${stored} must be searchable`).toContain(stored);
    }
  });

  it('still refuses to guess when two accounts claim one number', () => {
    expect(fn).toMatch(/limit: 2/);
    expect(fn).toMatch(/if \(rows\.length !== 1\) return null;/);
  });
});

describe('every SSR auth call is attributed to the real visitor', () => {
  const pages = [
    'apps/web/src/pages/login.astro',
    'apps/web/src/pages/register.astro',
    'apps/web/src/pages/forgot-password.astro',
    'apps/web/src/pages/reset-password.astro',
  ];

  for (const page of pages) {
    it(`${page} forwards the client address`, () => {
      const src = read(page);
      expect(src).toMatch(/import \{ jsonApiHeaders \} from '\.\.\/lib\/forwardClient';/);
      expect(src).toMatch(/headers: jsonApiHeaders\(clientAddress\)/);
    });

    it(`${page} reads the address defensively`, () => {
      // Astro throws on clientAddress in a prerendered context. Losing the
      // attribution is acceptable; breaking sign-in is not.
      const src = read(page);
      expect(src).toMatch(/try \{\s*\n\s*clientAddress = Astro\.clientAddress \?\? null;/);
    });

    it(`${page} no longer posts a bare Content-Type header to the API`, () => {
      // The defect shape: a server-side auth call with no forwarded address.
      const src = read(page);
      const authCalls = src.match(/apiBase\}\/auth\/[\s\S]{0,220}?\}\)/g) ?? [];
      expect(authCalls.length).toBeGreaterThan(0);
      for (const call of authCalls) {
        expect(call, call.slice(0, 90)).not.toMatch(/headers: \{ 'Content-Type': 'application\/json' \}/);
      }
    });
  }

  it('the helper only ever adds the header when there is an address', () => {
    const helper = read('apps/web/src/lib/forwardClient.ts');
    expect(helper).toMatch(/if \(clientAddress\) headers\['X-Forwarded-For'\] = clientAddress;/);
    expect(helper).toMatch(/catch/);
  });
});

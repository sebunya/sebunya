import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkRequestOrigin,
  allowedHosts,
  CROSS_SITE_MESSAGE,
} from '../../apps/web/src/lib/requestOrigin';
import {
  buildIntentKeyring,
  deriveIntentKey,
  issueCheckoutIntent,
  verifyCheckoutIntent,
  MIN_INTENT_ROOT_SECRET_LENGTH,
} from '../../packages/shared/src/checkout-intent';

/**
 * Checkout is a top-level form POST to the Astro server and there was no origin
 * check of any kind. The intent cookie is SameSite=Lax, so a cross-site POST
 * arrives without it — and the response to a missing cookie was to MINT a fresh
 * guest identity and carry on. A request the browser had already labelled
 * cross-site was answered by inventing an identity for it.
 */

const ENV = { PUBLIC_SITE_ORIGINS: 'https://goldplus.example,https://www.goldplus.example' };

const post = (headers: Record<string, string>) =>
  new Request('https://goldplus.example/checkout', { method: 'POST', headers });

describe('a cross-site request is refused', () => {
  it('refuses when the browser says cross-site', () => {
    const decision = checkRequestOrigin(post({ 'sec-fetch-site': 'cross-site' }), ENV);
    expect(decision).toEqual({ allowed: false, reason: 'CROSS_SITE' });
  });

  it('refuses a navigation with no initiator', () => {
    // `none` means a typed URL or a bookmark, which cannot be this page's form
    // submission.
    expect(checkRequestOrigin(post({ 'sec-fetch-site': 'none' }), ENV).allowed).toBe(false);
  });

  it('refuses a foreign Origin', () => {
    const decision = checkRequestOrigin(post({ origin: 'https://evil.example' }), ENV);
    expect(decision).toEqual({ allowed: false, reason: 'ORIGIN_MISMATCH' });
  });

  it('refuses an Origin that merely looks like ours', () => {
    for (const origin of [
      'https://goldplus.example.evil.test',
      'https://notgoldplus.example',
      'https://goldplus.example:8443',
    ]) {
      expect(checkRequestOrigin(post({ origin }), ENV).allowed, origin).toBe(false);
    }
  });

  it('refuses Origin: null', () => {
    // Sent for some privacy-sensitive navigations. It is not a host, so it cannot
    // match one.
    expect(checkRequestOrigin(post({ origin: 'null' }), ENV).allowed).toBe(false);
  });

  it('fails CLOSED when the request carries no origin evidence at all', () => {
    // "No header" is exactly what a hand-rolled cross-origin request looks like. A
    // same-origin browser form POST always carries at least one of these.
    expect(checkRequestOrigin(post({}), ENV)).toEqual({
      allowed: false,
      reason: 'NO_ORIGIN_EVIDENCE',
    });
  });

  it('refuses a foreign Referer when Origin is absent', () => {
    expect(
      checkRequestOrigin(post({ referer: 'https://evil.example/attack' }), ENV).allowed,
    ).toBe(false);
  });
});

describe('a genuine same-site request is allowed', () => {
  it('allows same-origin', () => {
    expect(checkRequestOrigin(post({ 'sec-fetch-site': 'same-origin' }), ENV)).toEqual({
      allowed: true,
      basis: 'SEC_FETCH_SITE',
    });
  });

  it('allows same-site, so www and apex both work', () => {
    expect(checkRequestOrigin(post({ 'sec-fetch-site': 'same-site' }), ENV).allowed).toBe(true);
  });

  it('allows a configured Origin when Sec-Fetch-Site is absent', () => {
    for (const origin of ['https://goldplus.example', 'https://www.goldplus.example']) {
      expect(checkRequestOrigin(post({ origin }), ENV), origin).toEqual({
        allowed: true,
        basis: 'ORIGIN',
      });
    }
  });

  it('allows a configured Referer as a last resort', () => {
    expect(
      checkRequestOrigin(post({ referer: 'https://goldplus.example/cart' }), ENV),
    ).toEqual({ allowed: true, basis: 'REFERER' });
  });

  it('prefers the browser\'s own verdict over a spoofable Origin', () => {
    // Sec-Fetch-Site is a forbidden header, so page script cannot set it. When both
    // are present it must win.
    expect(
      checkRequestOrigin(
        post({ 'sec-fetch-site': 'cross-site', origin: 'https://goldplus.example' }),
        ENV,
      ).allowed,
    ).toBe(false);
  });
});

describe('allowed hosts are configured, never inferred from the request', () => {
  it('reads the configured origin list', () => {
    expect(allowedHosts(ENV)).toEqual(['goldplus.example', 'www.goldplus.example']);
  });

  it('accepts bare hosts as well as URLs', () => {
    expect(allowedHosts({ PUBLIC_SITE_ORIGINS: 'shop.example' })).toEqual(['shop.example']);
  });

  it('reports nothing when the variable is unset, rather than inventing a default', () => {
    expect(allowedHosts({})).toEqual([]);
  });

  it('falls back to the request host when nothing is configured', () => {
    // Weaker — behind a proxy the forwarded Host is attacker-settable — but the
    // alternative is refusing every POST until an operator sets a variable, and a
    // guard like that gets reverted rather than configured.
    expect(checkRequestOrigin(post({ origin: 'https://goldplus.example' }), {}).allowed).toBe(true);
    expect(checkRequestOrigin(post({ origin: 'https://evil.example' }), {}).allowed).toBe(false);
  });

  it('still refuses a cross-site POST with no configuration at all', () => {
    // This is what makes the guard safe to ship unconfigured: the primary signal
    // needs no variable.
    expect(checkRequestOrigin(post({ 'sec-fetch-site': 'cross-site' }), {}).allowed).toBe(false);
    expect(checkRequestOrigin(post({}), {}).allowed).toBe(false);
  });

  it('prefers the configured list over the request host once it is set', () => {
    const decision = checkRequestOrigin(
      post({ origin: 'https://goldplus.example' }),
      { PUBLIC_SITE_ORIGINS: 'https://other.example' },
    );
    expect(decision.allowed).toBe(false);
  });
});

describe('the checkout page refuses before it mints', () => {
  const page = readFileSync(
    join(__dirname, '../../apps/web/src/pages/checkout.astro'),
    'utf8',
  );
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('checks the origin before resolving the intent', () => {
    // Resolving MINTS. Checking afterwards would still hand a cross-site request a
    // freshly issued checkout identity.
    const checkAt = code.indexOf('checkRequestOrigin(');
    const resolveAt = code.indexOf('resolveCheckoutIntent(Astro.cookies');
    expect(checkAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(checkAt);
  });

  it('does not resolve an intent at all for a refused request', () => {
    expect(code).toContain('originDecision.allowed\n  ? resolveCheckoutIntent');
  });

  it('does not run the submission branch for a refused request', () => {
    expect(code).toMatch(/method === 'POST' && originDecision\.allowed/);
  });

  it('tells the customer without naming the header that failed', () => {
    expect(code).toContain('CROSS_SITE_MESSAGE');
    expect(CROSS_SITE_MESSAGE).not.toMatch(/sec-fetch|origin|referer/i);
  });
});

describe('the signing keyring is explicit and shared', () => {
  const root = 'a'.repeat(MIN_INTENT_ROOT_SECRET_LENGTH);

  it('refuses a root secret too short to be safe', () => {
    // The KDF makes the derived key 32 bytes wide whatever it is given, so a weak
    // root hides behind a healthy-looking key and the deployment looks correct.
    expect(() => deriveIntentKey('short', '1')).toThrow('CHECKOUT_INTENT_SECRET_TOO_SHORT');
    expect(() => deriveIntentKey('', '1')).toThrow('CHECKOUT_INTENT_SECRET_MISSING');
  });

  it('refuses a key id that could be confused with the payload', () => {
    for (const keyId of ['a.b', 'a b', '', 'x'.repeat(33)]) {
      expect(() => deriveIntentKey(root, keyId), keyId).toThrow('CHECKOUT_INTENT_KEY_ID_INVALID');
    }
  });

  it('puts the current key first so the common case costs one HMAC', () => {
    const keys = buildIntentKeyring({ rootSecret: root, currentKeyId: '2', previousKeyId: '1' });
    expect(keys.map((k) => k.keyId)).toEqual(['2', '1']);
  });

  it('accepts a token signed with the previous key during a rotation', () => {
    // A rotation that logs out every mid-checkout customer is one nobody performs.
    const old = deriveIntentKey(root, '1');
    const token = issueCheckoutIntent({ key: old, kind: 'GUEST' }).token;
    const keyring = buildIntentKeyring({ rootSecret: root, currentKeyId: '2', previousKeyId: '1' });
    expect(verifyCheckoutIntent(keyring, token).valid).toBe(true);
  });

  it('rejects a token from a key that is no longer in the ring', () => {
    const retired = deriveIntentKey(root, '0');
    const token = issueCheckoutIntent({ key: retired, kind: 'GUEST' }).token;
    const keyring = buildIntentKeyring({ rootSecret: root, currentKeyId: '2', previousKeyId: '1' });
    expect(verifyCheckoutIntent(keyring, token).valid).toBe(false);
  });

  it('treats a previous id equal to the current one as no rotation', () => {
    // Adding it would double every verification and make the configuration claim a
    // rotation was under way when none was.
    const keys = buildIntentKeyring({ rootSecret: root, currentKeyId: '2', previousKeyId: '2' });
    expect(keys).toHaveLength(1);
  });

  it('derives unrelated keys for different key ids from one root', () => {
    expect(deriveIntentKey(root, '1').secret).not.toBe(deriveIntentKey(root, '2').secret);
  });

  it('is built by ONE shared function, so issuer and verifier cannot drift', () => {
    // Both sides assembled this list independently from the same variables. A
    // keyring that differs between them rejects every token, and the symptom is
    // customers unable to check out with nothing naming the rotation.
    for (const path of [
      '../../apps/api/src/interfaces/http/middleware/checkoutIntent.ts',
      '../../apps/web/src/lib/checkoutIntent.ts',
    ]) {
      const source = readFileSync(join(__dirname, path), 'utf8');
      expect(source, path).toContain('buildIntentKeyring(');
      expect(source, path).not.toMatch(/previousId !== currentId/);
    }
  });
});

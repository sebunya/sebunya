import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  validateRegistration,
  fieldErrorsFromBadInput,
  firstErrorField,
  registerBannerMessage,
  sanitiseJoinPhone,
  registerUrlWithoutPhone,
  REGISTER_FIELD_MESSAGES,
} from '../../apps/web/src/lib/registerForm';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');

const ok = { email: 'a@example.com', phone: '0772 123 456', password: 'longenough', confirmPassword: 'longenough' };

describe('register: every refusal marks the field it is about (jury 2026-09-24)', () => {
  it('accepts exactly what the API accepts', () => {
    expect(validateRegistration(ok)).toEqual({});
    for (const phone of ['0772123456', '+256772123456', '256772123456', '772123456', '0772-123-456']) {
      expect(validateRegistration({ ...ok, phone })).toEqual({});
    }
  });

  it('marks the wrong field with the page\'s own words', () => {
    expect(validateRegistration({ ...ok, phone: '12345' })).toEqual({ phone: REGISTER_FIELD_MESSAGES.phone });
    expect(validateRegistration({ ...ok, password: 'abc', confirmPassword: 'abc' })).toEqual({ password: REGISTER_FIELD_MESSAGES.password });
    expect(validateRegistration({ ...ok, confirmPassword: 'different1' })).toEqual({ confirmPassword: REGISTER_FIELD_MESSAGES.confirmPassword });
    expect(validateRegistration({ ...ok, email: 'nope' })).toEqual({ email: REGISTER_FIELD_MESSAGES.email });
    const empty = validateRegistration({ email: '', phone: '', password: '', confirmPassword: '' });
    expect(Object.keys(empty).sort()).toEqual(['email', 'password', 'phone']);
    expect(firstErrorField(empty)).toBe('email');
  });

  it('reads a BAD_INPUT message only to classify it, never to show it', () => {
    expect(fieldErrorsFromBadInput('Enter a valid Ugandan phone number (07XX XXX XXX).')).toEqual({ phone: REGISTER_FIELD_MESSAGES.phone });
    expect(fieldErrorsFromBadInput('Password must be at least 8 characters.')).toEqual({ password: REGISTER_FIELD_MESSAGES.password });
    expect(fieldErrorsFromBadInput('Enter a valid email address.')).toEqual({ email: REGISTER_FIELD_MESSAGES.email });
    expect(fieldErrorsFromBadInput(undefined)).toEqual({});
  });

  it('the banner only promises marked fields when some are marked', () => {
    expect(registerBannerMessage({})).not.toMatch(/marked|highlighted/i);
    expect(registerBannerMessage({ phone: 'x' })).toBe('Please fix the field marked below.');
    expect(registerBannerMessage({ phone: 'x', email: 'y' })).toBe('Please fix the fields marked below.');
  });

  it('the page passes each error to its field and focuses the first', () => {
    const page = read('apps/web/src/pages/register.astro');
    for (const f of ['email', 'phone', 'password', 'confirmPassword']) {
      expect(page).toContain(`errorMessage={fieldErrors.${f}}`);
      expect(page).toContain(`autofocus={focusField === '${f}'}`);
    }
    expect(page).not.toContain('Check the highlighted fields');
    const field = read('apps/web/src/components/FormField.astro');
    expect(field).toMatch(/autofocus=\{autofocus \|\| undefined\}/);
  });
});

describe('register: the header "Join free" number never stays in the URL', () => {
  it('keeps only phone characters, capped', () => {
    expect(sanitiseJoinPhone('0772 123 456')).toBe('0772 123 456');
    expect(sanitiseJoinPhone('+256772123456')).toBe('+256772123456');
    expect(sanitiseJoinPhone('<script>alert(1)</script>')).toBe('1');
    expect(sanitiseJoinPhone('abc')).toBe('');
    expect(sanitiseJoinPhone('07+72')).toBe('0772');
    expect(sanitiseJoinPhone('0'.repeat(50)).length).toBeLessThanOrEqual(20);
    expect(sanitiseJoinPhone(null)).toBe('');
  });

  it('redirects to /register with only returnTo and ref kept', () => {
    expect(registerUrlWithoutPhone(new URL('https://x.test/register?phone=0772123456'))).toBe('/register');
    expect(registerUrlWithoutPhone(new URL('https://x.test/register?phone=0772&ref=GP1234&returnTo=%2Fcheckout&utm=1')))
      .toBe('/register?returnTo=%2Fcheckout&ref=GP1234');
  });

  it('the page carries it in a short-lived httpOnly cookie scoped to /register', () => {
    const page = read('apps/web/src/pages/register.astro');
    expect(page).toMatch(/searchParams\.has\('phone'\)/);
    expect(page).toMatch(/Astro\.redirect\(registerUrlWithoutPhone\(Astro\.url\), 303\)/);
    expect(page).toMatch(/path: '\/register',\s*httpOnly: true,\s*sameSite: 'lax',\s*maxAge: 600/);
    expect(page).toMatch(/Astro\.cookies\.delete\(JOIN_PHONE_COOKIE, \{ path: '\/register' \}\)/);
  });
});

describe('accounts copy tells the loyalty rule the terms state: points on DELIVERY', () => {
  it('no owned surface says points come with a paid order', () => {
    for (const f of [
      'apps/web/src/pages/register.astro',
      'apps/web/src/pages/account/index.astro',
      'apps/web/src/pages/account/loyalty.astro',
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/every paid order|points when paid|credited when the order is paid/i);
    }
  });
});

describe('support, warranty and error pages', () => {
  it('warranty is not called a draft and shows a readable date', () => {
    const w = read('apps/web/src/pages/warranty.astro');
    expect(w).not.toMatch(/This draft/);
    expect(w).toContain("timeZone: 'Africa/Kampala'");
    expect(w).not.toContain('Effective date: {policy.effectiveDate}');
  });

  it('support states the returns policy from the one fact and shows contact details from business_info', () => {
    const s = read('apps/web/src/pages/support/index.astro');
    expect(s).toContain('{RETURNS_POLICY.windowDays} days');
    expect(s).not.toMatch(/depend on the product, order details and the applicable GoldPlus policy/);
    expect(s).toContain('getBusinessInfo()');
    expect(s).toContain('href={biz.phoneDial}');
    expect(s).toContain('href="/terms"');
  });

  it('error pages keep a visible focus ring and the 404 has an h1 and a way on', () => {
    for (const f of ['apps/web/src/pages/404.astro', 'apps/web/src/pages/500.astro', 'apps/web/src/pages/offline.astro']) {
      expect(read(f), f).not.toContain('ring-brand-charcoal/10');
    }
    const nf = read('apps/web/src/pages/404.astro');
    expect(nf).toMatch(/<h1[^>]*>We could not find that page<\/h1>/);
    expect(nf).toMatch(/<form action="\/shop" method="get" role="search"/);
    expect(nf).toContain('href="/track-order"');
    const off = read('apps/web/src/pages/offline.astro');
    expect(off).not.toContain('⌁');
    expect(off).not.toMatch(/will sync/);
  });
});

describe('signed-in order and account pages', () => {
  it('order detail shows dispatch progress itself and dates in Kampala time without seconds', () => {
    const o = read('apps/web/src/pages/orders/[id].astro');
    expect(o).toContain('aria-label="Dispatch progress"');
    for (const stage of ['Order placed', 'Confirmed & preparing', 'Dispatched', 'Delivered']) expect(o).toContain(stage);
    expect(o).toContain('not a live map');
    expect(o).not.toContain("toLocaleString('en-GB')}");
    expect(o).not.toMatch(/track-order\?reference=/);
  });

  it('the empty order list offers a way forward', () => {
    const a = read('apps/web/src/pages/account/orders.astro');
    expect(a).toContain('href="/shop"');
    expect(a).toContain('href="/track-order"');
  });
});

describe('preference centre offers no invented interests and no "offers" under a no-marketing promise', () => {
  it('has no hard-coded interest topics and honest channel copy', () => {
    const f = read('apps/web/src/components/preferences/PreferenceCentreForm.astro');
    expect(f).not.toMatch(/Laptops|Gaming|Home Office|Product Interests/);
    expect(f).not.toMatch(/occasional offers/i);
    expect(f).toContain('GoldPlus does not send marketing messages');
    expect(f).not.toMatch(/Personalization|Save Preferences/);
  });
});

describe('form fields have a visible edge (WCAG 1.4.11)', () => {
  it('FormField no longer uses the 1.24:1 gray-200 border on a gray-50 fill', () => {
    const f = read('apps/web/src/components/FormField.astro');
    expect(f).not.toMatch(/bg-gray-50 border border-gray-200/);
    expect(f).toContain('border-gray-500');
  });

  it('primary submit buttons on account forms are at least 48px and use a real ink colour', () => {
    for (const file of ['apps/web/src/pages/login.astro', 'apps/web/src/pages/register.astro', 'apps/web/src/pages/support/issue.astro', 'apps/web/src/pages/support/fake.astro']) {
      const src = read(file);
      const button = src.match(/<button\s+type="submit"[^>]*class="([^"]+)"/)?.[1] ?? '';
      expect(button, file).toContain('min-h-12');
      expect(src, file).not.toMatch(/text-gray-955|active:scale-98\b|hover:bg-red-750/);
    }
  });
});

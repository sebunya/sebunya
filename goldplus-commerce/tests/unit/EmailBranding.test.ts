import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GENERATED_EMAIL_TEMPLATES } from '../../apps/api/src/infrastructure/notifications/email/generatedEmailTemplates';

/**
 * Every email carries the real GoldPlus logo (not the name typed as text), from
 * an absolute https address mail clients can fetch, with alt text so an image-
 * blocking client still shows "GoldPlus". The asset has its own path under
 * /email so a website header change can never break it in inboxes.
 */
const LOGO = 'https://shopgoldplus.com/email/goldplus-logo-email-300x86.png';

describe('email branding', () => {
  it('every template shows the logo image with alt text, and none still types the brand as a text link', () => {
    for (const [key, t] of Object.entries(GENERATED_EMAIL_TEMPLATES) as Array<[string, { html: string }]>) {
      expect(t.html, key).toContain(`<img src="${LOGO}"`);
      expect(t.html, key).toMatch(/alt="GoldPlus"/);
      expect(t.html, key).not.toMatch(/class="brand"/);
      expect(t.html, key).not.toMatch(/#96cc06/i); // one brand lime: #93D500
    }
  });
  it('the logo file the emails point at exists in the site\'s public assets', () => {
    const file = path.resolve(__dirname, '../../apps/web/public/email/goldplus-logo-email-300x86.png');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
  });
});

import { describe, expect, it } from 'vitest';
import {
  PERMITTED_SHARE_FIELDS, PUBLIC_BUY_URL, captionSuggestions, shareContent, shareFileName, themeArt, wrapLines,
} from '../../apps/web/src/lib/giftCardShare';
import { GIFT_CARD_THEMES } from '../../apps/web/src/lib/giftCardThemes';
import { GIFT_CARD_OCCASIONS } from '../../apps/api/src/domain/credit/GiftCardOccasions';
import { readFileSync } from 'node:fs';

const source = { occasion: 'birthday', recipientName: 'Sarah Nakato', senderName: 'Rob', message: 'Happy birthday! 🎂', originalUgx: 75_000 };
const none = { recipientName: false, senderName: false, message: false, amount: false };

describe('Share your gift: what may reach the picture', () => {
  it('starts with the occasion only: every personal detail and the amount are off until chosen', () => {
    expect(shareContent(source, none)).toEqual({ occasion: 'birthday' });
  });

  it('each switch adds exactly its own field; the amount is the ORIGINAL value', () => {
    expect(shareContent(source, { ...none, recipientName: true })).toEqual({ occasion: 'birthday', recipientName: 'Sarah Nakato' });
    expect(shareContent(source, { ...none, senderName: true, amount: true })).toEqual({ occasion: 'birthday', senderName: 'Rob', originalUgx: 75_000 });
    expect(shareContent(source, { ...none, message: true })).toEqual({ occasion: 'birthday', message: 'Happy birthday! 🎂' });
  });

  it('whatever the source holds, only the permitted fields come out (a code or balance cannot pass through)', () => {
    const leaky = { ...source, code: 'GPGC-AAAA-BBBB-CCCC', balanceUgx: 12_000, link: 'https://shopgoldplus.com/gift-card/open#GPGC-AAAA-BBBB-CCCC', phone: '+256772111222' } as never;
    const out = shareContent(leaky, { recipientName: true, senderName: true, message: true, amount: true });
    expect(Object.keys(out).every((k) => (PERMITTED_SHARE_FIELDS as readonly string[]).includes(k))).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/GPGC|12000|#|\+256/);
  });

  it('a shorter message for the picture replaces only the picture’s copy; an unknown occasion takes the GoldPlus look', () => {
    expect(shareContent(source, { ...none, message: true }, 'Happy birthday!').message).toBe('Happy birthday!');
    expect(source.message).toBe('Happy birthday! 🎂');
    expect(shareContent({ ...source, occasion: 'nonsense' }, none).occasion).toBe('gold');
  });

  it('file names say only the occasion and size', () => {
    expect(shareFileName('mothers_day', 'story')).toBe('goldplus-gift-mothers-day-story.png');
    expect(shareFileName('birthday', 'square')).toBe('goldplus-gift-birthday-square.png');
  });

  it('captions: the occasion’s own first, a general thank-you always; never the message, no hashtags or tags; the link is the public buy page', () => {
    expect(captionSuggestions('birthday')[0]).toBe('Such a thoughtful birthday surprise. Thank you! 🎂');
    expect(captionSuggestions('anniversary')[0]).toBe('An anniversary surprise from my favourite person. ❤️');
    expect(captionSuggestions('christmas')[0]).toBe('Someone made Christmas extra special. Thank you ❤️');
    for (const o of GIFT_CARD_OCCASIONS) {
      const c = captionSuggestions(o);
      expect(c).toContain('This made my day. Thank you ❤️');
      expect(c.join(' ')).not.toMatch(/#|@|shopgoldplus/);
    }
    expect(PUBLIC_BUY_URL).toBe('https://shopgoldplus.com/gift-card/buy');
  });

  it('every occasion the API knows is drawn by the storefront, and its art reads (gradient and motif)', () => {
    expect(GIFT_CARD_THEMES.map((t) => t.key).sort()).toEqual([...GIFT_CARD_OCCASIONS].sort());
    for (const t of GIFT_CARD_THEMES) {
      const a = themeArt(t);
      expect(a.from).toMatch(/^#[0-9A-F]{6}$/i);
      expect(a.to).toMatch(/^#[0-9A-F]{6}$/i);
      expect(a.motif).toMatch(/^data:image\/svg\+xml,/);
    }
  });

  it('lines wrap at the width and a long word is broken, never shrunk', () => {
    const ctx = { measureText: (s: string) => ({ width: s.length * 10 }) } as never;
    expect(wrapLines(ctx, 'Happy birthday to you my friend', 100)).toEqual(['Happy', 'birthday', 'to you my', 'friend']);
    expect(wrapLines(ctx, 'Supercalifragilistic', 100)).toEqual(['Supercalif', 'ragilistic']);
  });

  it('the share script reads only the permitted source, never the code on the page', () => {
    const page = readFileSync(new URL('../../apps/web/src/pages/gift-card/open.astro', import.meta.url), 'utf8');
    const shareScript = page.slice(page.lastIndexOf('<script>'));
    expect(shareScript).toContain("getElementById('gc-share-source')");
    expect(shareScript).not.toMatch(/data-scratch-code|opened\.code|location\.hash|balanceUgx/);
    // The server-side source object is built from named fields only.
    const sourceBlock = page.slice(page.indexOf('const shareSource'), page.indexOf('} : null;', page.indexOf('const shareSource')));
    expect(sourceBlock).not.toMatch(/code|balance|masked|reason/);
  });
});

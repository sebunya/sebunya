import { describe, expect, it } from 'vitest';
import { whatsappHref, whatsappMessageFrom } from '../../apps/web/src/lib/whatsappPrefill';

const BASE = 'https://wa.me/256705004545';
const text = (href: string) => new URL(href).searchParams.get('text');

describe('WhatsApp prefill: one URL, the message encoded once', () => {
  it('a plain message is encoded once', () => {
    const href = whatsappHref(BASE, 'Hi GoldPlus, I need a battery for my phone. Model: Tecno Spark 10+');
    expect(href.startsWith(BASE + '?text=')).toBe(true);
    expect(text(href)).toBe('Hi GoldPlus, I need a battery for my phone. Model: Tecno Spark 10+');
  });

  it('a stored full wa.me URL (the live Power-menu defect) is unwrapped, not nested', () => {
    const stored = 'https://wa.me/256705004545?text=Hi%20GoldPlus%2C%20I%20need%20a%20battery%20for%20my%20';
    const href = whatsappHref(BASE, stored);
    expect(text(href)).toBe('Hi GoldPlus, I need a battery for my');
    expect(text(href)).not.toMatch(/^https?:/);
  });

  it('the recipient is always the admin-owned base, never the number inside the prefill', () => {
    const href = whatsappHref(BASE, 'https://wa.me/256700000000?text=hello');
    expect(href.startsWith(BASE)).toBe(true);
    expect(text(href)).toBe('hello');
  });

  it('a doubly-encoded URL still yields the message', () => {
    const inner = 'https://wa.me/256705004545?text=' + encodeURIComponent('Hi GoldPlus');
    const outer = 'https://wa.me/256705004545?text=' + encodeURIComponent(inner);
    expect(whatsappMessageFrom(outer)).toBe('Hi GoldPlus');
  });

  it('no prefill → the bare link; unicode and & survive', () => {
    expect(whatsappHref(BASE)).toBe(BASE);
    expect(whatsappHref(BASE, '')).toBe(BASE);
    expect(text(whatsappHref(BASE, 'Tecno & itel — Ñ'))).toBe('Tecno & itel — Ñ');
  });
});

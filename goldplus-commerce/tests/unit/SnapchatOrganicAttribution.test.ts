import { describe, it, expect, vi, beforeEach } from 'vitest';

const SNAP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Snapchat/13.10.0.42 (like Safari/604.1)';

function browser(search: string, ua: string, referrer = '') {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.stubGlobal('location', { search, pathname: '/products/x', host: 'shopgoldplus.com' });
  vi.stubGlobal('navigator', { userAgent: ua });
  vi.stubGlobal('document', { referrer, cookie: '' });
}

describe('order attribution from organic Snapchat', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('an untagged link opened in Snapchat is credited to snapchat / social', async () => {
    browser('', SNAP_UA);
    const a = await import('../../apps/web/src/lib/attribution');
    a.captureAttribution();
    expect(a.getCheckoutAttribution()).toMatchObject({ source: 'snapchat', medium: 'social' });
  });

  it('a tagged link keeps its own tags; an ordinary browser with no evidence stays direct', async () => {
    browser('?utm_source=snapchat&utm_medium=social&utm_campaign=story-1', SNAP_UA);
    let a = await import('../../apps/web/src/lib/attribution');
    a.captureAttribution();
    expect(a.getCheckoutAttribution()).toMatchObject({ source: 'snapchat', medium: 'social', campaign: 'story-1' });
    vi.resetModules();
    browser('', 'Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile Safari/537.36');
    a = await import('../../apps/web/src/lib/attribution');
    a.captureAttribution();
    expect(a.getCheckoutAttribution()).toMatchObject({ source: null, medium: null });
  });
});

describe('referrer to source', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it('names networks by whole domain: snapchat, reddit and chatgpt are no longer X', async () => {
    const cases: Array<[string, string, string]> = [
      ['https://story.snapchat.com/s/goldplus', 'snapchat', 'social'],
      ['https://www.reddit.com/r/Uganda', 'reddit.com', 'referral'],
      ['https://chatgpt.com/', 'chatgpt.com', 'referral'],
      ['https://t.co/abc', 'x', 'social'],
      ['https://l.instagram.com/?u=x', 'instagram', 'social'],
      ['https://www.google.co.ug/', 'google', 'organic'],
      ['https://www.bing.com/search?q=x', 'bing', 'organic'],
      ['https://duckduckgo.com/', 'duckduckgo', 'organic'],
      ['https://gemini.google.com/', 'gemini.google.com', 'referral'],
    ];
    for (const [ref, source, medium] of cases) {
      vi.resetModules();
      browser('', 'Mozilla/5.0 Chrome/128', ref);
      const a = await import('../../apps/web/src/lib/attribution');
      a.captureAttribution();
      expect(a.getCheckoutAttribution(), ref).toMatchObject({ source, medium });
      const { classifyChannel } = await import('../../apps/api/src/domain/measurement/Channels');
      const got = a.getCheckoutAttribution()!;
      const want = { snapchat: 'organic_social', x: 'organic_social', instagram: 'organic_social', google: 'organic_search', bing: 'organic_search', duckduckgo: 'organic_search', 'chatgpt.com': 'ai_assistant', 'gemini.google.com': 'ai_assistant', 'reddit.com': 'referral' } as Record<string, string>;
      expect(classifyChannel({ source: got.source, medium: got.medium }), ref).toBe(want[source]);
    }
  });
});

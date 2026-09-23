import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_HOMEPAGE_CONTENT } from '@goldplus/shared';
import {
  ambassadorsRevision,
  portraitRenditions,
  publicAmbassadors,
  readStoredAmbassadors,
  releaseProvenance,
  validateAmbassadorsEdit,
} from '../../apps/api/src/domain/homepage/Ambassadors';
import { HomepageContentService } from '../../apps/api/src/application/homepage/HomepageContentService';
import type { IAmbassadorMedia } from '../../apps/api/src/application/ports/IAmbassadorMedia';

/**
 * Ambassadors & models: real people with GoldPlus products above the footer.
 * Pinned here: nothing reaches the storefront without "published" AND a signed
 * release on file; nothing is invented (no default people); portraits are served
 * as media-library renditions; and the older whole-document homepage editor can
 * never wipe the section.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const img = { assetId: id(99), src: '/uploads/assets/ab/abcdef012345/card.webp', srcset: '/uploads/assets/ab/abcdef012345/card.webp 480w', width: 1200, height: 2000 };
const person = (n: number, over: Record<string, unknown> = {}) => ({ id: id(n), name: `Person ${n}`, role: 'AMBASSADOR', tagline: '', image: img, imageAlt: `Person ${n} with a charger`, productSlug: 'goldplus-charger-gp-c08', releaseOnFile: true, published: true, ...over });

describe('reading the stored section', () => {
  it('a document from before the section existed reads as the default heading and no people', () => {
    expect(readStoredAmbassadors(undefined)).toEqual(DEFAULT_HOMEPAGE_CONTENT.ambassadors);
    expect(DEFAULT_HOMEPAGE_CONTENT.ambassadors.people).toEqual([]); // no stand-in people, ever
  });
  it('drops rows it cannot trust instead of throwing (bad id, no name, off-site image, bad slug)', () => {
    const a = readStoredAmbassadors({ people: [person(1), { ...person(2), id: 'nope' }, { ...person(3), name: '  ' }, { ...person(4), image: { ...img, src: 'https://evil.example/x.jpg' } }, { ...person(5), productSlug: 'Bad Slug!' }] });
    expect(a.people.map((p) => p.id)).toEqual([id(1), id(4), id(5)]);
    expect(a.people[1].image).toBeNull();
    expect(a.people[2].productSlug).toBe('');
  });
  it('the button can only link inside the site', () => {
    expect(readStoredAmbassadors({ ctaHref: 'https://evil.example' }).ctaHref).toBe('/shop');
    expect(readStoredAmbassadors({ ctaHref: '//evil.example' }).ctaHref).toBe('/shop');
    expect(readStoredAmbassadors({ ctaHref: '/shop?category=power' }).ctaHref).toBe('/shop?category=power');
  });
});

describe('what the storefront may see', () => {
  it('only published people with a release on file, a portrait and a description — in order', () => {
    const a = readStoredAmbassadors({ people: [person(1), person(2, { published: false }), person(3, { releaseOnFile: false }), person(4, { image: null }), person(5, { imageAlt: '' }), person(6)] });
    expect(publicAmbassadors(a).people.map((p) => p.id)).toEqual([id(1), id(6)]);
  });
  it('carries only what a card shows — never release provenance, publish flags or media-library ids', () => {
    const pub = publicAmbassadors(readStoredAmbassadors({ people: [person(1, { releaseConfirmedBy: id(50), releaseConfirmedAt: '2026-09-23T10:00:00.000Z' })] }));
    expect(Object.keys(pub.people[0]).sort()).toEqual(['id', 'image', 'imageAlt', 'name', 'productSlug', 'role', 'tagline']);
    expect(Object.keys(pub.people[0].image).sort()).toEqual(['height', 'src', 'srcset', 'width']);
  });
});

describe('release provenance (consent evidence)', () => {
  const at = new Date('2026-09-23T10:00:00.000Z');
  it('is recorded when the box is first ticked, kept while it stays ticked, cleared when unticked', () => {
    const first = releaseProvenance({ releaseOnFile: true }, undefined, id(50), at);
    expect(first).toEqual({ releaseConfirmedBy: id(50), releaseConfirmedAt: '2026-09-23T10:00:00.000Z' });
    const later = releaseProvenance({ releaseOnFile: true }, { releaseOnFile: true, ...first }, id(51), new Date('2026-10-01T00:00:00Z'));
    expect(later).toEqual(first); // another admin re-saving does not rewrite who confirmed
    expect(releaseProvenance({ releaseOnFile: false }, { releaseOnFile: true, ...first }, id(51), at)).toEqual({ releaseConfirmedBy: null, releaseConfirmedAt: null });
  });
});

describe('validating an edit', () => {
  const base = (people: unknown[]) => ({ heading: 'Powered by GoldPlus', people });
  const draft = (n: number, over: Record<string, unknown> = {}) => ({ id: id(n), name: `P${n}`, role: 'MODEL', tagline: '', imageUrl: '/uploads/assets/ab/x/p.jpg', imageAlt: 'P holding a power bank', productSlug: '', releaseOnFile: true, published: true, ...over });

  it('publishing a real person needs a signed release, a photo and a description', () => {
    const { errors } = validateAmbassadorsEdit(base([draft(1, { releaseOnFile: false, imageUrl: '', imageAlt: '' })]));
    expect(errors.map((e) => e.field).sort()).toEqual(['imageAlt', 'imageUrl', 'releaseOnFile']);
    expect(errors.find((e) => e.field === 'releaseOnFile')?.message).toMatch(/signed photo release/);
  });
  it('a draft (not published) may be incomplete', () => {
    expect(validateAmbassadorsEdit(base([draft(1, { published: false, releaseOnFile: false, imageUrl: '', imageAlt: '' })])).errors).toEqual([]);
  });
  it('reports — never silently drops — a missing name, an off-site photo, a bad product and too many people', () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => draft(i + 1));
    expect(validateAmbassadorsEdit(base(tooMany)).errors.some((e) => e.field === 'people')).toBe(true);
    const { errors } = validateAmbassadorsEdit(base([draft(1, { name: '' }), draft(2, { imageUrl: 'https://evil.example/a.jpg' }), draft(3, { productSlug: 'Not A Slug' }), draft(3)]));
    expect(errors.map((e) => `${e.index}:${e.field}`)).toEqual(['0:name', '1:imageUrl', '2:productSlug', '3:id']);
  });
});

describe('portrait renditions', () => {
  it('serves the WebP renditions (card as src), never the multi-megabyte original', () => {
    const r = portraitRenditions({ url: '/o.jpg', width: 3000, height: 5000 }, [
      { purpose: 'pdp', format: 'webp', width: 1024, height: 1707, url: '/pdp.webp' },
      { purpose: 'thumb', format: 'webp', width: 160, height: 267, url: '/thumb.webp' },
      { purpose: 'card', format: 'webp', width: 480, height: 800, url: '/card.webp' },
      { purpose: 'card', format: 'jpeg', width: 480, height: 800, url: '/card.jpg' },
      { purpose: 'zoom', format: 'webp', width: 2048, height: 3413, url: '/zoom.webp' },
    ]);
    expect(r).toEqual({ src: '/card.webp', srcset: '/card.webp 480w, /pdp.webp 1024w, /zoom.webp 2048w', width: 3000, height: 5000 });
  });
  it('falls back to the original only when no rendition exists', () => {
    expect(portraitRenditions({ url: '/o.gif', width: 400, height: 600 }, [])).toEqual({ src: '/o.gif', srcset: null, width: 400, height: 600 });
  });
});

describe('HomepageContentService', () => {
  const repoWith = (config: any) => {
    let stored = { config, version: 3 };
    return {
      repo: {
        getConfig: vi.fn(async () => stored),
        updateConfig: vi.fn(async (c: any) => { stored = { config: c, version: stored.version + 1 }; return stored; }),
        seedMissing: vi.fn(),
      } as any,
      current: () => stored,
    };
  };
  const media = (over: Partial<IAmbassadorMedia> = {}): IAmbassadorMedia & { syncUsages: any } => ({
    resolveByUrl: vi.fn(async (url: string) => (url.includes('missing') ? null : {
      assetId: id(77), status: url.includes('archived') ? 'ARCHIVED' as const : 'ACTIVE' as const,
      original: { url, width: 1200, height: 2000 },
      variants: [{ purpose: 'card', format: 'webp', width: 480, height: 800, url: '/uploads/assets/x/card.webp' }],
    })),
    syncUsages: vi.fn(async () => undefined),
    ...over,
  });

  it('the older whole-document editor can never wipe the people (it does not know the section exists)', async () => {
    const { repo, current } = repoWith({ ...DEFAULT_HOMEPAGE_CONTENT, ambassadors: { ...DEFAULT_HOMEPAGE_CONTENT.ambassadors, people: [person(1)] } });
    const svc = new HomepageContentService(repo, media());
    const { ambassadors: _dropped, ...withoutSection } = DEFAULT_HOMEPAGE_CONTENT;
    await svc.updateConfig({ ...withoutSection, trustItems: DEFAULT_HOMEPAGE_CONTENT.trustItems }, 'actor');
    expect(current().config.ambassadors.people.map((p: any) => p.id)).toEqual([id(1)]);
    // …and even a document that DOES carry the key cannot overwrite them from that editor.
    await svc.updateConfig({ ...DEFAULT_HOMEPAGE_CONTENT, ambassadors: { people: [] } }, 'actor');
    expect(current().config.ambassadors.people).toHaveLength(1);
  });

  it('the public read carries only who may be shown', async () => {
    const { repo } = repoWith({ ...DEFAULT_HOMEPAGE_CONTENT, ambassadors: { ...DEFAULT_HOMEPAGE_CONTENT.ambassadors, people: [person(1), person(2, { releaseOnFile: false })] } });
    const pub = await new HomepageContentService(repo).getPublicConfig();
    expect(pub.ambassadors.people.map((p) => p.id)).toEqual([id(1)]);
  });

  it('saves resolved renditions and records the usages; nothing is saved when a photo is not in the library', async () => {
    const { repo, current } = repoWith(DEFAULT_HOMEPAGE_CONTENT);
    const m = media();
    const svc = new HomepageContentService(repo, m);
    const ok = await svc.updateAmbassadors({ heading: 'Powered by GoldPlus', people: [{ id: id(1), name: 'Grace', role: 'AMBASSADOR', tagline: '', imageUrl: '/uploads/assets/x/grace.jpg', imageAlt: 'Grace holding a power bank', productSlug: '', releaseOnFile: true, published: true }] }, 'actor');
    expect(ok).toMatchObject({ ok: true });
    expect(current().config.ambassadors.people[0].image).toMatchObject({ assetId: id(77), src: '/uploads/assets/x/card.webp' });
    expect(m.syncUsages).toHaveBeenCalledWith([{ personId: id(1), assetId: id(77) }]);

    const before = current().version;
    const bad = await svc.updateAmbassadors({ people: [
      { id: id(2), name: 'Moses', role: 'MODEL', tagline: '', imageUrl: '/uploads/assets/missing.jpg', imageAlt: 'x', productSlug: '', releaseOnFile: true, published: true },
      { id: id(3), name: 'Amina', role: 'MODEL', tagline: '', imageUrl: '/uploads/assets/archived.jpg', imageAlt: 'x', productSlug: '', releaseOnFile: true, published: true },
    ] }, 'actor');
    expect(bad).toMatchObject({ ok: false });
    expect((bad as any).errors.map((e: any) => `${e.index}:${e.field}`)).toEqual(['0:imageUrl', '1:imageUrl']);
    expect(current().version).toBe(before); // all-or-nothing
  });
});

describe('HomepageContentService — consent and concurrency', () => {
  const setup = (people: any[] = []) => {
    let stored = { config: { ...DEFAULT_HOMEPAGE_CONTENT, ambassadors: { ...DEFAULT_HOMEPAGE_CONTENT.ambassadors, people } }, version: 5 };
    const repo = { getConfig: vi.fn(async () => stored), updateConfig: vi.fn(async (c: any) => { stored = { config: c, version: stored.version + 1 }; return stored; }), seedMissing: vi.fn() } as any;
    const m: IAmbassadorMedia = { resolveByUrl: vi.fn(async (url: string) => ({ assetId: id(77), status: 'ACTIVE' as const, original: { url, width: 1200, height: 2000 }, variants: [] })), syncUsages: vi.fn(async () => undefined) };
    return { svc: new HomepageContentService(repo, m), current: () => stored };
  };
  const edit = (over: Record<string, unknown> = {}) => ({ id: id(1), name: 'Grace', role: 'AMBASSADOR', tagline: '', imageUrl: '/uploads/g.jpg', imageAlt: 'Grace with a power bank', productSlug: '', releaseOnFile: true, published: true, ...over });

  it('records who confirmed the release and when — from the session, never from the request', async () => {
    const { svc, current } = setup();
    const r = await svc.updateAmbassadors({ people: [{ ...edit(), releaseConfirmedBy: id(66), releaseConfirmedAt: '2020-01-01T00:00:00.000Z' }] }, id(50), undefined, new Date('2026-09-23T10:00:00.000Z'));
    expect(r).toMatchObject({ ok: true, releasesConfirmed: [id(1)], releasesWithdrawn: [] });
    expect(current().config.ambassadors.people[0]).toMatchObject({ releaseConfirmedBy: id(50), releaseConfirmedAt: '2026-09-23T10:00:00.000Z' });
  });

  it('a stale editor saves nothing; a trust-strip save in the other editor is NOT a conflict', async () => {
    const { svc, current } = setup([person(1)]);
    const { revision } = await svc.getAmbassadorsAdmin();
    await svc.updateConfig({ ...DEFAULT_HOMEPAGE_CONTENT, trustItems: [{ iconKey: 'shield', title: 'Changed', body: 'Changed body' }] }, 'actor');
    expect((await svc.getAmbassadorsAdmin()).revision).toBe(revision);
    expect(await svc.updateAmbassadors({ people: [edit()] }, id(50), revision)).toMatchObject({ ok: true });
    const v = current().version;
    const stale = await svc.updateAmbassadors({ people: [edit({ name: 'Someone else' })] }, id(51), revision);
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect(current().version).toBe(v);
    expect(ambassadorsRevision(readStoredAmbassadors(current().config.ambassadors))).not.toBe(revision);
  });
});

describe('placement', () => {
  it('the section is the last thing on the home page before the footer', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/pages/index.astro'), 'utf8');
    const rail = src.indexOf('<AmbassadorsRail');
    expect(rail).toBeGreaterThan(src.indexOf('Business pathways'));
    expect(src.slice(rail, src.indexOf('</BaseLayout>'))).not.toMatch(/<section|<[A-Z]\w+Rail\b(?!\s*section=\{homepageContent\.ambassadors)/);
  });
});

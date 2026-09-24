import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_HOMEPAGE_CONTENT, HOME_AMBASSADORS_MAX } from '@goldplus/shared';
import {
  ambassadorsRevision,
  portraitRenditions,
  publicAmbassadors,
  readStoredAmbassadors,
  releaseProvenance,
  validateAmbassadorsEdit,
} from '../../apps/api/src/domain/homepage/Ambassadors';
import { isSafeLinkHref, isSitePath } from '../../apps/api/src/domain/homepage/Links';
import { HomepageContentService } from '../../apps/api/src/application/homepage/HomepageContentService';
import type { IAmbassadorMedia } from '../../apps/api/src/application/ports/IAmbassadorMedia';
import { isBlankNewRow, mergeAfterConflict, orderRows, readRow, type AmbassadorRow } from '../../apps/web/src/lib/ambassadorsForm';

/**
 * Ambassadors & models: real people with GoldPlus products above the footer.
 * Pinned here: nothing reaches the storefront without "published" AND a signed
 * release on file; nothing is invented (no default people); portraits are served
 * as media-library renditions; neither editor can wipe or resurrect people it did
 * not mean to; and the consent record is true to the person, not the row.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const img = { assetId: id(99), src: '/uploads/assets/ab/abcdef012345/card.webp', srcset: '/uploads/assets/ab/abcdef012345/card.webp 480w, /uploads/assets/ab/abcdef012345/pdp.webp 1024w', width: 1200, height: 2000 };
const person = (n: number, over: Record<string, unknown> = {}) => ({ id: id(n), name: `Person ${n}`, role: 'AMBASSADOR', tagline: '', image: img, imageAlt: `Person ${n} with a charger`, productSlug: 'goldplus-charger-gp-c08', releaseOnFile: true, releaseConfirmedBy: id(40), releaseConfirmedAt: '2026-09-01T09:00:00.000Z', published: true, ...over });
/** What Postgres JSONB hands back: the same data, keys in a different order. */
const jsonbOrder = (v: any): any => (Array.isArray(v) ? v.map(jsonbOrder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().reverse().map((k) => [k, jsonbOrder(v[k])])) : v);

describe('links a person can type (every homepage href)', () => {
  it('a site path must stay on this site however a browser parses it', () => {
    for (const ok of ['/shop', '/shop?category=power', '/products/gp-c08#specs']) expect(isSitePath(ok), ok).toBe(true);
    for (const bad of ['//evil.example', '/\\evil.example', '/\\/evil.example', '/\t/evil.example', '/ evil', '/\u0000x', 'shop', 'https://evil.example']) expect(isSitePath(bad), JSON.stringify(bad)).toBe(false);
  });
  it('a link may also be https, mailto or tel — never javascript:, data: or a protocol-relative trick', () => {
    for (const ok of ['/faq', '#top', 'https://www.tenxafrica.com', 'http://example.com/x', 'mailto:hello@shopgoldplus.com', 'tel:+256700000000']) expect(isSafeLinkHref(ok), ok).toBe(true);
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example', '/\\evil.example', '#', '', 'https://']) expect(isSafeLinkHref(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('reading the stored section', () => {
  it('a document from before the section existed reads as the default heading and no people', () => {
    expect(readStoredAmbassadors(undefined)).toEqual(DEFAULT_HOMEPAGE_CONTENT.ambassadors);
    expect(DEFAULT_HOMEPAGE_CONTENT.ambassadors.people).toEqual([]); // no stand-in people, ever
  });
  it('never throws on garbage, and caps the list', () => {
    expect(readStoredAmbassadors('x').people).toEqual([]);
    expect(readStoredAmbassadors({ people: {} }).people).toEqual([]);
    const many = Array.from({ length: HOME_AMBASSADORS_MAX + 3 }, (_, i) => person(i + 1));
    expect(readStoredAmbassadors({ people: many }).people).toHaveLength(HOME_AMBASSADORS_MAX);
  });
  it('drops rows it cannot trust instead of throwing (bad id, no name, off-site image, bad slug)', () => {
    const a = readStoredAmbassadors({ people: [person(1), { ...person(2), id: 'nope' }, { ...person(3), name: '  ' }, { ...person(4), image: { ...img, src: 'https://evil.example/x.jpg' } }, { ...person(5), productSlug: 'Bad Slug!' }] });
    expect(a.people.map((p) => p.id)).toEqual([id(1), id(4), id(5)]);
    expect(a.people[1].image).toBeNull();
    expect(a.people[2].productSlug).toBe('');
  });
  it('keeps release provenance only for a ticked release with well-formed values', () => {
    const [kept, untick, junk] = readStoredAmbassadors({ people: [person(1), person(2, { releaseOnFile: false }), person(3, { releaseConfirmedBy: 'admin', releaseConfirmedAt: 'yesterday' })] }).people;
    expect(kept).toMatchObject({ releaseConfirmedBy: id(40), releaseConfirmedAt: '2026-09-01T09:00:00.000Z' });
    expect(untick).toMatchObject({ releaseConfirmedBy: null, releaseConfirmedAt: null });
    expect(junk).toMatchObject({ releaseConfirmedBy: null, releaseConfirmedAt: null });
  });
  it('the button can only link inside the site', () => {
    expect(readStoredAmbassadors({ ctaHref: 'https://evil.example' }).ctaHref).toBe('/shop');
    expect(readStoredAmbassadors({ ctaHref: '//evil.example' }).ctaHref).toBe('/shop');
    expect(readStoredAmbassadors({ ctaHref: '/\\evil.example' }).ctaHref).toBe('/shop');
    expect(readStoredAmbassadors({ ctaHref: '/shop?category=power' }).ctaHref).toBe('/shop?category=power');
  });
  it('the revision is the same however JSONB orders the keys (no false "someone else saved")', () => {
    const doc = { heading: 'Powered by GoldPlus', intro: '', ctaLabel: 'Shop all products', ctaHref: '/shop', people: [person(1), person(2)] };
    expect(ambassadorsRevision(readStoredAmbassadors(jsonbOrder(doc)))).toBe(ambassadorsRevision(readStoredAmbassadors(doc)));
  });
});

describe('what the storefront may see', () => {
  it('only published people with a release on file, a portrait and a description — in order', () => {
    const a = readStoredAmbassadors({ people: [person(1), person(2, { published: false }), person(3, { releaseOnFile: false }), person(4, { image: null }), person(5, { imageAlt: '' }), person(6)] });
    expect(publicAmbassadors(a).people.map((p) => p.id)).toEqual([id(1), id(6)]);
  });
  it('carries only what a card shows — never release provenance, publish flags or media-library ids', () => {
    const pub = publicAmbassadors(readStoredAmbassadors({ people: [person(1)] }));
    expect(Object.keys(pub.people[0]).sort()).toEqual(['id', 'image', 'imageAlt', 'name', 'productSlug', 'role', 'tagline']);
    expect(Object.keys(pub.people[0].image).sort()).toEqual(['height', 'src', 'srcset', 'width']);
  });
});

describe('release provenance (consent evidence)', () => {
  const at = new Date('2026-09-23T10:00:00.000Z');
  const grace = { releaseOnFile: true, name: 'Grace Nakato', assetId: id(77) };
  const stored = (over: Record<string, unknown> = {}) => ({ releaseOnFile: true, releaseConfirmedBy: id(50), releaseConfirmedAt: '2026-09-01T09:00:00.000Z', name: 'Grace Nakato', image: { assetId: id(77) }, ...over });
  it('is recorded when the box is first ticked, kept while it stays ticked, cleared when unticked', () => {
    expect(releaseProvenance(grace, undefined, id(50), at)).toEqual({ releaseConfirmedBy: id(50), releaseConfirmedAt: '2026-09-23T10:00:00.000Z' });
    // Another admin re-saving does not rewrite who confirmed — nor does tidying the name's spacing or case.
    expect(releaseProvenance({ ...grace, name: ' grace  nakato ' }, stored(), id(51), at)).toEqual({ releaseConfirmedBy: id(50), releaseConfirmedAt: '2026-09-01T09:00:00.000Z' });
    expect(releaseProvenance({ ...grace, releaseOnFile: false }, stored(), id(51), at)).toEqual({ releaseConfirmedBy: null, releaseConfirmedAt: null });
  });
  it('belongs to the PERSON: a row rewritten for someone else, or given another photo, is a new confirmation', () => {
    expect(releaseProvenance({ ...grace, name: 'Brian Okello' }, stored(), id(51), at)).toEqual({ releaseConfirmedBy: id(51), releaseConfirmedAt: '2026-09-23T10:00:00.000Z' });
    expect(releaseProvenance({ ...grace, assetId: id(78) }, stored(), id(51), at)).toEqual({ releaseConfirmedBy: id(51), releaseConfirmedAt: '2026-09-23T10:00:00.000Z' });
  });
});

describe('validating an edit', () => {
  const base = (people: unknown) => ({ heading: 'Powered by GoldPlus', people });
  const draft = (n: number, over: Record<string, unknown> = {}) => ({ id: id(n), name: `P${n}`, role: 'MODEL', tagline: '', imageUrl: '/uploads/assets/ab/x/p.jpg', imageAlt: 'P holding a power bank', productSlug: '', releaseOnFile: true, published: true, ...over });

  it('publishing a real person needs a signed release, a photo and a description', () => {
    const { errors } = validateAmbassadorsEdit(base([draft(1, { releaseOnFile: false, imageUrl: '', imageAlt: '' })]));
    expect(errors.map((e) => e.field).sort()).toEqual(['imageAlt', 'imageUrl', 'releaseOnFile']);
    expect(errors.find((e) => e.field === 'releaseOnFile')?.message).toMatch(/signed photo release/);
  });
  it('a draft (not published) may be incomplete', () => {
    expect(validateAmbassadorsEdit(base([draft(1, { published: false, releaseOnFile: false, imageUrl: '', imageAlt: '' })])).errors).toEqual([]);
  });
  it('a missing list of people is refused, never read as "remove everyone"', () => {
    for (const people of [undefined, {}, 'x']) {
      expect(validateAmbassadorsEdit(base(people)).errors).toContainEqual(expect.objectContaining({ index: -1, field: 'people' }));
    }
    expect(validateAmbassadorsEdit(base([])).errors).toEqual([]); // an explicit empty list is a real choice
  });
  it('reports — never silently drops — a missing name, an off-site photo, a bad product and too many people', () => {
    const tooMany = Array.from({ length: 13 }, (_, i) => draft(i + 1));
    expect(validateAmbassadorsEdit(base(tooMany)).errors.some((e) => e.field === 'people')).toBe(true);
    const { errors } = validateAmbassadorsEdit(base([draft(1, { name: '' }), draft(2, { imageUrl: 'https://evil.example/a.jpg' }), draft(3, { productSlug: 'Not A Slug' }), draft(3), draft(4, { imageUrl: '/\\evil.example/a.jpg' })]));
    expect(errors.map((e) => `${e.index}:${e.field}`)).toEqual(['0:name', '1:imageUrl', '2:productSlug', '3:id', '4:imageUrl']);
  });
  it('the button link must be a page on this site', () => {
    for (const bad of ['/\\evil.example', '//evil.example', 'javascript:alert(1)']) {
      expect(validateAmbassadorsEdit({ ...base([]), ctaHref: bad }).errors, bad).toContainEqual(expect.objectContaining({ index: -1, field: 'ctaHref' }));
    }
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
    // No 2048 zoom: a card is never shown wider than ~950 device px, and every URL costs home-page bytes.
    expect(r).toEqual({ src: '/card.webp', srcset: '/card.webp 480w, /pdp.webp 1024w', width: 3000, height: 5000 });
  });
  it('falls back to the original only when no rendition exists', () => {
    expect(portraitRenditions({ url: '/o.gif', width: 400, height: 600 }, [])).toEqual({ src: '/o.gif', srcset: null, width: 400, height: 600 });
  });
});

/** A repository that behaves like the real one: JSONB key order on read, compare-and-swap on version. */
function fakeRepo(config: any, version = 5) {
  let stored = { config: JSON.parse(JSON.stringify(config)), version, updatedAt: new Date() };
  let beforeWrite: (() => void) | null = null;
  const write = (c: any) => { stored = { config: JSON.parse(JSON.stringify(c)), version: stored.version + 1, updatedAt: new Date() }; return { ...stored, config: jsonbOrder(stored.config) }; };
  const repo = {
    getConfig: vi.fn(async () => ({ ...stored, config: jsonbOrder(stored.config) })),
    updateConfig: vi.fn(async (c: any) => write(c)),
    replaceIfVersion: vi.fn(async (c: any, _actor: string, expected: number) => {
      if (beforeWrite) { const hook = beforeWrite; beforeWrite = null; hook(); }
      return stored.version === expected ? write(c) : null;
    }),
    seedMissing: vi.fn(),
  };
  return {
    repo: repo as any,
    current: () => stored,
    /** Simulate another save landing between this save's read and its write. */
    interleave: (other: (cfg: any) => any) => { beforeWrite = () => { write(other(JSON.parse(JSON.stringify(stored.config)))); }; },
  };
}
const docWith = (people: any[]) => ({ ...DEFAULT_HOMEPAGE_CONTENT, ambassadors: { ...DEFAULT_HOMEPAGE_CONTENT.ambassadors, people } });
function fakeMedia(over: Partial<IAmbassadorMedia> = {}) {
  const calls: string[] = [];
  const m = {
    resolveByUrl: vi.fn(async (url: string) => (url.includes('missing') ? null : {
      assetId: url.includes('other') ? id(78) : id(77), status: url.includes('archived') ? ('ARCHIVED' as const) : ('ACTIVE' as const),
      original: { url, width: 1200, height: 2000 },
      variants: [{ purpose: 'card', format: 'webp', width: 480, height: 800, url: '/uploads/assets/x/card.webp' }],
    })),
    protect: vi.fn(async () => { calls.push('protect'); }),
    syncUsages: vi.fn(async () => { calls.push('sync'); }),
    ...over,
  };
  return { m, calls };
}
const edit = (over: Record<string, unknown> = {}) => ({ id: id(1), name: 'Grace', role: 'AMBASSADOR', tagline: '', imageUrl: '/uploads/g.jpg', imageAlt: 'Grace with a power bank', productSlug: '', releaseOnFile: true, published: true, ...over });
const AT = new Date('2026-09-23T10:00:00.000Z');

describe('HomepageContentService — the two editors', () => {
  it('the older whole-document editor can never wipe the people (it does not know the section exists)', async () => {
    const { repo, current } = fakeRepo(docWith([person(1)]));
    const svc = new HomepageContentService(repo, fakeMedia().m);
    const { ambassadors: _dropped, ...withoutSection } = DEFAULT_HOMEPAGE_CONTENT;
    await svc.updateConfig({ ...withoutSection, trustItems: DEFAULT_HOMEPAGE_CONTENT.trustItems }, 'actor');
    expect(current().config.ambassadors.people.map((p: any) => p.id)).toEqual([id(1)]);
    await svc.updateConfig({ ...DEFAULT_HOMEPAGE_CONTENT, ambassadors: { people: [] } }, 'actor');
    expect(current().config.ambassadors.people).toHaveLength(1);
  });

  it('a whole-document save in flight cannot bring back a person whose release was just withdrawn', async () => {
    const { repo, current, interleave } = fakeRepo(docWith([person(1)]));
    const svc = new HomepageContentService(repo, fakeMedia().m);
    // The ambassadors editor withdraws Grace's release between the footer save's read and its write.
    interleave((cfg) => ({ ...cfg, ambassadors: { ...cfg.ambassadors, people: [{ ...cfg.ambassadors.people[0], releaseOnFile: false, published: false }] } }));
    await svc.updateConfig({ ...DEFAULT_HOMEPAGE_CONTENT, trustItems: [{ iconKey: 'shield', title: 'New', body: 'New body' }] }, 'actor');
    expect(current().config.trustItems[0].title).toBe('New');
    expect(current().config.ambassadors.people[0]).toMatchObject({ releaseOnFile: false, published: false });
  });

  it('refuses javascript: and backslash hrefs in pathway cards and footer links (they would run for whoever clicks)', async () => {
    const { repo, current } = fakeRepo(DEFAULT_HOMEPAGE_CONTENT);
    const svc = new HomepageContentService(repo);
    const cards = [{ title: 'Evil', body: 'x', ctaLabel: 'Go', href: 'javascript:alert(1)' }, { title: 'Good', body: 'y', ctaLabel: 'Go', href: '/shop' }];
    const footer = {
      ...DEFAULT_HOMEPAGE_CONTENT.footer,
      columns: [{ heading: 'Shop', links: [{ label: 'Evil', href: '/\\evil.example' }, { label: 'Deals', href: '/shop' }] }],
      legalLinks: [{ label: 'Terms', href: 'data:text/html,x' }, { label: 'Privacy', href: '/privacy' }],
      attribution: { label: 'Site by', href: 'javascript:alert(1)' },
    };
    await svc.updateConfig({ ...DEFAULT_HOMEPAGE_CONTENT, pathwayCards: cards, footer }, 'actor');
    const c = current().config;
    expect(c.pathwayCards.map((x: any) => x.href)).toEqual(['/shop']);
    expect(c.footer.columns[0].links.map((l: any) => l.href)).toEqual(['/shop']);
    expect(c.footer.legalLinks.map((l: any) => l.href)).toEqual(['/privacy']);
    expect(c.footer.attribution).toEqual(DEFAULT_HOMEPAGE_CONTENT.footer.attribution);
    expect(DEFAULT_HOMEPAGE_CONTENT.footer.attribution.href).toBe('https://www.tenxafrica.com'); // the real external link still passes
  });

  it('the public read carries only who may be shown', async () => {
    const { repo } = fakeRepo(docWith([person(1), person(2, { releaseOnFile: false })]));
    const pub = await new HomepageContentService(repo).getPublicConfig();
    expect(pub.ambassadors.people.map((p) => p.id)).toEqual([id(1)]);
  });
});

describe('HomepageContentService — saving the section', () => {
  const setup = (people: any[] = [], media = fakeMedia()) => {
    const r = fakeRepo(docWith(people));
    return { ...r, ...media, svc: new HomepageContentService(r.repo, media.m) };
  };

  it('a save that does not name the version it replaces saves nothing (e.g. from an editor whose load failed)', async () => {
    const { svc, current, m } = setup([person(1), person(2)]);
    const r = await svc.updateAmbassadors({ people: [edit({ id: id(3) })] }, id(50), undefined);
    expect(r).toMatchObject({ ok: false, conflict: true });
    expect(current().config.ambassadors.people).toHaveLength(2);
    expect(m.protect).not.toHaveBeenCalled();
    expect(m.syncUsages).not.toHaveBeenCalled();
  });

  it('saves resolved renditions; protects the portraits BEFORE the write and syncs after', async () => {
    const { svc, current, m, calls } = setup();
    const { revision } = await svc.getAmbassadorsAdmin();
    const ok = await svc.updateAmbassadors({ people: [edit()] }, id(50), revision, AT);
    expect(ok).toMatchObject({ ok: true });
    expect(current().config.ambassadors.people[0].image).toMatchObject({ assetId: id(77), src: '/uploads/assets/x/card.webp' });
    expect(m.protect).toHaveBeenCalledWith([{ personId: id(1), assetId: id(77) }]);
    expect(calls).toEqual(['protect', 'sync']);
  });

  it('nothing is saved when a NEWLY chosen photo is not in the library or is archived', async () => {
    const { svc, current, m } = setup();
    const { revision } = await svc.getAmbassadorsAdmin();
    const before = current().version;
    const bad = await svc.updateAmbassadors({ people: [edit({ id: id(2), imageUrl: '/uploads/missing.jpg' }), edit({ id: id(3), imageUrl: '/uploads/archived.jpg' })] }, id(50), revision);
    expect((bad as any).errors.map((e: any) => `${e.index}:${e.field}`)).toEqual(['0:imageUrl', '1:imageUrl']);
    expect(current().version).toBe(before);
    expect(m.protect).not.toHaveBeenCalled();
    expect(m.syncUsages).not.toHaveBeenCalled();
  });

  it('a photo archived AFTER it went live never blocks unpublishing or withdrawing a release', async () => {
    const archivedLive = { ...img, src: '/uploads/assets/archived/card.webp', srcset: '/uploads/assets/archived/card.webp 480w' };
    const { svc, current, m } = setup([person(1, { image: archivedLive }), person(2)]);
    const { revision } = await svc.getAmbassadorsAdmin();
    const r = await svc.updateAmbassadors({ people: [
      edit({ id: id(1), name: 'Person 1', imageUrl: archivedLive.src, imageAlt: 'Person 1 with a charger', releaseOnFile: false, published: false }),
      edit({ id: id(2), name: 'Person 2', imageUrl: img.src, imageAlt: 'Person 2 with a charger' }),
    ] }, id(50), revision, AT);
    expect(r).toMatchObject({ ok: true });
    expect(m.resolveByUrl).not.toHaveBeenCalled(); // both photos are the ones already on the entries
    expect(current().config.ambassadors.people[0]).toMatchObject({ published: false, releaseOnFile: false, image: { src: archivedLive.src } });
  });

  it('the audit names who: releases confirmed and withdrawn, who went live or left, and who was removed', async () => {
    const { svc } = setup([person(1, { name: 'Grace' }), person(2, { name: 'Brian' }), person(3, { name: 'Joan' })]);
    const { revision } = await svc.getAmbassadorsAdmin();
    const r: any = await svc.updateAmbassadors({ people: [
      edit({ id: id(1), name: 'Grace', imageUrl: img.src, imageAlt: 'Grace with a power bank', releaseOnFile: false, published: false }),
      edit({ id: id(2), name: 'Brian', imageUrl: img.src, imageAlt: 'Brian with a charger' }),
      edit({ id: id(4), name: 'Esther', imageUrl: '/uploads/e.jpg', imageAlt: 'Esther with a cable' }),
    ] }, id(50), revision, AT);
    expect(r.ok).toBe(true);
    expect(r.changes.releasesWithdrawn).toEqual([{ id: id(1), name: 'Grace' }]);
    expect(r.changes.releasesConfirmed).toEqual([{ id: id(4), name: 'Esther' }]); // Brian's stays as first confirmed
    expect(r.changes.leftLive).toEqual([{ id: id(1), name: 'Grace' }]);
    expect(r.changes.wentLive).toEqual([{ id: id(4), name: 'Esther' }]);
    expect(r.changes.removed).toEqual([{ id: id(3), name: 'Joan', live: true, releaseOnFile: true, releaseConfirmedBy: id(40), releaseConfirmedAt: '2026-09-01T09:00:00.000Z' }]);
    expect(r.previous.map((p: any) => p.name)).toEqual(['Grace', 'Brian', 'Joan']);
  });

  it('reusing a row for a different person is a NEW release confirmation, recorded to the saver', async () => {
    const { svc, current } = setup([person(1, { name: 'Grace' })]);
    const { revision } = await svc.getAmbassadorsAdmin();
    const r: any = await svc.updateAmbassadors({ people: [edit({ id: id(1), name: 'Brian Okello', imageUrl: '/uploads/other.jpg', imageAlt: 'Brian with a charger' })] }, id(51), revision, AT);
    expect(r.changes.releasesConfirmed).toEqual([{ id: id(1), name: 'Brian Okello' }]);
    expect(current().config.ambassadors.people[0]).toMatchObject({ releaseConfirmedBy: id(51), releaseConfirmedAt: '2026-09-23T10:00:00.000Z' });
  });

  it('usages follow the people: reduced on removal, cleared when everyone goes', async () => {
    const { svc, m } = setup([person(1), person(2)]);
    let { revision } = await svc.getAmbassadorsAdmin();
    await svc.updateAmbassadors({ people: [edit({ id: id(1), name: 'Person 1', imageUrl: img.src, imageAlt: 'x' })] }, id(50), revision, AT);
    expect(m.syncUsages).toHaveBeenLastCalledWith([{ personId: id(1), assetId: id(99) }]);
    ({ revision } = await svc.getAmbassadorsAdmin());
    await svc.updateAmbassadors({ people: [] }, id(50), revision, AT);
    expect(m.syncUsages).toHaveBeenLastCalledWith([]);
  });

  it('a failed usage clean-up after the save does not report a live save as failed', async () => {
    const media = fakeMedia({ syncUsages: vi.fn(async () => { throw new Error('db blip'); }) });
    const { svc, current } = setup([], media);
    const { revision } = await svc.getAmbassadorsAdmin();
    const r = await svc.updateAmbassadors({ people: [edit()] }, id(50), revision, AT);
    expect(r).toMatchObject({ ok: true, usagesPending: true });
    expect(current().config.ambassadors.people).toHaveLength(1);
    expect(media.m.protect).toHaveBeenCalled(); // the new portrait was protected before it went live
  });

  it('a stale editor saves nothing; a trust-strip save in the other editor is NOT a conflict', async () => {
    const { svc, current } = setup([person(1)]);
    const { revision } = await svc.getAmbassadorsAdmin();
    await svc.updateConfig({ ...DEFAULT_HOMEPAGE_CONTENT, trustItems: [{ iconKey: 'shield', title: 'Changed', body: 'Changed body' }] }, 'actor');
    expect((await svc.getAmbassadorsAdmin()).revision).toBe(revision);
    expect(await svc.updateAmbassadors({ people: [edit()] }, id(50), revision, AT)).toMatchObject({ ok: true });
    const v = current().version;
    const stale = await svc.updateAmbassadors({ people: [edit({ name: 'Someone else' })] }, id(51), revision, AT);
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect(current().version).toBe(v);
  });

  it('two saves racing: another section changing mid-save is retried; this section changing is a conflict', async () => {
    const a = setup([person(1)]);
    let { revision } = await a.svc.getAmbassadorsAdmin();
    a.interleave((cfg) => ({ ...cfg, trustItems: [{ iconKey: 'shield', title: 'Theirs', body: 'Theirs body' }] }));
    expect(await a.svc.updateAmbassadors({ people: [edit()] }, id(50), revision, AT)).toMatchObject({ ok: true });
    expect(a.current().config.trustItems[0].title).toBe('Theirs'); // their trust strip survives

    const b = setup([person(1)]);
    ({ revision } = await b.svc.getAmbassadorsAdmin());
    b.interleave((cfg) => ({ ...cfg, ambassadors: { ...cfg.ambassadors, people: [] } }));
    const r = await b.svc.updateAmbassadors({ people: [edit()] }, id(50), revision, AT);
    expect(r).toMatchObject({ ok: false, conflict: true });
    expect(b.current().config.ambassadors.people).toEqual([]); // theirs stands
  });
});

describe('the editor form (apps/web/src/lib/ambassadorsForm.ts)', () => {
  const row = (n: number, over: Partial<AmbassadorRow> = {}): AmbassadorRow => ({
    id: id(n), isNew: false, name: `P${n}`, role: 'AMBASSADOR', tagline: '', imageUrl: '', imageAlt: '', productSlug: '', releaseOnFile: false, published: false,
    position: n, was: n, preview: null, releaseConfirmedAt: null, releaseConfirmedBy: null, remove: false, ...over,
  });
  const eight = () => Array.from({ length: 8 }, (_, i) => row(i + 1));
  const order = (rows: AmbassadorRow[]) => orderRows(rows).map((r) => r.name).join(',');

  it('typing a position puts the person exactly there', () => {
    const move = (n: number, to: number) => eight().map((r) => (r.was === n ? { ...r, position: to } : r));
    expect(order(move(8, 1))).toBe('P8,P1,P2,P3,P4,P5,P6,P7');
    expect(order(move(1, 8))).toBe('P2,P3,P4,P5,P6,P7,P8,P1');
    expect(order(move(2, 5))).toBe('P1,P3,P4,P5,P2,P6,P7,P8');
    expect(order(move(5, 2))).toBe('P1,P5,P2,P3,P4,P6,P7,P8');
    expect(order(move(3, 40))).toBe('P1,P2,P4,P5,P6,P7,P8,P3');
    const swap = eight().map((r) => (r.was === 1 ? { ...r, position: 2 } : r.was === 2 ? { ...r, position: 1 } : r));
    expect(order(swap)).toBe('P2,P1,P3,P4,P5,P6,P7,P8');
    expect(orderRows(eight()).map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('the "Add a person" row counts as blank only when EVERYTHING is empty', () => {
    const fresh = row(9, { id: '', isNew: true, name: '' });
    expect(isBlankNewRow(fresh, false)).toBe(true);
    expect(isBlankNewRow({ ...fresh, role: 'MODEL' }, false)).toBe(true); // the select always has a value
    for (const over of [{ imageAlt: 'x' }, { productSlug: 'gp-c08' }, { releaseOnFile: true }, { published: true }, { tagline: 'x' }]) expect(isBlankNewRow({ ...fresh, ...over }, false)).toBe(false);
    expect(isBlankNewRow(fresh, true)).toBe(false);
    // A new person whose first save failed can still be abandoned by clearing it.
    expect(isBlankNewRow({ ...fresh, id: id(9) }, false)).toBe(true);
    expect(isBlankNewRow(row(1, { name: '' }), false)).toBe(false); // a saved person is never "blank"
  });

  it('reads a posted row: mints an id for a new one, keeps the drawn position', () => {
    const form = new FormData();
    form.set('p.0.id', ''); form.set('p.0.name', ' Esther '); form.set('p.0.was', '9'); form.set('p.0.releaseOnFile', 'on');
    const { row: r, photo } = readRow(form, 0, () => id(9));
    expect(r).toMatchObject({ id: id(9), isNew: true, name: 'Esther', was: 9, position: 9, releaseOnFile: true, published: false, remove: false });
    expect(photo).toBeNull();
  });

  it('after a conflict, saving again can never undo their withdrawal, unpublish or removal — and keeps their additions', () => {
    const mine = [row(1, { name: 'Grace', releaseOnFile: true, published: true }), row(2, { name: 'Brian', published: true, releaseOnFile: true }), row(3, { name: 'Joan', releaseOnFile: true, published: true, tagline: 'my edit' })];
    const theirs = [
      { id: id(1), name: 'Grace', role: 'AMBASSADOR', tagline: '', image: null, imageAlt: '', productSlug: '', releaseOnFile: false, releaseConfirmedAt: null, releaseConfirmedBy: null, published: false },
      { id: id(2), name: 'Brian', role: 'AMBASSADOR', tagline: '', image: null, imageAlt: '', productSlug: '', releaseOnFile: true, releaseConfirmedAt: '2026-09-01T09:00:00.000Z', releaseConfirmedBy: id(40), published: false },
      { id: id(4), name: 'Ivan', role: 'MODEL', tagline: '', image: { src: '/i.webp' }, imageAlt: 'Ivan', productSlug: '', releaseOnFile: true, releaseConfirmedAt: '2026-09-02T09:00:00.000Z', releaseConfirmedBy: id(40), published: true },
    ];
    const { rows, changes } = mergeAfterConflict(mine, theirs);
    expect(rows.find((r) => r.name === 'Grace')).toMatchObject({ releaseOnFile: false, published: false });
    expect(rows.find((r) => r.name === 'Brian')).toMatchObject({ published: false, releaseOnFile: true, releaseConfirmedBy: id(40) });
    expect(rows.find((r) => r.name === 'Joan')).toMatchObject({ isNew: true, releaseOnFile: false, published: false, tagline: 'my edit' });
    expect(rows.find((r) => r.name === 'Ivan')).toMatchObject({ isNew: false, published: true, releaseOnFile: true });
    expect(changes).toHaveLength(4);
    expect(changes.join(' ')).toMatch(/Grace: the signed release was withdrawn/);
    expect(mergeAfterConflict([row(1)], [{ id: id(1), name: 'P1', role: 'AMBASSADOR', tagline: '', image: null, imageAlt: '', productSlug: '', releaseOnFile: false, releaseConfirmedAt: null, releaseConfirmedBy: null, published: false }]).changes).toEqual([]);
  });
});

describe('the editor page (source contracts)', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/pages/admin/homepage/ambassadors.astro'), 'utf8');
  it('draws the form only over a section that loaded, and always sends the revision', () => {
    expect(page).toMatch(/\{rows && \(\s*<form/);
    expect(page).toMatch(/expectedRevision: revision/);
    expect(page).not.toMatch(/DEFAULT_HOMEPAGE_CONTENT/); // no default stand-in to edit after a failed load
  });
  it('a missing permission is explained, never a sign-in loop', () => {
    expect(page).not.toMatch(/=== 403\)\s*return Astro\.redirect/);
    expect(page).not.toMatch(/401 \|\| res\.status === 403/);
  });
  it('never tells every viewer they confirmed a release', () => {
    expect(page).not.toMatch(/recorded with your account/);
  });
  it('ties each field error to its control and lists them at the top', () => {
    expect(page).toMatch(/'aria-describedby'/);
    expect(page).toMatch(/id=\{notice\.kind === 'error' \? 'amb-error-summary'/);
  });
});

describe('placement and weight on the home page', () => {
  it('the section is the last thing on the home page before the footer', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/pages/index.astro'), 'utf8');
    const rail = src.indexOf('<AmbassadorsRail');
    expect(rail).toBeGreaterThan(src.indexOf('Business pathways'));
    const tail = src.slice(src.indexOf('/>', rail) + 2, src.indexOf('</BaseLayout>'));
    expect(tail.replace(/\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->/g, '').trim()).toBe('');
  });
  it('its CSS ships only when the section renders (the home document has a one-round-trip byte budget)', () => {
    const rail = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/components/home/AmbassadorsRail.astro'), 'utf8');
    // A scoped or inline <style> would put the rules in the document; a scoped one in EVERY home page (inlineStylesheets: 'always').
    expect(rail).not.toMatch(/^\s*<style/m);
    expect(rail).toMatch(/import cssHref from '\.\/ambassadors\.css\?url';/);
    expect(rail.indexOf('<link rel="stylesheet" href={cssHref} />')).toBeGreaterThan(rail.indexOf('{section && people.length > 0 && ('));
    const css = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/components/home/ambassadors.css'), 'utf8');
    expect(css).not.toMatch(/\/\*/); // shipped as-is: no comments
  });
});

import {
  DEFAULT_HOMEPAGE_CONTENT,
  HOME_AMBASSADORS_MAX,
  HOME_AMBASSADOR_ROLES,
  type HomeAmbassador,
  type HomeAmbassadorImage,
  type HomeAmbassadorPublic,
  type HomeAmbassadorRole,
  type HomeAmbassadors,
} from '@goldplus/shared';
// A same-site path only, checked the way a browser resolves it (so `/\evil.com` is refused).
import { isSitePath } from './Links';

/**
 * Ambassadors & models — the home-page section of real people photographed with
 * GoldPlus products. Pure rules: no I/O, no framework.
 *
 * Three guarantees:
 *  - Nothing reaches the storefront unless it is PUBLISHED and the owner has
 *    confirmed a signed photo release is on file (a real person's likeness).
 *  - Every word shown is the owner's: no default names, quotes or stand-in people;
 *    with no one published the section does not render at all.
 *  - A portrait is always a media-library asset, served as its renditions.
 */

const s = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const AMBASSADOR_LIMITS = { name: 60, tagline: 90, imageAlt: 160, heading: 60, intro: 160, ctaLabel: 30, ctaHref: 300 } as const;

function role(v: unknown): HomeAmbassadorRole {
  return HOME_AMBASSADOR_ROLES.includes(v as HomeAmbassadorRole) ? (v as HomeAmbassadorRole) : 'AMBASSADOR';
}

function image(v: any): HomeAmbassadorImage | null {
  if (!v || typeof v !== 'object') return null;
  const src = s(v.src, 500);
  if (!UUID.test(String(v.assetId ?? '')) || !isSitePath(src)) return null;
  const srcset = v.srcset == null ? null : s(v.srcset, 1000) || null;
  const num = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null);
  return { assetId: String(v.assetId), src, srcset, width: num(v.width), height: num(v.height) };
}

function section(input: any, people: HomeAmbassador[]): HomeAmbassadors {
  const d = DEFAULT_HOMEPAGE_CONTENT.ambassadors;
  const href = s(input?.ctaHref, AMBASSADOR_LIMITS.ctaHref);
  return {
    heading: s(input?.heading, AMBASSADOR_LIMITS.heading) || d.heading,
    intro: s(input?.intro, AMBASSADOR_LIMITS.intro),
    ctaLabel: s(input?.ctaLabel, AMBASSADOR_LIMITS.ctaLabel) || d.ctaLabel,
    ctaHref: href && isSitePath(href) ? href : d.ctaHref,
    people,
  };
}

/**
 * Lenient read of a STORED document (or a legacy one with no section at all):
 * never throws, drops what cannot be trusted, keeps drafts for the editor.
 */
export function readStoredAmbassadors(input: unknown): HomeAmbassadors {
  const raw: any = input && typeof input === 'object' ? input : {};
  const people = (Array.isArray(raw.people) ? raw.people : [])
    .map((p: any): HomeAmbassador | null => {
      const id = String(p?.id ?? '');
      const name = s(p?.name, AMBASSADOR_LIMITS.name);
      if (!UUID.test(id) || !name) return null;
      const slug = s(p?.productSlug, 200).toLowerCase();
      return {
        id,
        name,
        role: role(p?.role),
        tagline: s(p?.tagline, AMBASSADOR_LIMITS.tagline),
        image: image(p?.image),
        imageAlt: s(p?.imageAlt, AMBASSADOR_LIMITS.imageAlt),
        productSlug: SLUG.test(slug) ? slug : '',
        releaseOnFile: p?.releaseOnFile === true,
        releaseConfirmedBy: p?.releaseOnFile === true && UUID.test(String(p?.releaseConfirmedBy ?? '')) ? String(p.releaseConfirmedBy) : null,
        releaseConfirmedAt: p?.releaseOnFile === true && ISO.test(String(p?.releaseConfirmedAt ?? '')) ? String(p.releaseConfirmedAt) : null,
        published: p?.published === true,
      };
    })
    .filter((p: HomeAmbassador | null): p is HomeAmbassador => p !== null)
    .slice(0, HOME_AMBASSADORS_MAX);
  return section(raw, people);
}

/**
 * What the storefront may see: published people with a release on file and a
 * portrait, in order — and only the fields a card shows. Release provenance,
 * publish flags and media-library ids never leave the API.
 */
export function publicAmbassadors(a: HomeAmbassadors): Omit<HomeAmbassadors, 'people'> & { people: HomeAmbassadorPublic[] } {
  const people = a.people
    .filter(isLiveAmbassador)
    .map((p): HomeAmbassadorPublic => ({
      id: p.id, name: p.name, role: p.role, tagline: p.tagline, imageAlt: p.imageAlt, productSlug: p.productSlug,
      image: { src: p.image!.src, srcset: p.image!.srcset, width: p.image!.width, height: p.image!.height },
    }));
  return { heading: a.heading, intro: a.intro, ctaLabel: a.ctaLabel, ctaHref: a.ctaHref, people };
}

/** Whether this person is on the live storefront — the one rule the public read and the audit share. */
export function isLiveAmbassador(p: HomeAmbassador): boolean {
  return p.published && p.releaseOnFile && p.image !== null && p.imageAlt.length > 0;
}

/** Is `url` the stored portrait itself — its src or any of its renditions? */
export function imageHasAddress(image: HomeAmbassadorImage | null, url: string): boolean {
  if (!image || !url) return false;
  if (image.src === url) return true;
  return (image.srcset ?? '').split(',').some((c) => c.trim().split(/\s+/)[0] === url);
}

/**
 * Release provenance: the moment the box goes from unticked to ticked, record who
 * and when; while it stays ticked FOR THE SAME PERSON, keep the original
 * confirmation; unticked, clear it.
 *
 * "The same person" is the name and the photo, not the row: an entry rewritten
 * for someone else (new name, or a different portrait) with the box left ticked
 * is a NEW confirmation by whoever saves it — otherwise the new person's likeness
 * would go live under the previous person's signed-release record.
 */
export function releaseProvenance(
  now: { releaseOnFile: boolean; name: string; assetId: string | null },
  before:
    | { releaseOnFile: boolean; releaseConfirmedBy: string | null; releaseConfirmedAt: string | null; name: string; image: { assetId: string } | null }
    | undefined,
  actorId: string,
  at: Date,
): { releaseConfirmedBy: string | null; releaseConfirmedAt: string | null } {
  if (!now.releaseOnFile) return { releaseConfirmedBy: null, releaseConfirmedAt: null };
  const samePerson = before !== undefined && sameName(before.name, now.name) && (before.image?.assetId ?? null) === now.assetId;
  if (samePerson && before!.releaseOnFile && before!.releaseConfirmedAt) {
    return { releaseConfirmedBy: before!.releaseConfirmedBy, releaseConfirmedAt: before!.releaseConfirmedAt };
  }
  return { releaseConfirmedBy: UUID.test(actorId) ? actorId : null, releaseConfirmedAt: at.toISOString() };
}

const sameName = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A fingerprint of the stored section, so two people editing it at once can't
 * silently overwrite each other — scoped to THIS section, so a save of the trust
 * strip in the other editor is not a false conflict. FNV-1a (not security, just identity).
 */
export function ambassadorsRevision(a: HomeAmbassadors): string {
  const text = JSON.stringify(a);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ── Editing ─────────────────────────────────────────────────────────────────

/** One person as the editor sends it: the portrait is a media-library address to resolve. */
export interface AmbassadorDraft {
  id: string;
  name: unknown;
  role: unknown;
  tagline: unknown;
  imageUrl: unknown;
  imageAlt: unknown;
  productSlug: unknown;
  releaseOnFile: unknown;
  published: unknown;
}

export interface AmbassadorFieldError {
  /** Position in the submitted list (0-based); -1 for the section fields. */
  index: number;
  field: string;
  message: string;
}

export interface ValidatedAmbassadorDraft {
  id: string;
  name: string;
  role: HomeAmbassadorRole;
  tagline: string;
  imageUrl: string;
  imageAlt: string;
  productSlug: string;
  releaseOnFile: boolean;
  published: boolean;
}

/**
 * Strict validation of an edit. Unlike the stored read it REPORTS problems with
 * messages a person can act on instead of silently dropping a row, because a
 * silently dropped ambassador is a person who quietly vanished from the page.
 */
export function validateAmbassadorsEdit(input: any): {
  section: Omit<HomeAmbassadors, 'people'>;
  people: ValidatedAmbassadorDraft[];
  errors: AmbassadorFieldError[];
} {
  const errors: AmbassadorFieldError[] = [];
  // A missing list is not "nobody": reading it as [] would silently remove every person.
  if (!Array.isArray(input?.people)) errors.push({ index: -1, field: 'people', message: 'The list of people is missing, so nothing was saved.' });
  const rawPeople: any[] = Array.isArray(input?.people) ? input.people : [];
  if (rawPeople.length > HOME_AMBASSADORS_MAX) {
    errors.push({ index: -1, field: 'people', message: `The section holds at most ${HOME_AMBASSADORS_MAX} people.` });
  }
  const href = s(input?.ctaHref, AMBASSADOR_LIMITS.ctaHref);
  if (href && !isSitePath(href)) errors.push({ index: -1, field: 'ctaHref', message: 'The button must link to a page on this site (start with /).' });
  const seen = new Set<string>();
  const people = rawPeople.slice(0, HOME_AMBASSADORS_MAX).map((p, index): ValidatedAmbassadorDraft => {
    const id = String(p?.id ?? '');
    const name = s(p?.name, AMBASSADOR_LIMITS.name + 1);
    const imageUrl = s(p?.imageUrl, 500);
    const imageAlt = s(p?.imageAlt, AMBASSADOR_LIMITS.imageAlt + 1);
    const productSlug = s(p?.productSlug, 200).toLowerCase();
    const tagline = s(p?.tagline, AMBASSADOR_LIMITS.tagline + 1);
    const releaseOnFile = p?.releaseOnFile === true;
    const published = p?.published === true;
    const err = (field: string, message: string) => errors.push({ index, field, message });
    if (!UUID.test(id) || seen.has(id)) err('id', 'This entry is damaged; remove it and add the person again.');
    seen.add(id);
    if (!name) err('name', 'Enter the person’s name.');
    else if (name.length > AMBASSADOR_LIMITS.name) err('name', `Keep the name under ${AMBASSADOR_LIMITS.name} characters.`);
    if (!HOME_AMBASSADOR_ROLES.includes(p?.role)) err('role', 'Choose ambassador or model.');
    if (tagline.length > AMBASSADOR_LIMITS.tagline) err('tagline', `Keep the line under ${AMBASSADOR_LIMITS.tagline} characters.`);
    if (imageUrl && !isSitePath(imageUrl)) err('imageUrl', 'Use a photo from the media library (its address starts with /uploads/).');
    if (imageAlt.length > AMBASSADOR_LIMITS.imageAlt) err('imageAlt', `Keep the description under ${AMBASSADOR_LIMITS.imageAlt} characters.`);
    if (productSlug && !SLUG.test(productSlug)) err('productSlug', 'Choose the product from the list.');
    if (published) {
      if (!releaseOnFile) err('releaseOnFile', 'Confirm a signed photo release is on file before publishing a real person.');
      if (!imageUrl) err('imageUrl', 'Add a photo before publishing.');
      if (!imageAlt) err('imageAlt', 'Describe the photo for people who cannot see it (e.g. “Grace holding the GP-C08 charger”).');
    }
    return { id, name: name.slice(0, AMBASSADOR_LIMITS.name), role: role(p?.role), tagline: tagline.slice(0, AMBASSADOR_LIMITS.tagline), imageUrl, imageAlt: imageAlt.slice(0, AMBASSADOR_LIMITS.imageAlt), productSlug, releaseOnFile, published };
  });
  const sec = section(input, []);
  return { section: { heading: sec.heading, intro: sec.intro, ctaLabel: sec.ctaLabel, ctaHref: sec.ctaHref }, people, errors };
}

// ── Portrait renditions ─────────────────────────────────────────────────────

export interface RenditionCandidate { purpose: string; format: string; width: number | null; height: number | null; url: string }

/**
 * The src/srcset the storefront serves for a portrait: the media library's WebP
 * renditions (card 480, pdp 1024, zoom 2048 — whichever exist; small originals
 * are never upscaled), never the original upload, which is often a multi-megabyte
 * phone photo. Falls back to the original only when no rendition was made.
 */
export function portraitRenditions(original: { url: string; width: number | null; height: number | null }, variants: RenditionCandidate[]): Omit<HomeAmbassadorImage, 'assetId'> {
  const webp = variants
    .filter((v) => v.format === 'webp' && v.width && ['card', 'pdp', 'zoom'].includes(v.purpose))
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  if (webp.length === 0) return { src: original.url, srcset: null, width: original.width, height: original.height };
  const src = (webp.find((v) => v.purpose === 'card') ?? webp[0]).url;
  return { src, srcset: webp.map((v) => `${v.url} ${v.width}w`).join(', '), width: original.width, height: original.height };
}

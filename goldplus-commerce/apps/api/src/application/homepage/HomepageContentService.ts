import { DEFAULT_HOMEPAGE_CONTENT, DEFAULT_PUBLIC_HOMEPAGE_CONTENT, type HomeAmbassador, type HomepageContent, type PublicHomepageContent } from '@goldplus/shared';
import type { IHomepageContentRepository, StoredHomepageContent } from '../ports/IHomepageContentRepository';
import type { IAmbassadorMedia } from '../ports/IAmbassadorMedia';
import {
  portraitRenditions,
  publicAmbassadors,
  releaseProvenance,
  ambassadorsRevision,
  readStoredAmbassadors,
  validateAmbassadorsEdit,
  imageHasAddress,
  isLiveAmbassador,
  type AmbassadorFieldError,
} from '../../domain/homepage/Ambassadors';
import { isSafeLinkHref } from '../../domain/homepage/Links';

/**
 * Homepage marketing content for the storefront and the editor. Public reads
 * return the stored document (sanitised) or DEFAULT; updates sanitise every
 * field. Empty lists fall back to DEFAULT so the homepage can never be blanked.
 */
const s = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

function sanitize(input: any): HomepageContent {
  const trustItems = (Array.isArray(input?.trustItems) ? input.trustItems : [])
    .map((t: any) => ({ iconKey: s(t?.iconKey, 30) || 'shield', title: s(t?.title, 120), body: s(t?.body, 400) }))
    .filter((t: any) => t.title && t.body)
    .slice(0, 6);
  const pathwayCards = (Array.isArray(input?.pathwayCards) ? input.pathwayCards : [])
    .map((c: any) => ({ title: s(c?.title, 120), body: s(c?.body, 400), ctaLabel: s(c?.ctaLabel, 40), href: s(c?.href, 300) }))
    // A javascript:/data: href would run for whoever clicks the card: refused like a missing one.
    .filter((c: any) => c.title && c.body && c.ctaLabel && isSafeLinkHref(c.href))
    .slice(0, 6);
  const whatsappChannel = {
    heading: s(input?.whatsappChannel?.heading, 80) || DEFAULT_HOMEPAGE_CONTENT.whatsappChannel.heading,
    body: s(input?.whatsappChannel?.body, 200) || DEFAULT_HOMEPAGE_CONTENT.whatsappChannel.body,
  };
  const link = (l: any): { label: string; href: string } => ({ label: s(l?.label, 60), href: s(l?.href, 300) });
  const validLink = (l: { label: string; href: string }) => Boolean(l.label && isSafeLinkHref(l.href));
  const df = DEFAULT_HOMEPAGE_CONTENT.footer;
  const columns = (Array.isArray(input?.footer?.columns) ? input.footer.columns : [])
    .map((c: any) => ({ heading: s(c?.heading, 40), links: (Array.isArray(c?.links) ? c.links : []).map(link).filter(validLink).slice(0, 12) }))
    .filter((c: any) => c.heading && c.links.length > 0)
    .slice(0, 6);
  const legalLinks = (Array.isArray(input?.footer?.legalLinks) ? input.footer.legalLinks : []).map(link).filter(validLink).slice(0, 12);
  const attribution = validLink(link(input?.footer?.attribution)) ? link(input?.footer?.attribution) : df.attribution;
  const footer = {
    columns: columns.length > 0 ? columns : df.columns,
    legalLinks: legalLinks.length > 0 ? legalLinks : df.legalLinks,
    attribution,
    paymentHeading: s(input?.footer?.paymentHeading, 60) || df.paymentHeading,
    copyrightNotice: s(input?.footer?.copyrightNotice, 120) || df.copyrightNotice,
    visitHeading: s(input?.footer?.visitHeading, 40) || df.visitHeading,
    openHeading: s(input?.footer?.openHeading, 40) || df.openHeading,
  };
  return {
    trustItems: trustItems.length > 0 ? trustItems : DEFAULT_HOMEPAGE_CONTENT.trustItems,
    pathwayCards: pathwayCards.length > 0 ? pathwayCards : DEFAULT_HOMEPAGE_CONTENT.pathwayCards,
    whatsappChannel,
    footer,
    ambassadors: readStoredAmbassadors(input?.ambassadors),
  };
}

/** A person as the consent audit records them — by name, not only an opaque id. */
export interface AmbassadorSnapshot {
  id: string;
  name: string;
  live: boolean;
  releaseOnFile: boolean;
  releaseConfirmedBy: string | null;
  releaseConfirmedAt: string | null;
}
type PersonRef = { id: string; name: string };
export interface AmbassadorSaveChanges {
  releasesConfirmed: PersonRef[];
  releasesWithdrawn: PersonRef[];
  wentLive: PersonRef[];
  leftLive: PersonRef[];
  /** People taken out of the section altogether, with what was on record for them. */
  removed: AmbassadorSnapshot[];
}

const CAS_ATTEMPTS = 3;
const ref = (p: HomeAmbassador): PersonRef => ({ id: p.id, name: p.name });
const snapshot = (p: HomeAmbassador): AmbassadorSnapshot => ({
  id: p.id, name: p.name, live: isLiveAmbassador(p), releaseOnFile: p.releaseOnFile, releaseConfirmedBy: p.releaseConfirmedBy, releaseConfirmedAt: p.releaseConfirmedAt,
});

function describeChanges(before: HomeAmbassador[], after: HomeAmbassador[]): AmbassadorSaveChanges {
  const prior = new Map(before.map((p) => [p.id, p]));
  const kept = new Set(after.map((p) => p.id));
  const changes: AmbassadorSaveChanges = { releasesConfirmed: [], releasesWithdrawn: [], wentLive: [], leftLive: [], removed: [] };
  for (const p of after) {
    const was = prior.get(p.id);
    // Exactly the people stamped by THIS save — the stamp and the record agree.
    if (p.releaseConfirmedAt && p.releaseConfirmedAt !== was?.releaseConfirmedAt) changes.releasesConfirmed.push(ref(p));
    if (!p.releaseOnFile && was?.releaseOnFile) changes.releasesWithdrawn.push(ref(p));
    const liveNow = isLiveAmbassador(p);
    const liveBefore = was ? isLiveAmbassador(was) : false;
    if (liveNow && !liveBefore) changes.wentLive.push(ref(p));
    if (!liveNow && liveBefore) changes.leftLive.push(ref(p));
  }
  for (const p of before) if (!kept.has(p.id)) changes.removed.push(snapshot(p));
  return changes;
}

export class HomepageContentService {
  constructor(
    private readonly repo: IHomepageContentRepository,
    /** Needed only to edit the ambassadors section; reads never touch the media library. */
    private readonly ambassadorMedia?: IAmbassadorMedia,
  ) {}

  async getPublicConfig(): Promise<PublicHomepageContent> {
    try {
      const stored = await this.repo.getConfig();
      const config = stored?.config ? sanitize(stored.config) : DEFAULT_HOMEPAGE_CONTENT;
      // Drafts, unpublished people and anyone without a release on file never leave the API.
      return { ...config, ambassadors: publicAmbassadors(config.ambassadors) };
    } catch {
      return DEFAULT_PUBLIC_HOMEPAGE_CONTENT;
    }
  }

  /** The ambassadors editor's view: every entry (drafts and provenance included) and the section fingerprint. */
  async getAmbassadorsAdmin(): Promise<{ ambassadors: HomepageContent['ambassadors']; revision: string }> {
    const stored = await this.repo.getConfig();
    const ambassadors = readStoredAmbassadors((stored?.config as any)?.ambassadors);
    return { ambassadors, revision: ambassadorsRevision(ambassadors) };
  }

  async getAdminConfig(): Promise<{ config: HomepageContent; version: number }> {
    const stored = await this.repo.getConfig();
    return { config: stored?.config ? sanitize(stored.config) : DEFAULT_HOMEPAGE_CONTENT, version: stored?.version ?? 0 };
  }

  /**
   * The whole-document editor (/admin/homepage) knows nothing of the ambassadors
   * section, and sends the whole document. Its save must never wipe the people
   * the ambassadors editor manages, so the STORED section is always kept — and the
   * write is a compare-and-swap, so an ambassadors save that lands while this one
   * is in flight is never overwritten by the copy read here (a withdrawn release
   * must stay withdrawn).
   */
  async updateConfig(input: unknown, actorId: string): Promise<{ ok: true; version: number }> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const current = await this.repo.getConfig();
      const kept = readStoredAmbassadors((current?.config as any)?.ambassadors);
      const clean = { ...sanitize(input), ambassadors: kept };
      const stored = current ? await this.repo.replaceIfVersion(clean, actorId, current.version) : await this.repo.updateConfig(clean, actorId);
      if (stored) return { ok: true, version: stored.version };
    }
    throw new Error('The homepage content kept changing while saving. Try again.');
  }

  /**
   * Replaces the ambassadors section. Every newly chosen photo must be an active
   * media-library image; it is stored as its renditions, and the library records
   * the usage so the image cannot be deleted while it is on the page. Nothing is
   * saved if any entry has a problem — the editor shows each one next to its field.
   *
   * `expectedRevision` (the section fingerprint the editor loaded) is REQUIRED: a
   * save that cannot say which version it replaces — an editor whose load failed,
   * a script — must not replace anything. A mismatch saves nothing either.
   * Release provenance — who ticked "signed release on file", and when — is
   * recorded here, never taken from the request.
   */
  async updateAmbassadors(
    input: unknown,
    actorId: string,
    expectedRevision: string | undefined,
    now: Date = new Date(),
  ): Promise<
    | { ok: true; version: number; changes: AmbassadorSaveChanges; previous: AmbassadorSnapshot[]; usagesPending: boolean }
    | { ok: false; errors: AmbassadorFieldError[] }
    | { ok: false; conflict: true; currentRevision: string }
  > {
    if (!this.ambassadorMedia) throw new Error('Ambassador media port is not configured.');
    const current = await this.repo.getConfig();
    const stored = readStoredAmbassadors((current?.config as any)?.ambassadors);
    const currentRevision = ambassadorsRevision(stored);
    if (typeof expectedRevision !== 'string' || expectedRevision !== currentRevision) {
      return { ok: false, conflict: true, currentRevision };
    }
    const { section, people, errors } = validateAmbassadorsEdit(input);
    const before = new Map(stored.people.map((p) => [p.id, p]));
    const resolved: HomeAmbassador[] = [];
    for (const [index, p] of people.entries()) {
      const prior = before.get(p.id);
      let image: HomeAmbassador['image'] = null;
      if (p.imageUrl && prior?.image && imageHasAddress(prior.image, p.imageUrl)) {
        // The photo already on this entry is kept exactly as stored. Re-checking it
        // would let one portrait archived in the library block every save —
        // including the unpublish or release withdrawal that must never wait.
        image = prior.image;
      } else if (p.imageUrl) {
        const found = await this.ambassadorMedia.resolveByUrl(p.imageUrl);
        if (!found) {
          errors.push({ index, field: 'imageUrl', message: 'That photo is not in the media library. Upload it here or pick it from the library.' });
        } else if (found.status !== 'ACTIVE') {
          errors.push({ index, field: 'imageUrl', message: 'That photo is archived in the media library. Restore it or choose another.' });
        } else {
          image = { assetId: found.assetId, ...portraitRenditions(found.original, found.variants) };
        }
      }
      const provenance = releaseProvenance({ releaseOnFile: p.releaseOnFile, name: p.name, assetId: image?.assetId ?? null }, prior, actorId, now);
      resolved.push({ id: p.id, name: p.name, role: p.role, tagline: p.tagline, image, imageAlt: p.imageAlt, productSlug: p.productSlug, releaseOnFile: p.releaseOnFile, ...provenance, published: p.published });
    }
    if (errors.length > 0) return { ok: false, errors };

    const portraits = resolved.filter((p) => p.image).map((p) => ({ personId: p.id, assetId: p.image!.assetId }));
    // Protect first: recorded before the write, a usage only over-protects until the
    // sync below; recorded after, a failure would leave a live portrait deletable.
    await this.ambassadorMedia.protect(portraits);
    let saved: StoredHomepageContent | null = null;
    for (let attempt = 0, latest = current; attempt < CAS_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        latest = await this.repo.getConfig();
        const revision = ambassadorsRevision(readStoredAmbassadors((latest?.config as any)?.ambassadors));
        // Someone saved THIS section meanwhile: theirs stands, the editor is told.
        if (revision !== currentRevision) return { ok: false, conflict: true, currentRevision: revision };
        // Otherwise it was the other editor (trust strip, footer): write onto their version.
      }
      const base = latest?.config ? sanitize(latest.config) : DEFAULT_HOMEPAGE_CONTENT;
      const doc = { ...base, ambassadors: { ...section, people: resolved } };
      saved = latest ? await this.repo.replaceIfVersion(doc, actorId, latest.version) : await this.repo.updateConfig(doc, actorId);
      if (saved) break;
    }
    if (!saved) throw new Error('The homepage content kept changing while saving. Try again.');

    // The save is live. Removing stale usages is housekeeping: if it fails, stale
    // rows only over-protect, so report it rather than fail a save that happened.
    let usagesPending = false;
    try {
      await this.ambassadorMedia.syncUsages(portraits);
    } catch {
      usagesPending = true;
    }
    return { ok: true, version: saved.version, changes: describeChanges(stored.people, resolved), previous: stored.people.map(snapshot), usagesPending };
  }
}

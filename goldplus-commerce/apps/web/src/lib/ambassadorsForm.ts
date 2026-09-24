/**
 * The ambassadors editor's form logic, kept pure so it can be tested: reading a
 * row out of the posted form, deciding when the "Add a person" row was left
 * blank, ordering by the positions typed, and folding another admin's newer save
 * into this admin's draft without undoing a consent withdrawal.
 */

export interface AmbassadorRow {
  id: string;
  /** Not yet saved: the "Add a person" row, or a new person whose first save failed. */
  isNew: boolean;
  name: string;
  role: string;
  tagline: string;
  imageUrl: string;
  imageAlt: string;
  productSlug: string;
  releaseOnFile: boolean;
  published: boolean;
  /** The position typed in the form. */
  position: number;
  /** The position the row had when the page was drawn. */
  was: number;
  preview: string | null;
  releaseConfirmedAt: string | null;
  releaseConfirmedBy: string | null;
  /** Ticked "Remove this person": kept on the page (still ticked) if the save fails. */
  remove: boolean;
}

/** A stored person as the admin API returns them (the fields this editor reads). */
export interface StoredAmbassador {
  id: string;
  name: string;
  role: string;
  tagline: string;
  image: { src: string } | null;
  imageAlt: string;
  productSlug: string;
  releaseOnFile: boolean;
  releaseConfirmedAt: string | null;
  releaseConfirmedBy: string | null;
  published: boolean;
}

const bool = (v: FormDataEntryValue | null) => v === 'on' || v === 'true';

export function readRow(form: FormData, i: number, mintId: () => string): { row: AmbassadorRow; photo: File | null } {
  const f = (k: string) => String(form.get(`p.${i}.${k}`) ?? '').trim();
  const photo = form.get(`p.${i}.photo`);
  const was = Number(f('was')) || i + 1;
  const isNew = f('isNew') === '1' || !f('id');
  return {
    row: {
      id: f('id') || mintId(),
      isNew,
      name: f('name'),
      role: f('role') || 'AMBASSADOR',
      tagline: f('tagline'),
      imageUrl: f('imageUrl'),
      imageAlt: f('imageAlt'),
      productSlug: f('productSlug'),
      releaseOnFile: bool(form.get(`p.${i}.releaseOnFile`)),
      published: bool(form.get(`p.${i}.published`)),
      position: Number(f('position')) || was,
      was,
      preview: f('preview') || null,
      releaseConfirmedAt: f('releaseConfirmedAt') || null,
      releaseConfirmedBy: f('releaseConfirmedBy') || null,
      remove: bool(form.get(`p.${i}.remove`)),
    },
    photo: photo instanceof File && photo.size > 0 ? photo : null,
  };
}

/**
 * A new row the admin never filled in. EVERY field counts — a row with only a
 * product picked or a box ticked is a person half-added, and dropping it
 * silently would report "Saved" over lost input. The role select always has a
 * value, so it does not count.
 */
export function isBlankNewRow(row: AmbassadorRow, hasPhoto: boolean): boolean {
  return row.isNew && !hasPhoto && !row.name && !row.tagline && !row.imageUrl && !row.imageAlt && !row.productSlug && !row.releaseOnFile && !row.published;
}

/**
 * Order by the positions typed, the way a person means them: typing 1 on the
 * eighth person puts them FIRST (not second, tied behind whoever already holds
 * 1). A row moved up sorts just before the row it lands on, a row moved down
 * just after; unmoved rows keep their order. Then renumbered 1..n.
 */
export function orderRows<T extends Pick<AmbassadorRow, 'position' | 'was'>>(rows: T[]): T[] {
  const key = (r: T) => (r.position < r.was ? r.position - 0.5 : r.position > r.was ? r.position + 0.5 : r.position);
  return rows
    .map((r, index) => ({ r, index, k: key(r) }))
    .sort((a, b) => a.k - b.k || a.index - b.index)
    .map(({ r }, i) => ({ ...r, position: i + 1, was: i + 1 }));
}

export function rowFromStored(p: StoredAmbassador, index: number): AmbassadorRow {
  return {
    id: p.id, isNew: false, name: p.name, role: p.role, tagline: p.tagline, imageUrl: p.image?.src ?? '', imageAlt: p.imageAlt,
    productSlug: p.productSlug, releaseOnFile: p.releaseOnFile, published: p.published, position: index + 1, was: index + 1,
    preview: p.image?.src ?? null, releaseConfirmedAt: p.releaseConfirmedAt ?? null, releaseConfirmedBy: p.releaseConfirmedBy ?? null, remove: false,
  };
}

/**
 * Another admin saved this section after this page was drawn. Their save may
 * have withdrawn someone's release, taken someone off the page, removed someone
 * or added someone. "Save again" must never quietly undo any of that — least of
 * all a consent withdrawal, which would put a person's likeness back online and
 * record a fresh release confirmation under this admin's name. So:
 *  - withdrawn in theirs → unticked (and unpublished) here;
 *  - taken off the page in theirs → unpublished here;
 *  - removed in theirs → kept as an unsaved draft, release and publish unticked;
 *  - added in theirs → added here, exactly as they saved it.
 * Every change is named so the admin sees what happened. Re-ticking is a
 * deliberate new confirmation.
 */
export function mergeAfterConflict(draft: AmbassadorRow[], stored: StoredAmbassador[]): { rows: AmbassadorRow[]; changes: string[] } {
  const theirs = new Map(stored.map((p) => [p.id, p]));
  const changes: string[] = [];
  const rows = draft.map((r) => {
    if (r.isNew) return r;
    const t = theirs.get(r.id);
    const label = r.name || 'A person';
    if (!t) {
      if (r.remove) return r;
      changes.push(`${label} was removed in their version — kept here as an unsaved draft with the release and “Show on the homepage” unticked.`);
      return { ...r, isNew: true, releaseOnFile: false, published: false, releaseConfirmedAt: null, releaseConfirmedBy: null };
    }
    let next = { ...r, releaseConfirmedAt: t.releaseConfirmedAt, releaseConfirmedBy: t.releaseConfirmedBy };
    if (!t.releaseOnFile && r.releaseOnFile) {
      changes.push(`${label}: the signed release was withdrawn in their version — unticked here, and taken off the homepage.`);
      next = { ...next, releaseOnFile: false, published: false, releaseConfirmedAt: null, releaseConfirmedBy: null };
    } else if (!t.published && r.published) {
      changes.push(`${label} was taken off the homepage in their version — unticked here.`);
      next = { ...next, published: false };
    }
    return next;
  });
  const mine = new Set(draft.map((r) => r.id));
  stored.forEach((p, index) => {
    if (mine.has(p.id)) return;
    changes.push(`${p.name} was added in their version — added below as they saved it.`);
    rows.push({ ...rowFromStored(p, index), position: rows.length + 1, was: rows.length + 1 });
  });
  return { rows, changes };
}

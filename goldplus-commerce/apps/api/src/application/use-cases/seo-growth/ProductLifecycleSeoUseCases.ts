/**
 * Product lifecycle SEO (0119) — what happens to a product URL when the
 * product's real state changes. Kept pure so the rules are testable.
 *
 * The failure mode this exists to prevent is the blanket redirect: sweeping
 * every out-of-stock or discontinued product to the homepage or a category
 * page. That destroys the ranking and the link equity of URLs that were
 * earning traffic, and it lands the customer somewhere that does not answer
 * their query. Google treats such redirects as soft 404s anyway, so it buys
 * nothing.
 *
 * Therefore:
 *  - Temporarily unavailable keeps its URL and returns 200. Stock is not a
 *    reason to delete a page.
 *  - Discontinued WITH a genuine successor may 301 to that successor — never
 *    to a category or the homepage.
 *  - Discontinued WITHOUT a successor keeps a 200 page that says so and offers
 *    alternatives, because the page still answers "does ShopGoldPlus sell X?".
 *    410 is reserved for pages that should never have existed.
 *  - Nothing is decided automatically. A disposition is a recorded human
 *    decision with a rationale and the evidence it was taken on.
 */

export const LIFECYCLE_STATES = [
  'ACTIVE',
  'TEMPORARILY_OUT_OF_STOCK',
  'DISCONTINUED_WITH_SUCCESSOR',
  'DISCONTINUED_NO_SUCCESSOR',
  'SEASONAL',
  'DRAFT',
  'UNPUBLISHED',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_DISPOSITIONS = [
  'RETAIN_200',
  'OFFER_ALTERNATIVE',
  'REDIRECT_301_SUCCESSOR',
  'REDIRECT_301_REPLACEMENT',
  'GONE_410',
  'UNPUBLISH',
  'UNDECIDED',
] as const;
export type LifecycleDisposition = (typeof LIFECYCLE_DISPOSITIONS)[number];

/** Which dispositions are defensible for a state. UNDECIDED is always valid. */
const ALLOWED: Record<LifecycleState, LifecycleDisposition[]> = {
  ACTIVE: ['RETAIN_200'],
  TEMPORARILY_OUT_OF_STOCK: ['RETAIN_200', 'OFFER_ALTERNATIVE'],
  DISCONTINUED_WITH_SUCCESSOR: ['REDIRECT_301_SUCCESSOR', 'REDIRECT_301_REPLACEMENT', 'OFFER_ALTERNATIVE', 'RETAIN_200'],
  DISCONTINUED_NO_SUCCESSOR: ['OFFER_ALTERNATIVE', 'RETAIN_200'],
  SEASONAL: ['RETAIN_200', 'OFFER_ALTERNATIVE'],
  DRAFT: ['UNPUBLISH'],
  UNPUBLISHED: ['UNPUBLISH', 'GONE_410'],
};

export const REDIRECTING_DISPOSITIONS: readonly LifecycleDisposition[] = ['REDIRECT_301_SUCCESSOR', 'REDIRECT_301_REPLACEMENT'];

export const allowedDispositionsFor = (state: LifecycleState): LifecycleDisposition[] =>
  [...(ALLOWED[state] ?? []), 'UNDECIDED'];

/** The disposition suggested for a state — a suggestion, never auto-applied. */
export function suggestedDisposition(state: LifecycleState): LifecycleDisposition {
  if (state === 'DISCONTINUED_WITH_SUCCESSOR') return 'REDIRECT_301_SUCCESSOR';
  if (state === 'DISCONTINUED_NO_SUCCESSOR') return 'OFFER_ALTERNATIVE';
  if (state === 'DRAFT' || state === 'UNPUBLISHED') return 'UNPUBLISH';
  return 'RETAIN_200';
}

export interface LifecycleDecisionInput {
  productId: string;
  state: LifecycleState | string;
  disposition: LifecycleDisposition | string;
  successorProductId?: string | null;
  rationale?: string | null;
  evidence?: Record<string, unknown> | null;
}

export type LifecycleValidation =
  | { ok: true; input: LifecycleDecisionInput & { state: LifecycleState; disposition: LifecycleDisposition } }
  | { ok: false; code: string; message: string };

export function validateLifecycleDecision(raw: LifecycleDecisionInput): LifecycleValidation {
  if (!raw.productId) return { ok: false, code: 'BAD_INPUT', message: 'productId is required.' };
  const state = raw.state as LifecycleState;
  const disposition = raw.disposition as LifecycleDisposition;
  if (!LIFECYCLE_STATES.includes(state)) {
    return { ok: false, code: 'BAD_INPUT', message: `state must be one of ${LIFECYCLE_STATES.join(', ')}.` };
  }
  if (!LIFECYCLE_DISPOSITIONS.includes(disposition)) {
    return { ok: false, code: 'BAD_INPUT', message: `disposition must be one of ${LIFECYCLE_DISPOSITIONS.join(', ')}.` };
  }
  if (!allowedDispositionsFor(state).includes(disposition)) {
    return {
      ok: false,
      code: 'DISPOSITION_NOT_DEFENSIBLE',
      message: `${disposition} is not a defensible outcome for ${state}. Allowed: ${allowedDispositionsFor(state).join(', ')}.`,
    };
  }
  if (REDIRECTING_DISPOSITIONS.includes(disposition) && !raw.successorProductId) {
    return {
      ok: false,
      code: 'SUCCESSOR_REQUIRED',
      message: 'A 301 needs a genuine successor product. Redirecting to a category or the homepage is a soft 404 and is not offered.',
    };
  }
  if (disposition !== 'UNDECIDED' && !(raw.rationale ?? '').trim()) {
    return { ok: false, code: 'RATIONALE_REQUIRED', message: 'A lifecycle decision must record why it was taken.' };
  }
  return {
    ok: true,
    input: { ...raw, state, disposition, rationale: (raw.rationale ?? '')?.trim() || null },
  };
}

// ── What the storefront does with a decided product ─────────────────────────

export interface LifecycleSeoOutcome {
  /** HTTP status the product URL should answer with. */
  httpStatus: 200 | 301 | 410;
  /** Where to send the visitor, when redirecting. */
  redirectToProductId: string | null;
  /** Whether search engines may index the page. */
  indexable: boolean;
  /** Whether the page should show alternative products. */
  showAlternatives: boolean;
  /** Honest one-line availability statement for the page. */
  notice: string | null;
}

/**
 * The storefront outcome for a recorded decision. An UNDECIDED product keeps
 * its page exactly as it is — the absence of a decision never triggers an
 * action.
 */
export function lifecycleSeoOutcome(row: {
  state?: string;
  disposition?: string;
  successorProductId?: string | null;
}): LifecycleSeoOutcome {
  const disposition = (row.disposition ?? 'UNDECIDED') as LifecycleDisposition;
  const state = (row.state ?? 'ACTIVE') as LifecycleState;

  if (REDIRECTING_DISPOSITIONS.includes(disposition) && row.successorProductId) {
    return { httpStatus: 301, redirectToProductId: row.successorProductId, indexable: false, showAlternatives: false, notice: null };
  }
  if (disposition === 'GONE_410') {
    return { httpStatus: 410, redirectToProductId: null, indexable: false, showAlternatives: true, notice: 'This page is no longer available.' };
  }
  if (disposition === 'UNPUBLISH') {
    return { httpStatus: 200, redirectToProductId: null, indexable: false, showAlternatives: true, notice: 'This product is not currently published.' };
  }
  if (disposition === 'OFFER_ALTERNATIVE') {
    return {
      httpStatus: 200,
      redirectToProductId: null,
      // Discontinued-and-honest pages stay indexable: they answer a real query
      // and keep the link equity they earned.
      indexable: true,
      showAlternatives: true,
      notice: state === 'TEMPORARILY_OUT_OF_STOCK' || state === 'SEASONAL'
        ? 'Out of stock right now. Here are alternatives we do have.'
        : 'We no longer stock this item. Here are the closest alternatives.',
    };
  }
  return {
    httpStatus: 200,
    redirectToProductId: null,
    indexable: state !== 'DRAFT' && state !== 'UNPUBLISHED',
    showAlternatives: state === 'TEMPORARILY_OUT_OF_STOCK' || state === 'SEASONAL',
    notice: state === 'TEMPORARILY_OUT_OF_STOCK' ? 'Temporarily out of stock.' : null,
  };
}

/** Guard used by the bulk-decision path: refuses to redirect a whole batch. */
export function rejectBlanketRedirect(decisions: LifecycleDecisionInput[]): { ok: boolean; message?: string } {
  const targets = decisions
    .filter((d) => REDIRECTING_DISPOSITIONS.includes(d.disposition as LifecycleDisposition))
    .map((d) => d.successorProductId ?? '');
  if (targets.length >= 3 && new Set(targets).size === 1) {
    return {
      ok: false,
      message: 'Three or more products would redirect to the same destination. That is a blanket redirect, not a per-product decision — record each successor individually.',
    };
  }
  return { ok: true };
}

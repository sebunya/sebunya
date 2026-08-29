/**
 * Query intelligence: normalization -> clustering -> intent -> page ownership.
 *
 * Deterministic by construction. Cluster identity must not drift every six
 * hours, or every downstream opportunity, work item and piece of history
 * detaches from its subject. An LLM may later PROPOSE merges; it may not
 * silently re-partition the universe.
 *
 * Nothing here fabricates demand. With Search Console unconnected these
 * functions still work — they organise the queries GoldPlus already tracks and
 * report UNKNOWN performance rather than zero.
 */

// ── Normalization ───────────────────────────────────────────────────────────

/** Brand variants that must collapse to one token. */
const BRAND_VARIANTS: Array<[RegExp, string]> = [
  [/\bgold\s*plus\b/gi, 'goldplus'],
  [/\bshop\s*gold\s*plus\b/gi, 'goldplus'],
  [/\bshopgoldplus(\.com|\.ug)?\b/gi, 'goldplus'],
  // The domain without its "plus". Search Console shows real navigational
  // demand arriving as "shopgold", which fell through every rule above and was
  // therefore classified UNKNOWN — and an UNKNOWN intent blocks ownership,
  // which blocks the opportunity. Runs AFTER the "shop gold plus" rule, which
  // has already collapsed that longer form.
  [/\bshop\s*gold\b/gi, 'goldplus'],
];

/** Storage/capacity units normalise so "128 gb" and "128gb" cluster together. */
const UNIT_RULES: Array<[RegExp, string]> = [
  [/(\d+)\s*(gb|gigabytes?)\b/gi, '$1gb'],
  [/(\d+)\s*(tb|terabytes?)\b/gi, '$1tb'],
  [/(\d+)\s*(mah|milliamp[s]?\s*hours?)\b/gi, '$1mah'],
  [/(\d+)\s*(w|watts?)\b/gi, '$1w'],
];

/** Accessory terminology that means the same thing to a shopper. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\bpowerbank\b/gi, 'power bank'],
  [/\bear\s*phones?\b/gi, 'earphones'],
  [/\bear\s*buds?\b/gi, 'earbuds'],
  [/\bflash\s*disk\b/gi, 'flash drive'],
  [/\bpen\s*drive\b/gi, 'flash drive'],
  [/\bmemory\s*stick\b/gi, 'flash drive'],
  [/\bcharger\s*cable\b/gi, 'charging cable'],
  [/\btype\s*-?\s*c\b/gi, 'usb c'],
  [/\bmicro\s*-?\s*usb\b/gi, 'micro usb'],
];

/**
 * Safe singular/plural collapse, by explicit domain lexicon.
 *
 * Generic stemming is NOT used and must not be introduced. A stemmer would
 * happily fold "iPhone 15 Pro" toward "iPhone 15", or treat "128gb" and
 * "128gbs" as unrelated to their singular forms while merging things that
 * carry different commercial meaning. Every entry here is a word where a
 * GoldPlus shopper means the same thing either way — and nothing else
 * qualifies without being added deliberately.
 *
 * The plural form maps to the singular; matching is whole-word only, so a
 * model token or part number containing these letters is untouched.
 */
const SAFE_MORPHOLOGY: Array<[RegExp, string]> = [
  [/\bbatteries\b/gi, 'battery'],
  [/\bchargers\b/gi, 'charger'],
  [/\bcables\b/gi, 'cable'],
  [/\bcards\b/gi, 'card'],
  [/\bdrives\b/gi, 'drive'],
  [/\bearphones\b/gi, 'earphone'],
  [/\bheadphones\b/gi, 'headphone'],
  [/\bearbuds\b/gi, 'earbud'],
  [/\baccessories\b/gi, 'accessory'],
  [/\badapters\b/gi, 'adapter'],
  [/\bspeakers\b/gi, 'speaker'],
  [/\binverters\b/gi, 'inverter'],
  [/\bbanks\b/gi, 'bank'],
  [/\blaptops\b/gi, 'laptop'],
  [/\bphones\b/gi, 'phone'],
  [/\bscreens\b/gi, 'screen'],
  [/\bcases\b/gi, 'case'],
  [/\bpanels\b/gi, 'panel'],
  [/\bbulbs\b/gi, 'bulb'],
  [/\bmounts\b/gi, 'mount'],
  [/\bholders\b/gi, 'holder'],
];

/**
 * Tokens that identify a DIFFERENT commercial thing and must survive
 * normalization untouched. Guarded explicitly because a future well-meaning
 * "improvement" to the rules above is exactly how "iPhone 15" and
 * "iPhone 15 Pro" quietly become one cluster.
 */
export const IDENTITY_TOKEN_PATTERNS: RegExp[] = [
  /\b\d+\s*(gb|tb|mah|w)\b/i,   // capacity and power ratings
  /\bpro\b|\bmax\b|\bplus\b|\bultra\b|\bmini\b|\blite\b/i,
  /\b[a-z]{1,3}\d{2,}[a-z0-9-]*\b/i, // model/part codes: s24, a2479, eb-bg991
];

export interface NormalizedQuery {
  raw: string;
  normalized: string;
  tokens: string[];
}

/**
 * Deterministic normalization. The RAW query is always preserved — provider
 * evidence is never destroyed by our own tidying.
 */
export function normalizeQuery(raw: string): NormalizedQuery {
  let s = String(raw ?? '').toLowerCase().trim();
  for (const [re, to] of BRAND_VARIANTS) s = s.replace(re, to);
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  for (const [re, to] of UNIT_RULES) s = s.replace(re, to);
  // Morphology runs after the unit rules so "128 gb" is already "128gb" and
  // cannot be mistaken for a pluralisable word.
  for (const [re, to] of SAFE_MORPHOLOGY) s = s.replace(re, to);
  s = s
    .replace(/[^\p{L}\p{N}\s.+-]/gu, ' ')  // keep model-ish chars
    .replace(/\s+/g, ' ')
    .trim();
  return { raw: String(raw ?? ''), normalized: s, tokens: s ? s.split(' ') : [] };
}

// ── Clustering ──────────────────────────────────────────────────────────────

export const CLUSTER_METHODS = ['RULE', 'ENTITY_MATCH', 'SEMANTIC', 'HYBRID'] as const;
export type ClusterMethod = (typeof CLUSTER_METHODS)[number];

export interface ClusterEntity {
  /** Stable identifier of a product, category or compatibility set. */
  entityId: string;
  entityType: 'PRODUCT' | 'CATEGORY' | 'COMPATIBILITY' | 'CONTENT';
  /** Lower-cased match terms, most specific first. */
  terms: string[];
}

export interface QueryCluster {
  clusterKey: string;
  method: ClusterMethod;
  confidence: number;
  entityId: string | null;
  entityType: ClusterEntity['entityType'] | null;
  members: string[];
  label: string;
}

/** Words that carry no clustering signal. */
const STOPWORDS = new Set(['the', 'a', 'an', 'in', 'for', 'of', 'to', 'and', 'best', 'buy', 'price', 'uganda', 'kampala', 'near', 'me']);

const contentWords = (tokens: string[]): string[] => tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1);

/**
 * Clusters by ENTITY first (deterministic and stable), then falls back to a
 * content-word signature. The cluster key is derived from the entity or the
 * sorted signature, never from a counter, so re-running produces identical
 * identities.
 */
export function clusterQueries(
  queries: Array<{ raw: string }>,
  entities: ClusterEntity[],
): QueryCluster[] {
  const byKey = new Map<string, QueryCluster>();

  // Most specific terms win, so "samsung s21 battery" beats bare "battery".
  const ranked = [...entities].sort(
    (a, b) => Math.max(...b.terms.map((t) => t.length), 0) - Math.max(...a.terms.map((t) => t.length), 0),
  );

  for (const q of queries) {
    const n = normalizeQuery(q.raw);
    if (n.tokens.length === 0) continue;

    const matched = ranked.find((e) => e.terms.some((t) => n.normalized.includes(t.toLowerCase())));
    const words = contentWords(n.tokens);

    const key = matched
      ? `entity:${matched.entityType.toLowerCase()}:${matched.entityId}`
      : `sig:${[...words].sort().join('-') || 'unclassified'}`;

    const existing = byKey.get(key);
    if (existing) {
      if (!existing.members.includes(q.raw)) existing.members.push(q.raw);
      continue;
    }
    byKey.set(key, {
      clusterKey: key,
      method: matched ? 'ENTITY_MATCH' : 'RULE',
      // Entity matches are strong evidence; a bare word signature is weak.
      confidence: matched ? 0.9 : 0.5,
      entityId: matched?.entityId ?? null,
      entityType: matched?.entityType ?? null,
      members: [q.raw],
      label: matched ? matched.terms[0] : words.join(' ') || n.normalized,
    });
  }

  return [...byKey.values()].sort((a, b) => b.members.length - a.members.length || a.clusterKey.localeCompare(b.clusterKey));
}

// ── Intent ──────────────────────────────────────────────────────────────────

export const INTENTS = [
  'BRAND', 'PRODUCT', 'CATEGORY', 'COMPATIBILITY', 'PRICE', 'COMPARISON',
  'PROBLEM_SOLUTION', 'LOCAL', 'TRANSACTIONAL', 'INFORMATIONAL', 'NAVIGATIONAL',
  'AFTERSALES', 'UNKNOWN',
] as const;
export type Intent = (typeof INTENTS)[number];

// PERSISTED = intent GoldPlus already recorded for the query, which outranks
// anything derived from the wording alone.
export const INTENT_METHODS = ['PERSISTED', 'RULE', 'ENTITY', 'SEMANTIC', 'HYBRID'] as const;
export type IntentMethod = (typeof INTENT_METHODS)[number];

export interface IntentResult {
  primary: Intent;
  secondary: Intent | null;
  confidence: number;
  method: IntentMethod;
  matched: string[];
}

const INTENT_RULES: Array<{ intent: Intent; patterns: RegExp[] }> = [
  { intent: 'COMPATIBILITY', patterns: [/\bfit(s|ting)?\b/, /\bcompatible\b/, /\bwork(s)? with\b/, /\bfor (my|the)\b/, /\bwhich .* for\b/] },
  { intent: 'AFTERSALES', patterns: [/\bwarrant(y|ies)\b/, /\breturn(s)?\b/, /\brefund\b/, /\brepair\b/, /\breplace(ment)?\b/, /\btrack .*order\b/] },
  { intent: 'PRICE', patterns: [/\bprice\b/, /\bcost\b/, /\bhow much\b/, /\bcheap(est)?\b/, /\bugx\b/, /\bshilling/] },
  { intent: 'COMPARISON', patterns: [/\bvs\b/, /\bversus\b/, /\bcompare\b/, /\bdifference between\b/, /\bor\b.*\?/] },
  { intent: 'PROBLEM_SOLUTION', patterns: [/\bnot (charging|working)\b/, /\bhow (to|do i)\b/, /\bfix\b/, /\bproblem\b/, /\bslow\b/, /\bfake\b/, /\bgenuine\b/, /\bverify\b/] },
  { intent: 'LOCAL', patterns: [/\bnear me\b/, /\bin kampala\b/, /\buganda\b/, /\bwilson road\b/, /\bshop\b.*\baddress\b/, /\bdelivery\b/] },
  { intent: 'TRANSACTIONAL', patterns: [/\bbuy\b/, /\border\b/, /\bshop\b/, /\bfor sale\b/, /\bonline\b/] },
  { intent: 'INFORMATIONAL', patterns: [/\bwhat is\b/, /\bhow many\b/, /\bguide\b/, /\bmeaning\b/, /\bexplain/] },
];

/**
 * Deterministic first. An entity match supplies PRODUCT/CATEGORY, rules supply
 * the modifier, and where both fire the modifier wins as primary — someone
 * asking "does X fit my Y" wants compatibility, not a category page.
 */
export function classifyIntent(input: {
  raw: string;
  entityType?: ClusterEntity['entityType'] | null;
  isBrandQuery?: boolean;
  /**
   * Intent GoldPlus has already recorded for this query (seo_queries.intent),
   * with the provenance that makes it trustworthy or not. Lexical rules must
   * never overwrite this: a weaker layer erasing stronger evidence is exactly
   * how populated intent data ended up reported as UNKNOWN.
   */
  persisted?: {
    intent: Intent | null;
    /** seo_queries.evidence_state — OBSERVED/VERIFIED outrank INFERRED. */
    evidenceState?: string | null;
    observedAt?: string | null;
  } | null;
}): IntentResult {
  // Evidence precedence, highest first. A recorded VERIFIED/OBSERVED intent is
  // stronger than anything a regex can infer from the words alone.
  const persisted = input.persisted;
  const STRONG_EVIDENCE = ['VERIFIED', 'OBSERVED', 'MANAGEMENT_SUPPLIED'];
  if (persisted?.intent && persisted.intent !== 'UNKNOWN'
      && STRONG_EVIDENCE.includes(String(persisted.evidenceState ?? '').toUpperCase())) {
    return {
      primary: persisted.intent,
      secondary: null,
      confidence: 0.95,
      method: 'PERSISTED',
      matched: [`PERSISTED:${persisted.evidenceState}`],
    };
  }
  const n = normalizeQuery(input.raw);
  const matched: string[] = [];
  const hits: Intent[] = [];

  for (const rule of INTENT_RULES) {
    for (const p of rule.patterns) {
      if (p.test(n.normalized)) {
        hits.push(rule.intent);
        matched.push(`${rule.intent}:${p.source}`);
        break;
      }
    }
  }

  const brand = input.isBrandQuery || /\bgoldplus\b/.test(n.normalized);
  if (brand) { hits.unshift('BRAND'); matched.push('BRAND:goldplus'); }

  const entityIntent: Intent | null =
    input.entityType === 'PRODUCT' ? 'PRODUCT'
    : input.entityType === 'CATEGORY' ? 'CATEGORY'
    : input.entityType === 'COMPATIBILITY' ? 'COMPATIBILITY'
    : null;

  // A modifier (compatibility/price/comparison/aftersales/problem) describes
  // what the searcher actually wants and outranks the bare entity type.
  const MODIFIERS: Intent[] = ['COMPATIBILITY', 'PRICE', 'COMPARISON', 'AFTERSALES', 'PROBLEM_SOLUTION', 'LOCAL'];
  const modifier = hits.find((h) => MODIFIERS.includes(h)) ?? null;

  let primary: Intent;
  let secondary: Intent | null = null;
  let method: IntentMethod = 'RULE';

  if (modifier) {
    primary = modifier;
    secondary = entityIntent ?? hits.find((h) => h !== modifier) ?? null;
    method = entityIntent ? 'HYBRID' : 'RULE';
  } else if (entityIntent) {
    primary = entityIntent;
    secondary = hits.find((h) => h !== entityIntent) ?? null;
    method = 'ENTITY';
  } else if (hits.length > 0) {
    primary = hits[0];
    secondary = hits[1] ?? null;
  } else if (persisted?.intent && persisted.intent !== 'UNKNOWN') {
    // Inferred persisted evidence is weaker than a rule hit, but far stronger
    // than giving up and reporting UNKNOWN while the answer sits in the table.
    primary = persisted.intent;
    method = 'PERSISTED';
    matched.push(`PERSISTED:${persisted.evidenceState ?? 'INFERRED'}`);
  } else {
    primary = 'UNKNOWN';
    method = 'RULE';
  }

  const confidence = primary === 'UNKNOWN' ? 0.2 : method === 'PERSISTED' ? 0.7 : method === 'HYBRID' ? 0.9 : method === 'ENTITY' ? 0.8 : matched.length > 1 ? 0.75 : 0.6;
  return { primary, secondary: secondary === primary ? null : secondary, confidence, method, matched };
}

// ── Page ownership ──────────────────────────────────────────────────────────

export const OWNER_TYPES = ['PRODUCT', 'CATEGORY', 'COMPATIBILITY', 'BUYER_GUIDE', 'SUPPORT', 'LOCAL', 'NO_PAGE_REQUIRED'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const OWNERSHIP_DECISIONS = [
  'CURRENT_OWNER_CORRECT', 'IMPROVE_EXISTING_PAGE', 'REINFORCE_INTERNAL_SIGNALS',
  'CONTENT_DIFFERENTIATION', 'CREATE_PAGE_CANDIDATE', 'NO_PAGE_REQUIRED', 'INSUFFICIENT_EVIDENCE',
] as const;
export type OwnershipDecision = (typeof OWNERSHIP_DECISIONS)[number];

/**
 * Which page type SHOULD own an intent, or null when the intent is not
 * understood well enough to say. Null is not NO_PAGE_REQUIRED — see §33.
 */
export function preferredOwnerType(intent: Intent): OwnerType | null {
  switch (intent) {
    case 'PRODUCT': return 'PRODUCT';
    case 'CATEGORY': case 'TRANSACTIONAL': return 'CATEGORY';
    case 'COMPATIBILITY': return 'COMPATIBILITY';
    case 'COMPARISON': case 'INFORMATIONAL': case 'PRICE': return 'BUYER_GUIDE';
    case 'AFTERSALES': case 'PROBLEM_SOLUTION': return 'SUPPORT';
    case 'LOCAL': return 'LOCAL';
    // Brand and navigational demand is genuinely already served — this is a
    // decision, made deliberately.
    case 'BRAND': case 'NAVIGATIONAL': return 'NO_PAGE_REQUIRED';
    // Everything else, INCLUDING UNKNOWN, must NOT reach NO_PAGE_REQUIRED.
    // "we could not determine the intent" and "GoldPlus deliberately should
    // not maintain a page for this" are opposite statements, and collapsing
    // them silently retires demand nobody ever evaluated.
    default: return null;
  }
}

/** How we came to believe a page currently owns the demand. */
export const OWNER_EVIDENCE = [
  /** A provider observed this page receiving the query. Strongest. */
  'PROVIDER_OBSERVED',
  /** The cluster resolves to an entity that owns a canonical route. */
  'CANONICAL_ENTITY_ROUTE',
  /** Internal link graph points at this page for the intent. */
  'INTERNAL_LINK_GRAPH',
  /** The query text appears in the URL. Weak — never authoritative. */
  'URL_LEXICAL_FALLBACK',
  /** Nothing supports a claim about current ownership. */
  'NONE',
] as const;
export type OwnerEvidence = (typeof OWNER_EVIDENCE)[number];

export interface OwnershipInput {
  intent: Intent;
  currentOwnerUrl: string | null;
  currentOwnerType: OwnerType | null;
  /**
   * What supports the current-owner claim. URL_LEXICAL_FALLBACK is explicitly
   * NOT authoritative: a URL containing the query is a coincidence of wording,
   * not a domain model, and treating it as ownership produced false
   * NO_PAGE_REQUIRED decisions.
   */
  currentOwnerEvidence?: OwnerEvidence;
  /** The canonical route of the entity this cluster resolves to, if any. */
  entityCanonicalUrl?: string | null;
  entityOwnerType?: OwnerType | null;
  /** Catalogue truth: enough real products to justify a page at all. */
  catalogueReady?: boolean;
  /** Technical eligibility: indexable, canonical-clean, alive. */
  seoEligible?: boolean;
  /** Does a suitable page already exist for the preferred type? */
  candidateUrl: string | null;
  contentThin: boolean;
  hasCommercialDepth: boolean;
  /** Do we have performance evidence for this cluster at all? */
  demandKnown: boolean;
}

export interface OwnershipResult {
  /** Null when the intent is not understood well enough to decide. */
  preferredOwnerType: OwnerType | null;
  preferredOwnerUrl: string | null;
  preferredOwnerReason: string;
  preferredOwnerConfidence: number;
  /**
   * Which page currently owns the demand — a question about observed reality.
   * Separate from the preferred owner, which is a question about what GoldPlus
   * business and SEO truth says SHOULD own it. Before a provider is connected
   * the honest answer here is usually null.
   */
  currentOwnerUrl: string | null;
  currentOwnerEvidence: OwnerEvidence;
  currentOwnerConfidence: number;
  decision: OwnershipDecision;
  rationale: string;
  /** Set when the preferred owner is correct but cannot yet be shipped. */
  blocker: string | null;
}

export function resolveOwnership(i: OwnershipInput): OwnershipResult {
  const preferred = preferredOwnerType(i.intent);

  // Current ownership is a claim about observed reality, and a URL that
  // happens to contain the query text does not support one. Anything weaker
  // than a canonical entity route is recorded but not believed.
  const evidence: OwnerEvidence = i.currentOwnerEvidence ?? (i.currentOwnerUrl ? 'URL_LEXICAL_FALLBACK' : 'NONE');
  const currentTrusted = evidence === 'PROVIDER_OBSERVED' || evidence === 'CANONICAL_ENTITY_ROUTE';
  const currentOwnerUrl = currentTrusted ? i.currentOwnerUrl : null;
  const currentOwnerConfidence =
    evidence === 'PROVIDER_OBSERVED' ? 0.95
    : evidence === 'CANONICAL_ENTITY_ROUTE' ? 0.7
    : evidence === 'INTERNAL_LINK_GRAPH' ? 0.5
    : 0;

  const base = { currentOwnerUrl, currentOwnerEvidence: evidence, currentOwnerConfidence };

  // Intent not understood: say so. This must never become NO_PAGE_REQUIRED,
  // which asserts a deliberate decision nobody made.
  if (preferred === null) {
    return {
      ...base,
      preferredOwnerType: null,
      preferredOwnerUrl: null,
      preferredOwnerReason: 'The intent behind this demand is not yet understood, so no page type can be named as its owner.',
      preferredOwnerConfidence: 0,
      decision: 'INSUFFICIENT_EVIDENCE',
      rationale: 'Intent is UNKNOWN. This is missing knowledge, not a decision that no page is needed.',
      blocker: 'INTENT_UNKNOWN',
    };
  }

  if (preferred === 'NO_PAGE_REQUIRED') {
    return {
      ...base,
      preferredOwnerType: preferred,
      preferredOwnerUrl: currentOwnerUrl,
      preferredOwnerReason: 'Brand and navigational demand already resolves to GoldPlus; a dedicated page would add nothing.',
      preferredOwnerConfidence: 0.9,
      decision: 'NO_PAGE_REQUIRED',
      rationale: 'A deliberate decision: this intent is already served and needs no distinct page.',
      blocker: null,
    };
  }

  // The preferred owner comes from the entity, not from string matching. If
  // the cluster resolves to a real entity with a canonical route, that route
  // is the answer whether or not any URL mentions the query.
  const entityUrl = i.entityCanonicalUrl ?? null;
  // When the incumbent is the wrong page TYPE for this intent, it cannot be
  // the preferred owner however strong the evidence that it currently ranks.
  const wrongType = i.currentOwnerType !== null && i.currentOwnerType !== preferred;
  // Weak evidence is discarded as an OWNERSHIP claim but retained as proof
  // that a page exists at all — otherwise the engine recommends creating a
  // page that is already there.
  const preferredUrl = entityUrl
    ?? (wrongType ? i.candidateUrl : i.currentOwnerUrl)
    ?? i.candidateUrl ?? i.currentOwnerUrl ?? null;
  const preferredConfidence = entityUrl ? 0.85 : preferredUrl ? 0.6 : 0.4;
  const reason = entityUrl
    ? `${i.intent} demand belongs on the ${preferred} page for the entity this cluster resolves to.`
    : `${preferred} is the right page type for ${i.intent} demand, but no canonical route has been identified yet.`;

  const withPreferred = {
    ...base,
    preferredOwnerType: preferred,
    preferredOwnerUrl: preferredUrl,
    preferredOwnerReason: reason,
    preferredOwnerConfidence: preferredConfidence,
  };

  // A correct preferred owner that cannot ship is BLOCKED VALUE — it must stay
  // visible rather than vanish because current ownership is unresolved.
  if (i.catalogueReady === false) {
    return {
      ...withPreferred,
      decision: 'INSUFFICIENT_EVIDENCE',
      rationale: 'The right page type is known, but the catalogue cannot support it yet. Shipping now would produce a thin page.',
      blocker: 'CATALOGUE_THIN',
    };
  }
  if (i.seoEligible === false) {
    return {
      ...withPreferred,
      decision: 'IMPROVE_EXISTING_PAGE',
      rationale: 'The right page owns this demand but is not currently eligible to rank for it.',
      blocker: 'INDEXABILITY',
    };
  }

  if (!preferredUrl) {
    // No page exists. Whether to create one depends on catalogue depth, not on
    // the absence of a URL.
    if (!i.hasCommercialDepth) {
      return {
        ...withPreferred,
        decision: 'INSUFFICIENT_EVIDENCE',
        rationale: 'No page owns this demand and the catalogue cannot support one yet. Creating a page here would produce a thin result.',
        blocker: 'CATALOGUE_THIN',
      };
    }
    return {
      ...withPreferred,
      decision: 'CREATE_PAGE_CANDIDATE',
      rationale: 'No page owns this demand and the catalogue can support a genuine one.',
      blocker: null,
    };
  }

  if (wrongType && currentTrusted) {
    return {
      ...withPreferred,
      decision: 'CONTENT_DIFFERENTIATION',
      rationale: `A ${i.currentOwnerType} page is answering ${i.intent} demand; a ${preferred} page is the better owner.`,
      blocker: null,
    };
  }
  if (i.contentThin) {
    return {
      ...withPreferred,
      decision: 'IMPROVE_EXISTING_PAGE',
      rationale: 'The right page owns this demand but does not answer it fully.',
      blocker: 'CONTENT',
    };
  }
  if (!currentTrusted) {
    // We know where this SHOULD live; we have no evidence about where the
    // demand actually lands. Those are different unknowns and both are stated.
    return {
      ...withPreferred,
      decision: 'INSUFFICIENT_EVIDENCE',
      rationale: 'The preferred owner is identified from catalogue truth, but no connected provider has reported which page actually receives this demand.',
      blocker: 'WAITING_FOR_PROVIDER',
    };
  }
  if (!i.demandKnown) {
    return {
      ...withPreferred,
      decision: 'INSUFFICIENT_EVIDENCE',
      rationale: 'The page looks correct, but without search-performance evidence we cannot confirm it is winning the demand.',
      blocker: 'WAITING_FOR_PROVIDER',
    };
  }

  // Both known and in agreement.
  if (currentOwnerUrl && preferredUrl && currentOwnerUrl !== preferredUrl) {
    return {
      ...withPreferred,
      decision: 'CONTENT_DIFFERENTIATION',
      rationale: 'The page receiving this demand is not the page that should own it.',
      blocker: 'QUERY_PAGE_MISMATCH',
    };
  }
  return {
    ...withPreferred,
    decision: 'CURRENT_OWNER_CORRECT',
    rationale: 'The right page type owns this demand and answers it adequately.',
    blocker: null,
  };
}

/**
 * Agreement across the intents recorded for a cluster's member queries.
 *
 * Two failure modes are avoided deliberately. Collapsing every disagreement to
 * UNKNOWN throws away real evidence — a cluster where four of five queries are
 * COMMERCIAL is not a mystery. Manufacturing consensus from a genuine split is
 * worse, because it hides a cluster that should probably be two.
 */
export function intentConsensus(intents: string[]): {
  state: 'CONSENSUS' | 'MAJORITY' | 'MIXED' | 'CONFLICTING' | 'UNKNOWN';
  intent: string | null;
  evidenceState: string;
  agreement: number;
} {
  const values = (intents ?? []).filter((v) => v && v !== 'UNKNOWN');
  if (values.length === 0) {
    return { state: 'UNKNOWN', intent: null, evidenceState: 'UNKNOWN', agreement: 0 };
  }

  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Sort by count, then by name, so the result never depends on input order.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [top, topCount] = ranked[0];
  const agreement = topCount / values.length;

  if (counts.size === 1) {
    return { state: 'CONSENSUS', intent: top, evidenceState: 'OBSERVED', agreement: 1 };
  }
  if (agreement >= 0.6) {
    return { state: 'MAJORITY', intent: top, evidenceState: 'OBSERVED', agreement };
  }
  // An even split between two intents is a signal the cluster spans two
  // different questions, not a reason to invent an answer.
  if (ranked.length === 2 && ranked[0][1] === ranked[1][1]) {
    return { state: 'CONFLICTING', intent: null, evidenceState: 'INFERRED', agreement };
  }
  return { state: 'MIXED', intent: top, evidenceState: 'INFERRED', agreement };
}

// ── Cannibalisation ─────────────────────────────────────────────────────────

export const CANNIBALISATION_CLASSES = [
  'BENIGN_MULTI_URL', 'INTENT_SPLIT', 'TRUE_CANNIBALISATION', 'CANONICAL_CONFLICT',
  'CONTENT_OVERLAP', 'INTERNAL_LINK_SIGNAL_PROBLEM', 'LIFECYCLE_CONFLICT',
  'TEMPORARY_RANKING_VARIANCE', 'INSUFFICIENT_EVIDENCE',
] as const;
export type CannibalisationClass = (typeof CANNIBALISATION_CLASSES)[number];

export interface CannibalisationInput {
  /** URLs seen for the same cluster, with what evidence we have. */
  urls: Array<{
    url: string;
    impressions: number | null;
    clicks: number | null;
    intent: Intent;
    ownerType: OwnerType | null;
    canonicalTarget: string | null;
    contentSimilarity: number | null;
    lifecycleActive: boolean;
  }>;
  /** Observations this pattern has persisted across. */
  persistence: number;
}

export interface CannibalisationResult {
  classification: CannibalisationClass;
  confidence: number;
  rationale: string;
  affectedUrls: string[];
}

/** A pattern must hold this long before it is more than variance. */
export const CANNIBALISATION_PERSISTENCE = 2;

export function classifyCannibalisation(i: CannibalisationInput): CannibalisationResult {
  const urls = i.urls ?? [];
  const affected = urls.map((u) => u.url);

  if (urls.length < 2) {
    return { classification: 'BENIGN_MULTI_URL', confidence: 0.9, rationale: 'Only one URL is involved; there is nothing to cannibalise.', affectedUrls: affected };
  }

  // Canonical conflict is a defect regardless of traffic, so it is checked
  // before any evidence-strength gate.
  const conflicting = urls.filter((u) => u.canonicalTarget && u.canonicalTarget !== u.url);
  if (conflicting.length > 0 && new Set(urls.map((u) => u.canonicalTarget ?? u.url)).size > 1) {
    return {
      classification: 'CANONICAL_CONFLICT',
      confidence: 0.85,
      rationale: 'These URLs declare different canonicals while competing for the same demand — a correctness defect, not a content problem.',
      affectedUrls: affected,
    };
  }

  const retired = urls.filter((u) => !u.lifecycleActive);
  if (retired.length > 0 && retired.length < urls.length) {
    return {
      classification: 'LIFECYCLE_CONFLICT',
      confidence: 0.8,
      rationale: 'A retired page is competing with a live one; the lifecycle decision should settle ownership.',
      affectedUrls: affected,
    };
  }

  const distinctIntents = new Set(urls.map((u) => u.intent));
  if (distinctIntents.size > 1) {
    return {
      classification: 'INTENT_SPLIT',
      confidence: 0.75,
      rationale: 'The URLs serve genuinely different intents. This is healthy coverage, not cannibalisation.',
      affectedUrls: affected,
    };
  }

  const haveEvidence = urls.every((u) => u.impressions !== null);
  if (!haveEvidence) {
    return {
      classification: 'INSUFFICIENT_EVIDENCE',
      confidence: 0.3,
      rationale: 'Multiple URLs share this cluster, but without search-performance evidence no conflict can be asserted.',
      affectedUrls: affected,
    };
  }
  if (i.persistence < CANNIBALISATION_PERSISTENCE) {
    return {
      classification: 'TEMPORARY_RANKING_VARIANCE',
      confidence: 0.5,
      rationale: 'Seen too briefly to distinguish from ordinary ranking movement.',
      affectedUrls: affected,
    };
  }

  const similar = urls.filter((u) => (u.contentSimilarity ?? 0) >= 0.8);
  if (similar.length >= 2) {
    return {
      classification: 'CONTENT_OVERLAP',
      confidence: 0.8,
      rationale: 'Near-duplicate content on the same intent — the pages should be differentiated or consolidated.',
      affectedUrls: affected,
    };
  }

  // Real conflict: same intent, both meaningfully visible, persistent.
  const meaningful = urls.filter((u) => (u.impressions ?? 0) >= 50);
  if (meaningful.length >= 2) {
    return {
      classification: 'TRUE_CANNIBALISATION',
      confidence: 0.8,
      rationale: 'Two pages of the same type and intent are both drawing meaningful impressions and splitting the signal.',
      affectedUrls: meaningful.map((u) => u.url),
    };
  }

  return {
    classification: 'BENIGN_MULTI_URL',
    confidence: 0.7,
    rationale: 'A secondary URL appears occasionally but takes no meaningful share.',
    affectedUrls: affected,
  };
}

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

export const INTENT_METHODS = ['RULE', 'ENTITY', 'SEMANTIC', 'HYBRID'] as const;
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
}): IntentResult {
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
  } else {
    primary = 'UNKNOWN';
    method = 'RULE';
  }

  const confidence = primary === 'UNKNOWN' ? 0.2 : method === 'HYBRID' ? 0.9 : method === 'ENTITY' ? 0.8 : matched.length > 1 ? 0.75 : 0.6;
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

/** Which page type SHOULD own an intent. */
export function preferredOwnerType(intent: Intent): OwnerType {
  switch (intent) {
    case 'PRODUCT': return 'PRODUCT';
    case 'CATEGORY': case 'TRANSACTIONAL': return 'CATEGORY';
    case 'COMPATIBILITY': return 'COMPATIBILITY';
    case 'COMPARISON': case 'INFORMATIONAL': case 'PRICE': return 'BUYER_GUIDE';
    case 'AFTERSALES': case 'PROBLEM_SOLUTION': return 'SUPPORT';
    case 'LOCAL': return 'LOCAL';
    case 'BRAND': case 'NAVIGATIONAL': return 'NO_PAGE_REQUIRED';
    default: return 'NO_PAGE_REQUIRED';
  }
}

export interface OwnershipInput {
  intent: Intent;
  currentOwnerUrl: string | null;
  currentOwnerType: OwnerType | null;
  /** Does a suitable page already exist for the preferred type? */
  candidateUrl: string | null;
  contentThin: boolean;
  hasCommercialDepth: boolean;
  /** Do we have performance evidence for this cluster at all? */
  demandKnown: boolean;
}

export interface OwnershipResult {
  preferredOwnerType: OwnerType;
  preferredOwnerUrl: string | null;
  decision: OwnershipDecision;
  rationale: string;
}

export function resolveOwnership(i: OwnershipInput): OwnershipResult {
  const preferred = preferredOwnerType(i.intent);

  if (preferred === 'NO_PAGE_REQUIRED') {
    return {
      preferredOwnerType: preferred,
      preferredOwnerUrl: i.currentOwnerUrl,
      decision: 'NO_PAGE_REQUIRED',
      rationale: 'Brand and navigational demand is already served; a dedicated page would add nothing.',
    };
  }

  if (!i.currentOwnerUrl && !i.candidateUrl) {
    // The trap this guards: "no page exists" does NOT mean "create a page".
    // Without commercial depth a new page is a thin page.
    if (!i.hasCommercialDepth) {
      return {
        preferredOwnerType: preferred,
        preferredOwnerUrl: null,
        decision: 'INSUFFICIENT_EVIDENCE',
        rationale: 'No page owns this demand and the catalogue cannot support one yet. Creating a page here would produce a thin result.',
      };
    }
    return {
      preferredOwnerType: preferred,
      preferredOwnerUrl: null,
      decision: 'CREATE_PAGE_CANDIDATE',
      rationale: 'No page owns this demand and the catalogue can support a genuine one.',
    };
  }

  const owner = i.currentOwnerUrl ?? i.candidateUrl;
  const typeMismatch = i.currentOwnerType !== null && i.currentOwnerType !== preferred;

  if (typeMismatch) {
    return {
      preferredOwnerType: preferred,
      preferredOwnerUrl: i.candidateUrl ?? owner,
      decision: 'CONTENT_DIFFERENTIATION',
      rationale: `A ${i.currentOwnerType} page is answering ${i.intent} demand; a ${preferred} page is the better owner.`,
    };
  }
  if (i.contentThin) {
    return { preferredOwnerType: preferred, preferredOwnerUrl: owner, decision: 'IMPROVE_EXISTING_PAGE', rationale: 'The right page owns this demand but does not answer it fully.' };
  }
  if (!i.demandKnown) {
    return {
      preferredOwnerType: preferred,
      preferredOwnerUrl: owner,
      decision: 'INSUFFICIENT_EVIDENCE',
      rationale: 'The page looks correct, but without search-performance evidence we cannot confirm it is winning the demand.',
    };
  }
  return { preferredOwnerType: preferred, preferredOwnerUrl: owner, decision: 'CURRENT_OWNER_CORRECT', rationale: 'The right page type owns this demand and answers it adequately.' };
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

import { describe, expect, it } from 'vitest';

import {
  normalizeQuery, clusterQueries, classifyIntent, intentConsensus,
  resolveOwnership, preferredOwnerType,
  type ClusterEntity,
} from '../../apps/api/src/application/use-cases/seo-growth/QueryIntelligence';

/**
 * The semantic golden corpus.
 *
 * This is regression truth, NOT production search volume — no number here is a
 * measurement of demand, and nothing in it should ever be read as evidence
 * about what people actually search for. Its only job is to pin the meaning
 * decisions that must not drift.
 *
 * Two failure directions are equally serious. Splitting "battery" from
 * "batteries" fragments a real commercial cluster. Merging "iPhone 15" with
 * "iPhone 15 Pro" destroys product identity. A change that fixes one by
 * breaking the other is not an improvement.
 */

const ENTITIES: ClusterEntity[] = [
  { entityId: 'cat-battery', entityType: 'CATEGORY', label: 'Phone Batteries', terms: ['phone', 'battery', 'batteries', 'samsung'] },
  { entityId: 'cat-power', entityType: 'CATEGORY', label: 'Power Banks', terms: ['power', 'bank', 'powerbank'] },
  { entityId: 'cat-audio', entityType: 'CATEGORY', label: 'Audio', terms: ['earphone', 'headphone', 'earbud', 'speaker'] },
  { entityId: 'cat-storage', entityType: 'CATEGORY', label: 'Storage', terms: ['flash', 'drive', 'card', 'memory'] },
];

// ── Safe morphology (§19) ───────────────────────────────────────────────────

describe('safe singular/plural collapse across GoldPlus product families', () => {
  const MUST_MERGE: Array<[string, string, string]> = [
    ['PHONE_BATTERY', 'samsung battery', 'samsung batteries'],
    ['POWER', 'solar inverter', 'solar inverters'],
    ['AUDIO', 'bluetooth earphone', 'bluetooth earphones'],
    ['AUDIO', 'gaming headphone', 'gaming headphones'],
    ['STORAGE', 'memory card', 'memory cards'],
    ['STORAGE', 'flash drive', 'flash drives'],
    ['COMPUTER_ACCESSORY', 'laptop charger', 'laptop chargers'],
    ['COMPUTER_ACCESSORY', 'usb cable', 'usb cables'],
    ['CAR_ACCESSORY', 'phone holder', 'phone holders'],
    ['CAR_ACCESSORY', 'car charger', 'car chargers'],
    ['POWER', 'solar panel', 'solar panels'],
    ['GENERAL', 'phone accessory', 'phone accessories'],
  ];

  for (const [family, singular, plural] of MUST_MERGE) {
    it(`${family}: "${singular}" and "${plural}" normalise identically`, () => {
      expect(normalizeQuery(plural).normalized).toBe(normalizeQuery(singular).normalized);
    });
  }
});

// ── Commercial identity preservation (§20) ──────────────────────────────────

describe('tokens that identify a different product must never merge', () => {
  const MUST_NOT_MERGE: Array<[string, string, string]> = [
    ['model suffix', 'iphone 15', 'iphone 15 pro'],
    ['model suffix', 'iphone 15 pro', 'iphone 15 pro max'],
    ['model suffix', 'samsung s24', 'samsung s24 ultra'],
    ['model suffix', 'samsung s24', 'samsung s24 plus'],
    ['capacity', '128gb flash drive', '256gb flash drive'],
    ['capacity', '256gb memory card', '512gb memory card'],
    ['power rating', '20w charger', '25w charger'],
    ['power rating', '25w charger', '45w charger'],
    ['capacity', '10000mah power bank', '20000mah power bank'],
    ['part number', 'eb-bg991aby battery', 'eb-bg996aby battery'],
    ['product family', 'usb c cable', 'micro usb cable'],
  ];

  for (const [why, a, b] of MUST_NOT_MERGE) {
    it(`${why}: "${a}" stays distinct from "${b}"`, () => {
      expect(normalizeQuery(a).normalized).not.toBe(normalizeQuery(b).normalized);
    });
  }

  it('preserves the capacity token itself rather than stripping the digits', () => {
    expect(normalizeQuery('128 GB flash drives').normalized).toContain('128gb');
  });

  it('preserves a wattage token through pluralisation of the noun', () => {
    const n = normalizeQuery('45W laptop chargers').normalized;
    expect(n).toContain('45w');
    expect(n).toContain('charger');
  });
});

// ── Metamorphic properties (§21, §23) ───────────────────────────────────────

describe('normalisation is deterministic, idempotent and order-independent', () => {
  const SAMPLES = [
    'Samsung Batteries', 'samsung   batteries', 'SAMSUNG BATTERIES!',
    'iPhone 15 Pro Max', '128GB Memory Cards', '45W Chargers',
    'power bank 20000mAh', 'ear phones', 'flash disk', 'Type-C cable',
    'GoldPlus batteries', 'solar panels in kampala',
  ];

  for (const s of SAMPLES) {
    it(`idempotent for "${s}"`, () => {
      const once = normalizeQuery(s).normalized;
      // NORMALIZE(NORMALIZE(x)) === NORMALIZE(x)
      expect(normalizeQuery(once).normalized).toBe(once);
    });
  }

  it('case changes do not alter the normalised form', () => {
    expect(normalizeQuery('SAMSUNG BATTERIES').normalized).toBe(normalizeQuery('samsung batteries').normalized);
  });

  it('whitespace changes do not alter the normalised form', () => {
    expect(normalizeQuery('  samsung   batteries  ').normalized).toBe(normalizeQuery('samsung batteries').normalized);
  });

  it('punctuation-only changes do not alter the normalised form', () => {
    expect(normalizeQuery('samsung, batteries!').normalized).toBe(normalizeQuery('samsung batteries').normalized);
  });

  it('unicode input does not throw or produce an empty form', () => {
    const n = normalizeQuery('batterié samsung üñî').normalized;
    expect(n.length).toBeGreaterThan(0);
  });

  it('is pure — the same input always yields the same output', () => {
    const a = normalizeQuery('Samsung Batteries 128GB').normalized;
    const b = normalizeQuery('Samsung Batteries 128GB').normalized;
    expect(a).toBe(b);
  });
});

// ── Cluster stability (§24) ─────────────────────────────────────────────────

describe('cluster identity does not depend on the order queries arrive in', () => {
  const QUERIES = [
    'samsung battery', 'samsung batteries', 'samsung battery price',
    'power bank 20000mah', 'powerbank', 'bluetooth earphones', 'earphone',
  ];

  const keysFor = (qs: string[]) =>
    clusterQueries(qs.map((raw) => ({ raw })), ENTITIES).map((c) => c.clusterKey).sort();

  it('produces the same clusters regardless of input order', () => {
    const forward = keysFor(QUERIES);
    const reversed = keysFor([...QUERIES].reverse());
    // Reversing the ingestion order must not re-partition the universe.
    expect(reversed).toEqual(forward);
  });

  it('produces the same clusters on a repeated run', () => {
    expect(keysFor(QUERIES)).toEqual(keysFor(QUERIES));
  });

  it('does not encode a counter, rank or timestamp in the cluster key', () => {
    for (const key of keysFor(QUERIES)) {
      expect(key).not.toMatch(/\d{10}|run|rank|#\d+/);
    }
  });
});

// ── The golden scenario (§53) ───────────────────────────────────────────────

describe('golden scenario: samsung battery / samsung batteries', () => {
  const QUERIES = ['samsung battery', 'samsung batteries'];

  it('normalises to one form', () => {
    const [a, b] = QUERIES.map((q) => normalizeQuery(q).normalized);
    expect(a).toBe(b);
  });

  it('produces exactly one cluster', () => {
    const clusters = clusterQueries(QUERIES.map((raw) => ({ raw })), ENTITIES);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
  });

  it('associates with the battery entity rather than clustering blind', () => {
    const [cluster] = clusterQueries(QUERIES.map((raw) => ({ raw })), ENTITIES);
    expect(cluster.entityId).toBe('cat-battery');
  });

  it('resolves ownership from the entity, with no URL substring required', () => {
    const result = resolveOwnership({
      intent: 'CATEGORY',
      currentOwnerUrl: null,
      currentOwnerType: null,
      currentOwnerEvidence: 'NONE',
      entityCanonicalUrl: '/phone-batteries',
      entityOwnerType: 'CATEGORY',
      catalogueReady: true,
      seoEligible: true,
      candidateUrl: null,
      contentThin: false,
      hasCommercialDepth: true,
      demandKnown: false,
    });
    expect(result.preferredOwnerUrl).toBe('/phone-batteries');
    expect(result.decision).not.toBe('NO_PAGE_REQUIRED');
  });
});

// ── Intent evidence precedence (§25–§27) ────────────────────────────────────

describe('recorded intent evidence outranks anything re-derived from wording', () => {
  it('uses persisted VERIFIED intent instead of returning UNKNOWN', () => {
    const r = classifyIntent({
      raw: 'zzz unmatchable token',
      persisted: { intent: 'COMMERCIAL' as never, evidenceState: 'VERIFIED' },
    });
    expect(r.primary).toBe('COMMERCIAL');
    expect(r.method).toBe('PERSISTED');
  });

  it('uses persisted OBSERVED intent for a query with no lexical signal', () => {
    const r = classifyIntent({ raw: 'samsung battery', persisted: { intent: 'CATEGORY' as never, evidenceState: 'OBSERVED' } });
    expect(r.primary).toBe('CATEGORY');
  });

  it('still returns UNKNOWN when there is genuinely no evidence at all', () => {
    // Honesty in the other direction: absent evidence must not be invented.
    expect(classifyIntent({ raw: 'zzz unmatchable token' }).primary).toBe('UNKNOWN');
  });

  it('does not let weak persisted evidence erase a strong lexical signal', () => {
    const r = classifyIntent({
      raw: 'does this fit my galaxy s21',
      persisted: { intent: 'INFORMATIONAL' as never, evidenceState: 'INFERRED' },
    });
    // "does this fit" is unambiguous compatibility demand.
    expect(r.primary).toBe('COMPATIBILITY');
  });
});

describe('intent consensus reports disagreement instead of hiding it', () => {
  it('reports CONSENSUS when every member agrees', () => {
    const c = intentConsensus(['COMMERCIAL', 'COMMERCIAL', 'COMMERCIAL']);
    expect(c.state).toBe('CONSENSUS');
    expect(c.intent).toBe('COMMERCIAL');
  });

  it('reports MAJORITY without discarding the evidence', () => {
    const c = intentConsensus(['COMMERCIAL', 'COMMERCIAL', 'COMMERCIAL', 'COMMERCIAL', 'PRICE']);
    expect(c.state).toBe('MAJORITY');
    expect(c.intent).toBe('COMMERCIAL');
  });

  it('reports CONFLICTING rather than inventing a winner on an even split', () => {
    const c = intentConsensus(['COMMERCIAL', 'PRICE']);
    expect(c.state).toBe('CONFLICTING');
    expect(c.intent).toBeNull();
  });

  it('reports UNKNOWN only when there is no usable evidence', () => {
    expect(intentConsensus([]).state).toBe('UNKNOWN');
    expect(intentConsensus(['UNKNOWN', 'UNKNOWN']).state).toBe('UNKNOWN');
  });

  it('is independent of the order the intents arrive in', () => {
    const a = intentConsensus(['COMMERCIAL', 'PRICE', 'COMMERCIAL']);
    const b = intentConsensus(['PRICE', 'COMMERCIAL', 'COMMERCIAL']);
    expect(b).toEqual(a);
  });
});

// ── UNKNOWN is not NO_PAGE_REQUIRED (§33) ───────────────────────────────────

describe('an unresolved intent is never reported as a deliberate decision', () => {
  it('returns null rather than NO_PAGE_REQUIRED for UNKNOWN intent', () => {
    expect(preferredOwnerType('UNKNOWN' as never)).toBeNull();
  });

  it('keeps NO_PAGE_REQUIRED for intents where it is genuinely correct', () => {
    // Brand demand really does not need its own page — that is a decision.
    expect(preferredOwnerType('BRAND' as never)).toBe('NO_PAGE_REQUIRED');
  });

  it('reports INSUFFICIENT_EVIDENCE, not NO_PAGE_REQUIRED, when intent is unknown', () => {
    const r = resolveOwnership({
      intent: 'UNKNOWN' as never,
      currentOwnerUrl: null, currentOwnerType: null,
      candidateUrl: null, contentThin: false, hasCommercialDepth: true, demandKnown: false,
    });
    expect(r.decision).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.decision).not.toBe('NO_PAGE_REQUIRED');
    expect(r.blocker).toBe('INTENT_UNKNOWN');
  });
});

// ── URL substring is not authority (§29) ────────────────────────────────────

describe('a URL containing the query text does not establish ownership', () => {
  it('refuses to treat a lexical URL match as the current owner', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY',
      currentOwnerUrl: '/samsung-battery-blog-post',
      currentOwnerType: 'CATEGORY',
      currentOwnerEvidence: 'URL_LEXICAL_FALLBACK',
      entityCanonicalUrl: '/phone-batteries',
      catalogueReady: true, seoEligible: true,
      candidateUrl: null, contentThin: false, hasCommercialDepth: true, demandKnown: false,
    });
    expect(r.currentOwnerUrl).toBeNull();
    expect(r.currentOwnerEvidence).toBe('URL_LEXICAL_FALLBACK');
    expect(r.currentOwnerConfidence).toBe(0);
    // The preferred owner still resolves, from the entity.
    expect(r.preferredOwnerUrl).toBe('/phone-batteries');
  });

  it('accepts a provider observation as genuine current ownership', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY',
      currentOwnerUrl: '/phone-batteries',
      currentOwnerType: 'CATEGORY',
      currentOwnerEvidence: 'PROVIDER_OBSERVED',
      entityCanonicalUrl: '/phone-batteries',
      catalogueReady: true, seoEligible: true,
      candidateUrl: null, contentThin: false, hasCommercialDepth: true, demandKnown: true,
    });
    expect(r.currentOwnerUrl).toBe('/phone-batteries');
    expect(r.currentOwnerConfidence).toBeGreaterThan(0.9);
    expect(r.decision).toBe('CURRENT_OWNER_CORRECT');
  });

  it('flags a mismatch when the observed page is not the preferred one', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY',
      currentOwnerUrl: '/blog/battery-guide',
      currentOwnerType: 'CATEGORY',
      currentOwnerEvidence: 'PROVIDER_OBSERVED',
      entityCanonicalUrl: '/phone-batteries',
      catalogueReady: true, seoEligible: true,
      candidateUrl: null, contentThin: false, hasCommercialDepth: true, demandKnown: true,
    });
    expect(r.blocker).toBe('QUERY_PAGE_MISMATCH');
  });
});

// ── Blocked preferred owner (§34, §50) ──────────────────────────────────────

describe('a correct preferred owner that cannot ship stays visible as blocked value', () => {
  it('keeps the category as preferred owner when the catalogue is too thin', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY',
      currentOwnerUrl: null, currentOwnerType: null, currentOwnerEvidence: 'NONE',
      entityCanonicalUrl: '/car-chargers',
      catalogueReady: false, seoEligible: true,
      candidateUrl: null, contentThin: false, hasCommercialDepth: false, demandKnown: false,
    });
    expect(r.preferredOwnerType).toBe('CATEGORY');
    expect(r.preferredOwnerUrl).toBe('/car-chargers');
    expect(r.blocker).toBe('CATALOGUE_THIN');
    // The two outcomes that would make the demand disappear.
    expect(r.decision).not.toBe('NO_PAGE_REQUIRED');
    expect(r.decision).not.toBe('CREATE_PAGE_CANDIDATE');
  });

  it('reports an indexability blocker without losing the preferred owner', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY',
      currentOwnerUrl: null, currentOwnerType: null, currentOwnerEvidence: 'NONE',
      entityCanonicalUrl: '/power-banks',
      catalogueReady: true, seoEligible: false,
      candidateUrl: null, contentThin: false, hasCommercialDepth: true, demandKnown: false,
    });
    expect(r.preferredOwnerUrl).toBe('/power-banks');
    expect(r.blocker).toBe('INDEXABILITY');
  });

  it('says WAITING_FOR_PROVIDER when only current ownership is unknown', () => {
    const r = resolveOwnership({
      intent: 'CATEGORY',
      currentOwnerUrl: null, currentOwnerType: null, currentOwnerEvidence: 'NONE',
      entityCanonicalUrl: '/phone-batteries',
      catalogueReady: true, seoEligible: true,
      candidateUrl: null, contentThin: false, hasCommercialDepth: true, demandKnown: false,
    });
    expect(r.preferredOwnerUrl).toBe('/phone-batteries');
    expect(r.blocker).toBe('WAITING_FOR_PROVIDER');
  });
});

// ── Fixture matrix across product families (§54) ────────────────────────────

describe('deterministic fixtures across every current GoldPlus family', () => {
  const FIXTURES: Array<{ family: string; query: string; expectIntent?: string }> = [
    { family: 'POWER', query: 'buy solar inverter uganda', expectIntent: 'LOCAL' },
    { family: 'POWER', query: 'power bank price', expectIntent: 'PRICE' },
    { family: 'AUDIO', query: 'earphones vs headphones', expectIntent: 'COMPARISON' },
    { family: 'AUDIO', query: 'my earphone is not working', expectIntent: 'PROBLEM_SOLUTION' },
    { family: 'STORAGE', query: 'how much is a 128gb memory card', expectIntent: 'PRICE' },
    { family: 'PHONE_BATTERY', query: 'does this battery fit my galaxy s21', expectIntent: 'COMPATIBILITY' },
    { family: 'PHONE_BATTERY', query: 'battery warranty', expectIntent: 'AFTERSALES' },
    { family: 'COMPUTER_ACCESSORY', query: 'what is usb c', expectIntent: 'INFORMATIONAL' },
    { family: 'CAR_ACCESSORY', query: 'car charger near me', expectIntent: 'LOCAL' },
    { family: 'GENERAL', query: 'goldplus', expectIntent: 'BRAND' },
  ];

  for (const f of FIXTURES) {
    it(`${f.family}: "${f.query}" resolves to ${f.expectIntent}`, () => {
      expect(classifyIntent({ raw: f.query }).primary).toBe(f.expectIntent);
    });
  }

  it('normalises every fixture without producing an empty form', () => {
    for (const f of FIXTURES) {
      expect(normalizeQuery(f.query).normalized.length).toBeGreaterThan(0);
    }
  });
});

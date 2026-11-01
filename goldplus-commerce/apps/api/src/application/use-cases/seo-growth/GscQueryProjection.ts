/**
 * Projection from provider observations into the semantic query universe.
 *
 * Two stores, two different jobs, and conflating them is the mistake this
 * module exists to avoid:
 *
 *   gsc_performance  is the METRIC source of truth. Its grain is
 *                    DATE x PAGE x QUERY — one row per observation.
 *   seo_queries      is the IDENTITY universe. Its grain is the query itself.
 *
 * The same phrase observed on twelve dates across three landing pages is
 * THIRTY-SIX observations but ONE query. Projecting per observation would
 * manufacture thirty-six identities, and every cluster, intent and ownership
 * decision downstream would be built on a fiction.
 *
 * Metrics are deliberately NOT copied here. Clicks and impressions stay in
 * gsc_performance, because a second mutable copy is a second truth, and the
 * two will disagree the first time a provider revises a period.
 */

import { normalizeQuery } from './QueryIntelligence';

/** One provider observation, at the canonical grain. */
export interface GscObservation {
  date: string;
  page: string;
  query: string;
  clicks: number;
  impressions: number;
}

/** A semantic query identity, ready to upsert. Carries no metrics. */
export interface ProjectedQuery {
  /** Exactly as the provider reported it. Never destroyed by our tidying. */
  raw: string;
  normalized: string;
  source: 'GSC';
  /** Most recent date this query was observed in the source window. */
  lastObservedAt: string;
  /** Observation count, for diagnostics only — not a stored metric. */
  observationCount: number;
}

export interface ProjectionResult {
  queries: ProjectedQuery[];
  /** Observations read, so conservation can be checked against the source. */
  observationsRead: number;
  /** Distinct identities produced. */
  identities: number;
  skippedEmpty: number;
}

/**
 * Collapse observations to identities.
 *
 * Identity is the NORMALIZED query, so "samsung battery" and "Samsung
 * Batteries" resolve to one subject — the same rule the rest of the query
 * layer already applies. The raw form kept is the first seen in deterministic
 * order, so the result does not depend on row ordering.
 */
export function projectObservationsToQueries(observations: GscObservation[]): ProjectionResult {
  const byIdentity = new Map<string, ProjectedQuery>();
  let skippedEmpty = 0;

  // Deterministic input order: the chosen raw form must not depend on the
  // order PostgreSQL happened to return rows in.
  const ordered = [...(observations ?? [])].sort((a, b) =>
    a.query.localeCompare(b.query) || a.date.localeCompare(b.date) || a.page.localeCompare(b.page));

  for (const o of ordered) {
    const raw = String(o?.query ?? '').trim();
    if (raw === '') { skippedEmpty += 1; continue; }

    const normalized = normalizeQuery(raw).normalized;
    if (normalized === '') { skippedEmpty += 1; continue; }

    const existing = byIdentity.get(normalized);
    if (!existing) {
      byIdentity.set(normalized, {
        raw, normalized, source: 'GSC',
        lastObservedAt: o.date,
        observationCount: 1,
      });
      continue;
    }
    existing.observationCount += 1;
    // last_seen may only move forward — a backfill delivering older dates must
    // never drag freshness backwards.
    if (o.date > existing.lastObservedAt) existing.lastObservedAt = o.date;
  }

  return {
    queries: [...byIdentity.values()].sort((a, b) => a.normalized.localeCompare(b.normalized)),
    observationsRead: (observations ?? []).length,
    identities: byIdentity.size,
    skippedEmpty,
  };
}

/**
 * Metric conservation over a fixed source snapshot.
 *
 * The states partition the observations, so the totals must add up exactly.
 * This is what catches an observation being counted twice because it happens
 * to participate in a query, a cluster, a page and an opportunity at once.
 */
export function conserveMetrics(input: {
  observations: GscObservation[];
  /** Attribution state per observation index, aligned with `observations`. */
  states: Array<'ATTRIBUTED' | 'PARTIAL' | 'UNMAPPED'>;
}): {
  rawObservations: number; attributed: number; partial: number; unmapped: number;
  rawImpressions: number; attributedImpressions: number; partialOrUnmappedImpressions: number;
  rawClicks: number; attributedClicks: number; partialOrUnmappedClicks: number;
  conserved: boolean;
  violations: string[];
} {
  const obs = input.observations ?? [];
  const states = input.states ?? [];
  const violations: string[] = [];
  if (obs.length !== states.length) violations.push(`state count ${states.length} does not match observation count ${obs.length}`);

  let attributed = 0, partial = 0, unmapped = 0;
  let rawImpressions = 0, attributedImpressions = 0, partialOrUnmappedImpressions = 0;
  let rawClicks = 0, attributedClicks = 0, partialOrUnmappedClicks = 0;

  for (let i = 0; i < obs.length; i += 1) {
    const imp = Number(obs[i]?.impressions ?? 0);
    const clk = Number(obs[i]?.clicks ?? 0);
    rawImpressions += imp;
    rawClicks += clk;

    const state = states[i];
    if (state === 'ATTRIBUTED') {
      attributed += 1; attributedImpressions += imp; attributedClicks += clk;
    } else {
      if (state === 'PARTIAL') partial += 1; else unmapped += 1;
      partialOrUnmappedImpressions += imp; partialOrUnmappedClicks += clk;
    }
  }

  if (attributed + partial + unmapped !== obs.length) violations.push('attribution states do not partition the observations');
  if (attributedImpressions + partialOrUnmappedImpressions !== rawImpressions) violations.push('impressions were created or lost');
  if (attributedClicks + partialOrUnmappedClicks !== rawClicks) violations.push('clicks were created or lost');

  return {
    rawObservations: obs.length, attributed, partial, unmapped,
    rawImpressions, attributedImpressions, partialOrUnmappedImpressions,
    rawClicks, attributedClicks, partialOrUnmappedClicks,
    conserved: violations.length === 0,
    violations,
  };
}

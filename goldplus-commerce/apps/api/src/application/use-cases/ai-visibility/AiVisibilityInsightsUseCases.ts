import type { AiVisibilityRepository, AivCitationRow, AivMentionRow, AivObservationRow, ObservationFilter } from '../../ports/AiVisibility';
import { competitorMetrics, computeMetrics, type MetricObservation } from '../../../domain/ai-visibility/Metrics';
import { classifyGaps, type Gap } from '../../../domain/ai-visibility/Gaps';
import { recommendFor, type Recommendation } from '../../../domain/ai-visibility/Recommendations';
import { fail, ok, type Result } from './AiVisibilitySetupUseCases';

/**
 * Read model for the AI Search control tower. Everything here is derived from
 * stored MONITOR observations only — research runs never move a KPI — and
 * every summary carries the observation ids it came from, so a number can be
 * followed to the answers behind it.
 */
export class AiVisibilityInsightsUseCases {
  constructor(private readonly repo: AiVisibilityRepository, private readonly now: () => Date = () => new Date()) {}

  private toMetric(o: AivObservationRow, cites: AivCitationRow[], mentions: AivMentionRow[]): MetricObservation {
    const oc = cites.filter((c) => c.observationId === o.id);
    const om = mentions.filter((m) => m.observationId === o.id);
    const compCounts: Record<string, number> = {};
    for (const c of oc) if (c.role === 'COMPETITOR' && c.competitorId) compCounts[c.competitorId] = (compCounts[c.competitorId] ?? 0) + 1;
    return {
      provider: o.provider,
      answered: o.status === 'SUCCEEDED',
      brandMentioned: o.brandMentioned === true,
      ownCited: o.ownCited,
      competitorMentionIds: om.filter((m) => m.entityKind === 'COMPETITOR' && m.competitorId).map((m) => m.competitorId as string),
      competitorCitedIds: Object.keys(compCounts),
      ownCitationCount: oc.filter((c) => c.role === 'OWN').length,
      competitorCitationCounts: compCounts,
    };
  }

  /** Current state = the latest MONITOR answer per (query, provider). */
  private async current(projectId: string) {
    const pairs = await this.repo.latestPairs(projectId, null);
    const ids = pairs.flatMap((p) => [p.current.id, ...(p.previous ? [p.previous.id] : [])]);
    const [cites, mentions] = await Promise.all([this.repo.citationsFor(ids), this.repo.mentionsFor(ids)]);
    return { pairs, cites, mentions };
  }

  async summary(projectId: string, days = 28): Promise<Result<Record<string, unknown>>> {
    const project = await this.repo.getProject(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const [{ pairs, cites, mentions }, providers, runs, competitors, queries] = await Promise.all([
      this.current(project.id), this.repo.listProviderConfigs(project.id), this.repo.listRuns(project.id, 5, 0, 'MONITOR'),
      this.repo.listPinnedCompetitors(project.id), this.repo.listQueries(project.id, { active: true, limit: 1, offset: 0 }),
    ]);
    const cur = pairs.map((p) => this.toMetric(p.current, cites, mentions));
    const prev = pairs.filter((p) => p.previous).map((p) => this.toMetric(p.previous as AivObservationRow, cites, mentions));
    const to = this.now();
    const from = new Date(to.getTime() - days * 86_400_000);
    const series = await this.repo.dailySeries(project.id, from.toISOString(), to.toISOString());
    const byProvider = [...new Set(pairs.map((p) => p.provider))].map((prov) => ({
      provider: prov,
      ...computeMetrics(pairs.filter((p) => p.provider === prov).map((p) => this.toMetric(p.current, cites, mentions))),
    }));
    const compM = competitorMetrics(cur, competitors.map((c) => c.id));
    const movements = this.movements(pairs, cites);
    const gaps = this.gapRows(pairs, cites);
    const recs = await this.withOpenActions(project.id, this.recommendations(gaps, this.ownPageByQuery(pairs, cites)));
    const lastRun = runs.rows.find((r) => ['COMPLETED', 'PARTIAL'].includes(r.status)) ?? null;
    return ok({
      project: { id: project.id, name: project.name, brandName: project.brandName, domains: project.domains, marketCountry: project.marketCountry, marketCity: project.marketCity },
      state: {
        providersConfigured: providers.filter((p) => p.enabled && p.hasCredential).map((p) => p.provider),
        trackedQueries: queries.total,
        pinnedCompetitors: competitors.length,
        lastSuccessfulRun: lastRun ? { id: lastRun.id, status: lastRun.status, finishedAt: lastRun.finishedAt } : null,
        activeRun: runs.rows.find((r) => ['QUEUED', 'RUNNING', 'AWAITING_APPROVAL'].includes(r.status)) ?? null,
        evidence: { answers: pairs.length, observationIds: pairs.map((p) => p.current.id) },
      },
      current: computeMetrics(cur),
      previous: prev.length ? computeMetrics(prev) : null,
      byProvider,
      series,
      competitors: competitors.map((c) => ({ ...compM.find((m) => m.competitorId === c.id), id: c.id, name: c.name, domains: c.domains })),
      movements: movements.slice(0, 12),
      // The most urgent recommendation nobody has picked up yet.
      nextBestAction: recs.find((r) => !r.existingActionId) ?? null,
      recommendationsInHand: recs.filter((r) => r.existingActionId).length,
      openGaps: gaps.length,
    });
  }

  private movements(pairs: Awaited<ReturnType<AiVisibilityRepository['latestPairs']>>, cites: AivCitationRow[]) {
    const out: Array<{ kind: string; queryText: string; queryId: string | null; provider: string; observationIds: string[]; detail: string }> = [];
    for (const p of pairs) {
      if (!p.previous) continue;
      const a = p.previous, b = p.current;
      const ids = [a.id, b.id];
      if (a.ownCited === true && b.ownCited === false) out.push({ kind: 'CITATION_LOST', queryText: p.queryText, queryId: p.queryId, provider: p.provider, observationIds: ids, detail: 'Our page was cited last run and is not now.' });
      if (a.ownCited === false && b.ownCited === true) out.push({ kind: 'CITATION_GAINED', queryText: p.queryText, queryId: p.queryId, provider: p.provider, observationIds: ids, detail: 'Our page is now cited.' });
      if (a.brandMentioned === true && b.brandMentioned === false) out.push({ kind: 'MENTION_LOST', queryText: p.queryText, queryId: p.queryId, provider: p.provider, observationIds: ids, detail: 'The brand was named last run and is not now.' });
      if (a.brandMentioned === false && b.brandMentioned === true) out.push({ kind: 'MENTION_GAINED', queryText: p.queryText, queryId: p.queryId, provider: p.provider, observationIds: ids, detail: 'The brand is now named.' });
      const before = new Set(cites.filter((c) => c.observationId === a.id && c.competitorId).map((c) => c.competitorId));
      const newComp = cites.filter((c) => c.observationId === b.id && c.competitorId && !before.has(c.competitorId));
      if (newComp.length) out.push({ kind: 'COMPETITOR_EMERGED', queryText: p.queryText, queryId: p.queryId, provider: p.provider, observationIds: ids, detail: `Newly cited competitor site(s): ${[...new Set(newComp.map((c) => c.host))].join(', ')}.` });
    }
    const rank: Record<string, number> = { CITATION_LOST: 0, COMPETITOR_EMERGED: 1, MENTION_LOST: 2, CITATION_GAINED: 3, MENTION_GAINED: 4 };
    return out.sort((x, y) => rank[x.kind] - rank[y.kind]);
  }

  private gapRows(pairs: Awaited<ReturnType<AiVisibilityRepository['latestPairs']>>, cites: AivCitationRow[]) {
    const input = (o: AivObservationRow) => {
      const oc = cites.filter((c) => c.observationId === o.id);
      return { id: o.id, brandMentioned: o.brandMentioned === true, ownCited: o.ownCited, competitorsCited: [...new Set(oc.filter((c) => c.competitorId).map((c) => c.competitorId as string))], thirdPartyCitations: oc.filter((c) => c.role === 'THIRD_PARTY').length, totalCitations: oc.length };
    };
    const rows: Array<Gap & { queryId: string | null; queryText: string; provider: string; citedHosts: string[] }> = [];
    for (const p of pairs) {
      if (p.current.status !== 'SUCCEEDED') continue;
      for (const g of classifyGaps(input(p.current), p.previous && p.previous.status === 'SUCCEEDED' ? input(p.previous) : null)) {
        rows.push({ ...g, queryId: p.queryId, queryText: p.queryText, provider: p.provider, citedHosts: [...new Set(cites.filter((c) => c.observationId === p.current.id).map((c) => c.host))] });
      }
    }
    return rows;
  }

  /** Per question, one of OUR pages already cited for it (latest first) — the obvious page to work on. */
  private ownPageByQuery(pairs: Awaited<ReturnType<AiVisibilityRepository['latestPairs']>>, cites: AivCitationRow[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of pairs) {
      if (!p.queryId || out.has(p.queryId)) continue;
      for (const o of [p.current, p.previous]) {
        const own = o ? cites.find((c) => c.observationId === o.id && c.role === 'OWN') : undefined;
        if (own) { out.set(p.queryId, own.url); break; }
      }
    }
    return out;
  }

  private recommendations(gaps: ReturnType<AiVisibilityInsightsUseCases['gapRows']>, ownPages: Map<string, string> = new Map()): Recommendation[] {
    // One recommendation per (query, gap kind), pooling providers as independent evidence.
    const groups = new Map<string, { kind: Gap['kind']; queryId: string; queryText: string; providers: string[]; observationIds: string[]; competitorIds: string[] }>();
    for (const g of gaps) {
      if (!g.queryId) continue;
      const k = `${g.queryId}|${g.kind}`;
      const cur = groups.get(k) ?? { kind: g.kind, queryId: g.queryId, queryText: g.queryText, providers: [], observationIds: [], competitorIds: [] };
      cur.providers.push(g.provider);
      cur.observationIds.push(...g.observationIds);
      cur.competitorIds.push(...g.competitorIds);
      groups.set(k, cur);
    }
    const order: Record<string, number> = { LOST_CITATION: 0, COMPETITOR_CITED_NOT_US: 1, MENTIONED_NOT_CITED: 2, THIRD_PARTY_DOMINATED: 3, ABSENT: 4 };
    return [...groups.values()]
      .sort((a, b) => order[a.kind] - order[b.kind] || b.providers.length - a.providers.length)
      .map((g) => recommendFor({ ...g, providers: [...new Set(g.providers)], competitorIds: [...new Set(g.competitorIds)], candidatePage: ownPages.get(g.queryId) ?? null }));
  }

  /**
   * Marks each recommendation that already has an open action (same query,
   * same title), so it is not drafted twice and the next best action moves on
   * to work nobody has picked up yet.
   */
  private async withOpenActions(projectId: string, recs: Recommendation[]): Promise<Array<Recommendation & { existingActionId: string | null }>> {
    const open = (await this.repo.listActions(projectId, null, 200, 0)).rows
      .filter((a) => !['REJECTED', 'CANCELLED', 'VERIFIED', 'NOT_VERIFIED'].includes(a.status));
    return recs.map((r) => {
      const hit = open.find((a) => a.title === r.title && (a.queryIds.includes(r.evidence.queryId) || (a.evidence as { queryId?: string }).queryId === r.evidence.queryId));
      return { ...r, existingActionId: hit?.id ?? null };
    });
  }

  async gaps(projectId: string): Promise<Result<{ gaps: unknown[]; recommendations: Recommendation[] }>> {
    const project = await this.repo.getProject(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const { pairs, cites } = await this.current(project.id);
    const comps = await this.repo.listPinnedCompetitors(project.id);
    const name = new Map(comps.map((c) => [c.id, c.name]));
    const gaps = this.gapRows(pairs, cites).map((g) => ({ ...g, competitorNames: g.competitorIds.map((id) => name.get(id) ?? id) }));
    return ok({ gaps, recommendations: await this.withOpenActions(project.id, this.recommendations(gaps, this.ownPageByQuery(pairs, cites))) });
  }

  /** Pinned competitors plus OBSERVED domains, kept apart from pure SOURCES. */
  async landscape(projectId: string): Promise<Result<Record<string, unknown>>> {
    const project = await this.repo.getProject(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const { pairs, cites, mentions } = await this.current(project.id);
    const currentIds = new Set(pairs.map((p) => p.current.id));
    const cur = cites.filter((c) => currentIds.has(c.observationId));
    const comps = await this.repo.listPinnedCompetitors(project.id);
    const metrics = competitorMetrics(pairs.map((p) => this.toMetric(p.current, cites, mentions)), comps.map((c) => c.id));
    const hostAgg = new Map<string, { host: string; citations: number; answers: Set<string>; sourceKind: string | null; pages: Map<string, number> }>();
    for (const c of cur.filter((x) => x.role === 'THIRD_PARTY')) {
      const h = hostAgg.get(c.host) ?? { host: c.host, citations: 0, answers: new Set<string>(), sourceKind: c.sourceKind, pages: new Map() };
      h.citations += 1; h.answers.add(c.observationId); h.pages.set(c.url, (h.pages.get(c.url) ?? 0) + 1);
      hostAgg.set(c.host, h);
    }
    const hosts = [...hostAgg.values()].sort((a, b) => b.answers.size - a.answers.size).map((h) => ({ host: h.host, answers: h.answers.size, citations: h.citations, sourceKind: h.sourceKind, samplePages: [...h.pages.keys()].slice(0, 3) }));
    const ownPages = new Map<string, number>();
    for (const c of cur.filter((x) => x.role === 'OWN')) ownPages.set(c.url, (ownPages.get(c.url) ?? 0) + 1);
    return ok({
      answers: pairs.length,
      pinned: comps.map((c) => {
        const m = metrics.find((x) => x.competitorId === c.id);
        const pages = new Map<string, number>();
        for (const x of cur.filter((y) => y.competitorId === c.id)) pages.set(x.url, (pages.get(x.url) ?? 0) + 1);
        return { id: c.id, name: c.name, domains: c.domains, ...m, topPages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([url, n]) => ({ url, citations: n })) };
      }).sort((a, b) => (b.mentioned ?? 0) - (a.mentioned ?? 0)),
      // Observed = third-party hosts that are not known source types (news, forums…).
      observed: hosts.filter((h) => !h.sourceKind),
      sources: hosts.filter((h) => h.sourceKind),
      ownPages: [...ownPages.entries()].sort((a, b) => b[1] - a[1]).map(([url, n]) => ({ url, citations: n })),
    });
  }

  /**
   * The report, as data. The web report and the JSON export are two views of
   * this one object; every figure keeps the observation ids behind it and the
   * method notes say what the numbers do and do not mean.
   */
  async report(projectId: string, days = 28): Promise<Result<Record<string, unknown>>> {
    const summary = await this.summary(projectId, days);
    if (!summary.ok) return summary;
    const s = summary.value as Record<string, any>;
    const [gaps, landscape, runs, actions] = await Promise.all([
      this.gaps(projectId), this.landscape(projectId),
      this.repo.listRuns(s.project.id, 10, 0, 'MONITOR'), this.repo.listActions(s.project.id, null, 50, 0),
    ]);
    const acts = actions.rows;
    const since = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    return ok({
      generatedAt: this.now().toISOString(),
      periodDays: days,
      project: s.project,
      executiveSummary: {
        answers: s.state.evidence.answers,
        mentionRate: s.current.mentionRate, citationRate: s.current.citationRate,
        previousMentionRate: s.previous?.mentionRate ?? null, previousCitationRate: s.previous?.citationRate ?? null,
        openGaps: s.openGaps,
        nextBestAction: s.nextBestAction,
      },
      whatChanged: s.movements,
      visibility: { current: s.current, previous: s.previous, byProvider: s.byProvider, series: s.series },
      competitiveLandscape: landscape.ok ? landscape.value : null,
      opportunities: gaps.ok ? gaps.value.recommendations.slice(0, 15) : [],
      runs: runs.rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, succeeded: r.succeeded, failed: r.failed, actualUsd: r.actualUsd })),
      actionsTaken: acts.filter((a) => a.executedAt && a.executedAt >= since).map((a) => ({ id: a.id, title: a.title, status: a.status, result: a.result, executedAt: a.executedAt })),
      verification: acts.filter((a) => a.verification).map((a) => ({ id: a.id, title: a.title, status: a.status, verification: a.verification })),
      nextActions: acts.filter((a) => ['DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'VERIFICATION_PENDING'].includes(a.status)).map((a) => ({ id: a.id, title: a.title, status: a.status })),
      method: [
        'Mentioned = the answer names the brand. Cited = the answer\'s sources include a page on the project\'s domains. They are reported separately.',
        'Rates use the latest monitoring answer per question and provider; research answers are excluded. Answers whose provider returned no sources are excluded from the citation rate.',
        'AI answers vary between runs; one run is a sample. Changes that follow an action coincide with it; they do not by themselves show that it caused them.',
      ],
    });
  }

  listAnswers(projectId: string, f: ObservationFilter) { return this.repo.listObservations(projectId, f); }

  async answer(projectId: string, id: string): Promise<Result<Record<string, unknown>>> {
    const o = await this.repo.getObservation(projectId, id);
    if (!o) return fail('NOT_FOUND', 'Answer not found.');
    const [citations, mentions, comps] = await Promise.all([this.repo.citationsFor([o.id]), this.repo.mentionsFor([o.id]), this.repo.listPinnedCompetitors(projectId)]);
    const name = new Map(comps.map((c) => [c.id, c.name]));
    const history = o.queryId ? (await this.repo.listObservations(projectId, { queryId: o.queryId, provider: o.provider, limit: 10, offset: 0 })).rows : [];
    // The raw provider reply stays in storage (for re-parsing); the answer view
    // does not ship it — it can be hundreds of kilobytes.
    const { rawResponse: _raw, ...rawMetadata } = (o.rawMetadata ?? {}) as Record<string, unknown>;
    return ok({
      ...o,
      rawMetadata: { ...rawMetadata, rawResponseStored: _raw !== undefined },
      citations: citations.map((c) => ({ ...c, competitorName: c.competitorId ? name.get(c.competitorId) ?? null : null })),
      mentions: mentions.map((m) => ({ ...m, competitorName: m.competitorId ? name.get(m.competitorId) ?? null : null })),
      history: history.map((h) => ({ id: h.id, runId: h.runId, executedAt: h.executedAt, status: h.status, brandMentioned: h.brandMentioned, ownCited: h.ownCited, citationCount: h.citationCount })),
    });
  }

  /** The same question across providers, latest answer each, with the previous one for comparison. */
  async compare(projectId: string, queryId: string): Promise<Result<Record<string, unknown>>> {
    const pairs = (await this.repo.latestPairs(projectId, null)).filter((p) => p.queryId === queryId);
    if (pairs.length === 0) return fail('NOT_FOUND', 'No monitored answers for this question yet.');
    const ids = pairs.flatMap((p) => [p.current.id, ...(p.previous ? [p.previous.id] : [])]);
    const cites = await this.repo.citationsFor(ids);
    const hosts = (id: string) => [...new Set(cites.filter((c) => c.observationId === id).map((c) => c.host))];
    return ok({
      queryText: pairs[0].queryText,
      providers: pairs.map((p) => ({
        provider: p.provider,
        now: { ...p.current, citedHosts: hosts(p.current.id) },
        previous: p.previous ? { ...p.previous, citedHosts: hosts(p.previous.id) } : null,
      })),
    });
  }
}

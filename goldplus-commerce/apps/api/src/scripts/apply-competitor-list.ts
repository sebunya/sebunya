import '../config/env';
import { readFileSync } from 'node:fs';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Applies an owner-supplied competitor list to the SEO competitor registry.
 *
 * An entry whose canonicalName (or one of its aliases) matches an existing row
 * is MERGED the way PATCH /admin/seo/competitors/:id merges: every field the
 * entry does not set keeps its stored value; aliases and domains are unioned.
 * Anything else is created. "Removing" a competitor means status IGNORED —
 * the registry has no delete, and an ignored row keeps its history.
 *
 * Every domain in the list must have been checked before it is supplied: a
 * domain that does not resolve is left out and the row noted, so SERP matching
 * never keys on an address that does not exist. Audited per row.
 *
 *   ACTOR_USER_ID=<admin uuid> ROWS_FILE=/import/competitors.json [DRY_RUN=1] \
 *     npx tsx src/scripts/apply-competitor-list.ts
 */
type Entry = {
  canonicalName: string; aliases?: string[]; domains?: string[]; businessType?: string;
  directness?: string; ugandaRelevance?: string; isBrand?: boolean; isMarketplace?: boolean;
  status?: string; note?: string;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const union = (a: string[], b: string[] = []) => [...new Set([...a, ...b].map((s) => s.trim()).filter(Boolean))];
const key = (s: string) => s.trim().toLowerCase();

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the admin uuid.');
  const entries = JSON.parse(readFileSync(String(process.env.ROWS_FILE ?? '/import/competitors.json'), 'utf8')) as Entry[];
  const dryRun = process.env.DRY_RUN === '1';
  const registry = Registry.getInstance();
  const repo = registry.seoGrowthRepo;

  const existing = (await repo.listCompetitors()) as any[];
  const byName = new Map<string, any>();
  for (const r of existing) {
    byName.set(key(r.canonical_name), r);
    for (const a of arr(r.aliases)) byName.set(key(a), r);
  }

  const tally: Record<string, number> = {};
  for (const e of entries) {
    const match = [e.canonicalName, ...(e.aliases ?? [])].map((n) => byName.get(key(n))).find(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const note = e.note ? `${today}: ${e.note}` : null;
    const input = match
      ? {
          canonicalName: match.canonical_name,
          aliases: union(arr(match.aliases), e.aliases),
          domains: union(arr(match.domains), e.domains),
          businessType: e.businessType ?? match.business_type,
          country: match.country,
          ugandaRelevance: e.ugandaRelevance ?? match.uganda_relevance,
          localPresence: match.local_presence,
          productOverlap: arr(match.product_overlap),
          categoryOverlap: arr(match.category_overlap),
          b2bRelevant: match.b2b_relevant,
          isMarketplace: e.isMarketplace ?? match.is_marketplace,
          isBrand: e.isBrand ?? match.is_brand,
          directness: e.directness ?? match.directness,
          status: e.status ?? match.status,
          mergedIntoId: null,
          evidenceSource: [match.evidence_source, note].filter(Boolean).join(' | ') || null,
          evidenceState: 'MANAGEMENT_SUPPLIED',
          lastVerifiedAt: new Date(),
        }
      : {
          canonicalName: e.canonicalName,
          aliases: union([], e.aliases),
          domains: union([], e.domains),
          businessType: e.businessType ?? 'UNRESOLVED',
          country: 'UG',
          ugandaRelevance: e.ugandaRelevance ?? 'UNKNOWN',
          isMarketplace: e.isMarketplace ?? false,
          isBrand: e.isBrand ?? false,
          directness: e.directness ?? 'UNRESOLVED',
          status: e.status ?? 'CANDIDATE',
          evidenceSource: note,
          evidenceState: 'MANAGEMENT_SUPPLIED',
          lastVerifiedAt: new Date(),
        };
    const action = `${match ? 'UPDATE' : 'CREATE'}/${input.status}`;
    tally[action] = (tally[action] ?? 0) + 1;
    console.log(`${action.padEnd(17)} ${input.canonicalName}${match && match.canonical_name !== e.canonicalName ? ` (listed as "${e.canonicalName}")` : ''} [${input.domains.join(', ') || 'no domain'}]`);
    if (dryRun) continue;
    const row = await repo.upsertCompetitor(input);
    await registry.createAuditLogUseCase.execute({
      actorId,
      action: match ? 'SEO_COMPETITOR_CLASSIFIED' : 'SEO_COMPETITOR_UPSERTED',
      entity: 'seo_competitor',
      entityId: String(row?.id ?? ''),
      newState: { canonicalName: input.canonicalName, status: input.status, domains: input.domains, source: 'owner competitor list 2026-09-18' },
    });
  }
  console.log(`${dryRun ? 'DRY RUN' : 'APPLIED'}: ${JSON.stringify(tally)}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => endDbConnection());

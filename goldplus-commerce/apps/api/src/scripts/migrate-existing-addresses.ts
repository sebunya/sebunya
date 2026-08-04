/**
 * E.4 migration of existing address data (location-module brief, stage 5).
 *
 * Runs every existing address-bearing record (saved addresses + order
 * destinations) through the matching pipeline:
 *   - exact / alias / trigram match → auto-link (addresses get area_slug +
 *     snapshots; ORDERS ARE NEVER REWRITTEN — an order-side match is recorded
 *     as an address_audit 'migration_linked' fact referencing the order)
 *   - everything else → the ops review queue posture, original text preserved
 * Match rate + ranked candidate aliases printed as the stage-5 report.
 *
 * The wrong-gazetteer order GP-202608-DBF2 ("Kira | Kira, Mukono" — Kira is
 * Wakiso) is corrected THROUGH THE AUDITED PATH: an address_audit row records
 * the true resolution against the order; the stored historical text stays
 * exactly as written (a historical order never changes meaning).
 *
 * Usage: DATABASE_URL=... npx tsx src/scripts/migrate-existing-addresses.ts [--apply]
 * (default is a dry-run report; --apply writes the links)
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { foldUgandanOrthography } from '@goldplus/shared';

const apply = process.argv.includes('--apply');

interface AreaRow {
  area_slug: string;
  parish_or_area_clean: string;
  display_label: string;
  current_district: string;
  postcode: string | null;
  data_version: number;
  search_text: string;
}

async function matchText(raw: string, district: string | null): Promise<{ slug: string; label: string; district: string; postcode: string | null; version: number; via: string } | null> {
  const folded = foldUgandanOrthography(raw);
  if (folded.length < 2) return null;
  // alias exact → area exact → trigram (same order as the live pipeline)
  const alias = (await db.execute(sql`
    select a.area_slug, a.parish_or_area_clean, a.display_label, a.current_district, a.postcode, a.data_version, a.search_text
    from ug_area_alias al join ug_area a on a.area_slug = al.area_slug
    where al.normalised_alias = ${folded} and a.selectable = true
      and (${district}::text is null or upper(a.current_district) = upper(${district}))
    limit 1`)) as unknown as AreaRow[];
  if (alias[0]) return hit(alias[0], 'alias');
  const exact = (await db.execute(sql`
    select area_slug, parish_or_area_clean, display_label, current_district, postcode, data_version, search_text
    from ug_area where selectable = true
      and (split_part(search_text, ' ', 1) = ${folded} or search_text like ${folded + ' %'})
      and (${district}::text is null or upper(current_district) = upper(${district}))
    limit 1`)) as unknown as AreaRow[];
  if (exact[0]) return hit(exact[0], 'exact');
  const trigram = (await db.execute(sql`
    select area_slug, parish_or_area_clean, display_label, current_district, postcode, data_version, search_text,
           similarity(search_text, ${folded}) as score
    from ug_area where selectable = true and similarity(search_text, ${folded}) > 0.5
      and (${district}::text is null or upper(current_district) = upper(${district}))
    order by score desc limit 1`)) as unknown as AreaRow[];
  if (trigram[0]) return hit(trigram[0], 'trigram');
  return null;
}

function hit(a: AreaRow, via: string) {
  return { slug: a.area_slug, label: a.display_label, district: a.current_district, postcode: a.postcode, version: a.data_version, via };
}

async function main() {
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from ug_area`)) as unknown as Array<{ n: number }>;
  if (Number(n) === 0) {
    console.error('MIGRATION_BLOCKED: ug_area is empty — run import-locations first.');
    process.exit(1);
  }

  let matched = 0;
  let unmatched = 0;
  const candidates = new Map<string, number>();

  // 1. Saved addresses.
  const addresses = (await db.execute(sql`
    select id, district, area_details, area_slug from addresses where deleted_at is null`)) as unknown as Array<{
    id: string; district: string; area_details: string; area_slug: string | null;
  }>;
  for (const a of addresses) {
    if (a.area_slug) { matched++; continue; }
    const firstToken = a.area_details.split(',')[0].trim();
    const m = (await matchText(firstToken, a.district)) ?? (await matchText(a.district, a.district));
    if (m) {
      matched++;
      if (apply) {
        await db.execute(sql`
          update addresses set area_slug = ${m.slug}, snapshot_area_label = ${m.label},
            snapshot_district = ${m.district}, snapshot_postcode = ${m.postcode},
            snapshot_data_version = ${m.version}, updated_at = now()
          where id = ${a.id}`);
        await db.execute(sql`
          insert into address_audit (address_id, actor_type, action, after, note)
          values (${a.id}, 'system', 'migration_linked', ${JSON.stringify({ areaSlug: m.slug, via: m.via })}::jsonb, 'E.4 migration')`);
      }
      console.log(`ADDRESS_MATCHED ${a.id} → ${m.slug} (${m.via})`);
    } else {
      unmatched++;
      candidates.set(firstToken.toLowerCase(), (candidates.get(firstToken.toLowerCase()) ?? 0) + 1);
      if (apply) {
        await db.execute(sql`update addresses set resolution_status = 'needs_ops_review', updated_at = now() where id = ${a.id}`);
        await db.execute(sql`
          insert into address_audit (address_id, actor_type, action, note)
          values (${a.id}, 'system', 'status_changed', 'E.4 migration: no confident match — ops review')`);
      }
      console.log(`ADDRESS_UNMATCHED ${a.id} "${firstToken}" (${a.district})`);
    }
  }

  // 2. Order destinations (orders are NEVER rewritten — matches are recorded
  //    as audit facts referencing the order).
  const orders = (await db.execute(sql`
    select id, order_number, delivery_area,
           delivery_location->>'district' as district,
           delivery_location->>'area' as area
    from orders`)) as unknown as Array<{
    id: string; order_number: string; delivery_area: string; district: string | null; area: string | null;
  }>;
  for (const o of orders) {
    const probe = o.area ?? o.delivery_area.split(',')[0].split('|')[0].trim();
    const m = await matchText(probe, o.district);
    if (m) {
      matched++;
      if (apply) {
        await db.execute(sql`
          insert into address_audit (order_id, actor_type, action, after, note)
          values (${o.id}, 'system', 'migration_linked',
            ${JSON.stringify({ areaSlug: m.slug, via: m.via, resolvedDistrict: m.district })}::jsonb,
            ${o.order_number === 'GP-202608-DBF2'
              ? 'E.4 migration: CORRECTS the old gazetteer — Kira is in ' + m.district + ', not the district stored on the order. Historical text preserved unchanged.'
              : 'E.4 migration: order destination linked'})`);
      }
      console.log(`ORDER_MATCHED ${o.order_number} "${probe}" → ${m.slug} (${m.via}${m.district !== o.district && o.district ? `, corrects district ${o.district}→${m.district}` : ''})`);
    } else {
      unmatched++;
      candidates.set(probe.toLowerCase(), (candidates.get(probe.toLowerCase()) ?? 0) + 1);
      console.log(`ORDER_UNMATCHED ${o.order_number} "${probe}"`);
    }
  }

  const total = matched + unmatched;
  const rate = total ? Math.round((matched / total) * 100) : 0;
  console.log(`\nMATCH_RATE ${matched}/${total} (${rate}%) mode=${apply ? 'APPLIED' : 'DRY_RUN'}`);
  console.log('CANDIDATE_ALIASES (ranked by frequency):');
  for (const [text, count] of [...candidates.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}× "${text}"`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('MIGRATION_FAILED', e);
  process.exit(1);
});

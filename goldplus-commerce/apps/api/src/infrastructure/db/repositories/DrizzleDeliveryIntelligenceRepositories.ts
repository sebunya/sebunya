import { sql } from 'drizzle-orm';
import { db } from '../client';
import { deliveryPricingPolicy } from '../schema/commerce';
import {
  IDeliveryFeeObservationReader,
  IDeliveryPricingPolicyRepository,
  StoredDeliveryBandPolicy,
} from '../../../application/ports/IDeliveryIntelligence';
import { DeliveryBandPolicy, FeeObservationSummary } from '../../../domain/commerce/DeliveryFeePrediction';

function toStored(row: typeof deliveryPricingPolicy.$inferSelect): StoredDeliveryBandPolicy {
  return {
    coreFeeUgx: row.coreFeeUgx,
    cityFeeUgx: row.cityFeeUgx,
    metroFeeUgx: row.metroFeeUgx,
    metroEdgeFeeUgx: row.metroEdgeFeeUgx,
    nearFeeUgx: row.nearFeeUgx,
    midFeeUgx: row.midFeeUgx,
    farFeeUgx: row.farFeeUgx,
    remoteFeeUgx: row.remoteFeeUgx,
    enabled: row.enabled,
    note: row.note,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleDeliveryPricingPolicyRepository implements IDeliveryPricingPolicyRepository {
  async get(): Promise<StoredDeliveryBandPolicy | null> {
    const [row] = await db.select().from(deliveryPricingPolicy).limit(1);
    return row ? toStored(row) : null;
  }

  async save(policy: DeliveryBandPolicy, opts: { note: string | null; actorId: string | null }): Promise<StoredDeliveryBandPolicy> {
    const [row] = await db
      .insert(deliveryPricingPolicy)
      .values({
        singleton: 'policy',
        coreFeeUgx: policy.coreFeeUgx,
        cityFeeUgx: policy.cityFeeUgx,
        metroFeeUgx: policy.metroFeeUgx,
        metroEdgeFeeUgx: policy.metroEdgeFeeUgx,
        nearFeeUgx: policy.nearFeeUgx,
        midFeeUgx: policy.midFeeUgx,
        farFeeUgx: policy.farFeeUgx,
        remoteFeeUgx: policy.remoteFeeUgx,
        enabled: policy.enabled,
        note: opts.note,
        updatedBy: opts.actorId,
      })
      .onConflictDoUpdate({
        target: deliveryPricingPolicy.singleton,
        set: {
          coreFeeUgx: policy.coreFeeUgx,
          cityFeeUgx: policy.cityFeeUgx,
          metroFeeUgx: policy.metroFeeUgx,
          metroEdgeFeeUgx: policy.metroEdgeFeeUgx,
          nearFeeUgx: policy.nearFeeUgx,
          midFeeUgx: policy.midFeeUgx,
          farFeeUgx: policy.farFeeUgx,
          remoteFeeUgx: policy.remoteFeeUgx,
          enabled: policy.enabled,
          note: opts.note,
          updatedBy: opts.actorId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toStored(row);
  }
}

/**
 * The order book as the observation stream: percentile_cont over CONFIRMED
 * delivery fees, grouped by the canonical district each order stored. Runs as
 * one aggregate — no per-district round trips, no learning tables.
 */
export class DrizzleDeliveryFeeObservationReader implements IDeliveryFeeObservationReader {
  async summarizeByDistrict(): Promise<Map<string, FeeObservationSummary>> {
    // delivery_location rows are currently DOUBLE-ENCODED (jsonb holding a JSON
    // string — verified live: jsonb_typeof = 'string'), so ->> on the column
    // directly returns NULL. The CTE unwraps string rows back to objects and
    // keeps working if the write path is ever fixed to store objects natively.
    const rows = (await db.execute(sql`
      with src as (
        select
          case
            when jsonb_typeof(delivery_location) = 'string'
              and (delivery_location #>> '{}') ~ '^\\s*\\{'
              then (delivery_location #>> '{}')::jsonb
            when jsonb_typeof(delivery_location) = 'object'
              then delivery_location
            else null
          end as loc,
          delivery_fee
        from orders
        where delivery_fee_confirmed = true
          and delivery_fee > 0
          and delivery_location is not null
      )
      select
        upper(trim(loc->>'district')) as district_key,
        percentile_cont(0.5) within group (order by delivery_fee)::bigint as median_fee,
        count(*)::int as n
      from src
      where loc->>'district' is not null
      group by 1
    `)) as unknown as Array<{ district_key: string; median_fee: number | string; n: number }>;
    const map = new Map<string, FeeObservationSummary>();
    for (const row of rows) {
      if (!row.district_key) continue;
      map.set(row.district_key, { medianFeeUgx: Number(row.median_fee), sampleSize: row.n });
    }
    return map;
  }
}

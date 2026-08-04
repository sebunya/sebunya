import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * COD eligibility per destination (location brief I.2). The district's zone
 * comes from the imported gazetteer (ug_area.delivery_zone_code); the policy
 * from delivery_zone_policy. An unimported district or inactive policy gates
 * NOTHING — activation is blocked until every value is set, so a gate can
 * never fire off an invented number.
 */
export class CodPolicyReader {
  async forDistrict(district: string): Promise<{
    zoneCode: string;
    active: boolean;
    codAllowed: boolean | null;
    codMaxOrderValueUgx: number | null;
    prepayRequiredAboveUgx: number | null;
  } | null> {
    const rows = (await db.execute(sql`
      select p.zone_code, p.active, p.cod_allowed, p.cod_max_order_value_ugx, p.prepay_required_above_ugx
      from ug_area a
      join delivery_zone_policy p on p.zone_code = a.delivery_zone_code
      where upper(a.current_district) = upper(${district}) and a.delivery_zone_code is not null
      limit 1`)) as unknown as Array<{
      zone_code: string;
      active: boolean;
      cod_allowed: boolean | null;
      cod_max_order_value_ugx: string | number | null;
      prepay_required_above_ugx: string | number | null;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
      zoneCode: r.zone_code,
      active: r.active,
      codAllowed: r.cod_allowed,
      codMaxOrderValueUgx: r.cod_max_order_value_ugx === null ? null : Number(r.cod_max_order_value_ugx),
      prepayRequiredAboveUgx: r.prepay_required_above_ugx === null ? null : Number(r.prepay_required_above_ugx),
    };
  }
}

/**
 * Checkout velocity signal (location brief I.3): ≥3 non-cancelled orders from
 * one phone in 24h raises a loyalty_fraud_signals row for triage. Hashless
 * counts only — no address text ever enters the signal payload (the fraud
 * module's own evidence guard rejects PII keys, and we honour its spirit here).
 */
export class CheckoutVelocitySignal {
  async velocity(input: { phone: string; orderId: string }): Promise<void> {
    const rows = (await db.execute(sql`
      select count(*)::int as n from orders
      where customer_phone = ${input.phone}
        and created_at > now() - interval '24 hours'
        and status not in ('cancelled', 'failed')`)) as unknown as Array<{ n: number }>;
    const n = Number(rows[0]?.n ?? 0);
    if (n >= 3) {
      await db.execute(sql`
        insert into loyalty_fraud_signals (signal_type, severity, details)
        values ('ORDER_VELOCITY_PHONE', ${n >= 6 ? 'high' : 'medium'}, ${JSON.stringify({ orderId: input.orderId, ordersIn24h: n })}::jsonb)`);
    }
  }
}

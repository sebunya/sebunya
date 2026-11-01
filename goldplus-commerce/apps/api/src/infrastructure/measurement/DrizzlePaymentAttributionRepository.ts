import { sql } from 'drizzle-orm';
import { IPaymentAttributionRepository, AttributionSummary, AttributionTouchpoint } from '../../application/ports/measurement/PaymentAttributionRepository';
import { db } from '../db/client';
import { channelAttribution } from './createChannelAttribution';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payment → attribution link. This used to be an empty method whose comment
 * assumed "the checkout process having already stamped orderId onto the
 * touchpoints" — nothing ever did, and it read the legacy
 * attribution_touchpoints table, whose only writer (ConversionRouter.routeAndRecord)
 * is never called. It now uses the attribution module (0156): the order is linked
 * to its visitor's landing touches (measurement.touchpoint) and credited.
 */
export class DrizzlePaymentAttributionRepository implements IPaymentAttributionRepository {
  async linkPaymentToTouchpoints(orderId: string, _paymentReference: string | null): Promise<void> {
    if (!UUID.test(orderId)) return;
    await channelAttribution().attributeOrder.execute(orderId);
  }

  async findTouchpointsForOrder(orderId: string): Promise<AttributionTouchpoint[]> {
    if (!UUID.test(orderId)) return [];
    const r = rows(await db.execute(sql`
      select t.touch_id, t.source, t.medium, t.campaign, t.channel, t.occurred_at
      from measurement.order_touch_link l join measurement.touchpoint t on t.touch_id = l.touch_id
      where l.order_id = ${orderId}::uuid order by t.occurred_at, t.touch_id`));
    // No source recorded is said as the channel, not as a made-up "unknown" campaign.
    return r.map((x) => ({ id: String(x.touch_id), source: x.source ?? x.channel, medium: x.medium ?? x.channel, campaign: x.campaign ?? null, timestamp: new Date(x.occurred_at) }));
  }

  async findTouchpointsForIdentity(_identityHash: string): Promise<AttributionTouchpoint[]> {
    return [];
  }

  async getAttributionSummaryForPayment(orderId: string, paymentReference: string | null): Promise<AttributionSummary> {
    const touchpoints = await this.findTouchpointsForOrder(orderId);
    return { orderId, paymentReference, touchpoints, isAttributed: touchpoints.length > 0 };
  }
}

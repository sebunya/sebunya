import { apiBase } from './api';

/**
 * Baymard P5/C3: "Delivery from UGX …" before an area is chosen. The figure is the quoting service's own floor
 * (GET /delivery/from): the bottom rung of the fee ladder or the published minimum fee. Null means nothing is
 * published, and the line is simply not shown; a failure is never an error on a page.
 */
export interface DeliveryFrom { fromUgx: number | null; pickup: string | null }

export async function getDeliveryFrom(timeoutMs = 1200): Promise<DeliveryFrom> {
  try {
    const res = await fetch(`${apiBase}/delivery/from`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { fromUgx: null, pickup: null };
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: DeliveryFrom } | null;
    const d = json?.success ? json.data : null;
    const from = d && Number.isInteger(d.fromUgx) && (d.fromUgx as number) > 0 ? (d.fromUgx as number) : null;
    return { fromUgx: from, pickup: typeof d?.pickup === 'string' && d.pickup.trim() ? d.pickup.trim() : null };
  } catch {
    return { fromUgx: null, pickup: null };
  }
}

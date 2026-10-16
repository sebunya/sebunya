/**
 * Place memory (2026-10-16): what our own riders learned the last times we delivered to this customer in this
 * area, so the next rider finds the gate first time. Built only from our own delivery records — rider handover
 * points, the rider's "easy / hard to find", outcomes — never from Google content. A handover point is shown only
 * while our pin retention keeps it (privacy page: 180 days), and only to staff and the assigned rider.
 */
export interface PastDelivery {
  orderNumber: string;
  outcome: string;
  at: Date;
  findDifficulty: 'easy' | 'hard' | null;
  failedReason: string | null;
  handover: { lat: number; lng: number; accuracyM: number | null } | null;
}

export interface PlaceMemory {
  deliveredBefore: number;
  lastDeliveredAt: Date | null;
  /** Times riders marked it hard to find, of the times they said either way. */
  hardToFind: number;
  findReported: number;
  /** Failed attempts at this place, newest reason first. */
  failedAttempts: number;
  lastFailedReason: string | null;
  /** The most recent rider handover point accurate to 100 m, when one is still kept. */
  handoverPin: { lat: number; lng: number; accuracyM: number | null; orderNumber: string } | null;
  /** One line for the rider card, or null when there is nothing to tell. */
  riderLine: string | null;
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

export function summarisePlaceMemory(past: PastDelivery[]): PlaceMemory {
  const sorted = [...past].sort((a, b) => b.at.getTime() - a.at.getTime());
  const delivered = sorted.filter((p) => p.outcome === 'DELIVERED');
  const failed = sorted.filter((p) => p.outcome !== 'DELIVERED');
  const reported = sorted.filter((p) => p.findDifficulty);
  const hard = reported.filter((p) => p.findDifficulty === 'hard').length;
  const pinFrom = delivered.find((p) => p.handover && (p.handover.accuracyM === null || p.handover.accuracyM <= 100));
  const handoverPin = pinFrom?.handover ? { ...pinFrom.handover, orderNumber: pinFrom.orderNumber } : null;
  const parts: string[] = [];
  if (delivered.length) parts.push(`Delivered here ${delivered.length} time${delivered.length === 1 ? '' : 's'} before (last ${fmtDate(delivered[0].at)})`);
  if (reported.length) parts.push(hard ? `riders found it hard to find ${hard} of ${reported.length} time${reported.length === 1 ? '' : 's'}` : 'riders found it easy to find');
  if (failed.length) parts.push(`${failed.length} failed attempt${failed.length === 1 ? '' : 's'}${failed[0].failedReason ? ` (last: ${failed[0].failedReason.slice(0, 80)})` : ''}`);
  return {
    deliveredBefore: delivered.length,
    lastDeliveredAt: delivered[0]?.at ?? null,
    hardToFind: hard,
    findReported: reported.length,
    failedAttempts: failed.length,
    lastFailedReason: failed[0]?.failedReason ?? null,
    handoverPin,
    riderLine: parts.length ? parts.join('; ') : null,
  };
}

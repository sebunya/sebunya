/**
 * A refund the provider never accepted but that is still 'requested': its call
 * failed or answered nothing, so whether money moved is unknown until someone
 * checks PesaPal. Status '200' is PesaPal's acceptance (see
 * DrizzleRefundLedgerRepository.PROVIDER_ACCEPTED_STATUS). Latest first.
 */
export function unresolvedRefundOf<T extends { status?: unknown; providerStatus?: unknown; createdAt?: unknown }>(refunds: T[]): T | null {
  const open = refunds.filter((r) => r.status === 'requested' && String(r.providerStatus ?? '') !== '200');
  open.sort((a, b) => new Date(String(b.createdAt ?? 0)).getTime() - new Date(String(a.createdAt ?? 0)).getTime());
  return open[0] ?? null;
}

/**
 * Cart abandonment pipeline (Wave 2E-1).
 *
 * Definition (the ONLY one platform-wide): a cart with at least one item whose last
 * activity is older than the threshold is OPEN-abandoned; when it passes its row
 * expiry it becomes EXPIRED. RECOVERED requires a checkout→cart linkage the
 * platform does not record yet (checkout prices client-sent items, deliberately),
 * so recovery detection is documented as a later wave's work rather than guessed
 * from co-incidence of identities.
 *
 * The evaluator is idempotent: a cart with an OPEN row is never re-classified, and
 * a re-run after a crash re-emits nothing already recorded.
 */

export interface AbandonmentCandidate {
  cartId: string;
  ownerKind: string | null;
  ownerId: string | null;
  itemCount: number;
  subtotalUgx: number;
  lastActivityAt: Date;
  expiresAt: Date | null;
}

export interface AbandonmentRecord {
  id: string;
  cartId: string;
  status: 'OPEN' | 'EXPIRED' | 'RECOVERED';
  reason: string;
  itemCount: number;
  subtotalUgx: number;
  classifiedAt: Date;
  lastActivityAt: Date;
}

export interface IAbandonmentRepository {
  /** Carts with items, stale beyond `staleBefore`, having NO open classification. */
  findNewlyAbandoned(staleBefore: Date, limit: number): Promise<AbandonmentCandidate[]>;
  createOpen(candidate: AbandonmentCandidate): Promise<AbandonmentRecord | null>;
  /** OPEN rows whose cart has passed its expiry → EXPIRED. Returns count. */
  expireOverdue(now: Date): Promise<number>;
  summary(): Promise<{ open: number; expired: number; recovered: number; last24h: number }>;
  recent(limit: number): Promise<AbandonmentRecord[]>;
}

export interface AbandonmentEventSink {
  /** Announces a NEW classification to the queue for downstream consumers. */
  publish(record: AbandonmentRecord): Promise<void>;
}

export const ABANDONMENT_STALE_HOURS = 6;

export class AbandonmentUseCase {
  constructor(
    private readonly repo: IAbandonmentRepository,
    private readonly sink: AbandonmentEventSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Hourly scan: classify new abandonments, expire overdue ones. */
  async scan(): Promise<{ classified: number; expired: number }> {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - ABANDONMENT_STALE_HOURS * 3600_000);
    const candidates = await this.repo.findNewlyAbandoned(staleBefore, 500);
    let classified = 0;
    for (const candidate of candidates) {
      if (candidate.itemCount <= 0) continue; // an empty basket is not an abandonment
      const record = await this.repo.createOpen(candidate);
      if (record) {
        classified += 1;
        await this.sink.publish(record);
      }
    }
    const expired = await this.repo.expireOverdue(now);
    return { classified, expired };
  }

  async summary() {
    return this.repo.summary();
  }

  async recent(limit = 50) {
    return this.repo.recent(Math.min(200, Math.max(1, limit)));
  }
}

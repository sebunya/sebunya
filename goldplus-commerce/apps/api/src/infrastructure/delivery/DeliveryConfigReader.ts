import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { deliveryConfigValue, deliveryConfigVersion } from '../db/schema/delivery';
import { registryDefaults } from '../../domain/delivery/DeliveryConfigRegistry';

/**
 * Reads the live delivery configuration.
 *
 * The live values are the most recently PUBLISHED version, layered over the
 * registry's shipped defaults. Only values Rob explicitly chose have defaults —
 * the rounding step and the customer-facing copy — so a key absent from both
 * is genuinely unset, and the model refuses rather than substituting anything.
 *
 * A draft or scheduled version is deliberately invisible here: nothing takes
 * effect from typing, and a scheduled change takes effect when it is published,
 * not when it is written.
 */
/** How long one process trusts its copy of the published configuration. A publish or revert clears it at once. */
export const CONFIG_SNAPSHOT_TTL_MS = 5_000;

export class DeliveryConfigReader {
  private snapshot: { at: number; versionId: string | null; values: Record<string, string> } | null = null;

  /**
   * A quote used to read the two configuration tables eight times (the route
   * before its cache, the use case three ways, each reading the version
   * first): sixteen queries per cache miss, half of them this. One snapshot
   * per process for a few seconds serves them all; publishing or reverting a
   * version calls `invalidate()` so a new price is live on the next quote.
   */
  private async load(): Promise<{ versionId: string | null; values: Record<string, string> }> {
    const now = Date.now();
    if (this.snapshot && now - this.snapshot.at < CONFIG_SNAPSHOT_TTL_MS) return this.snapshot;
    const row = await db.query.deliveryConfigVersion.findFirst({
      where: eq(deliveryConfigVersion.status, 'published'),
      orderBy: [desc(deliveryConfigVersion.publishedAt)],
    });
    const versionId = row?.id ?? null;
    const values = { ...registryDefaults() };
    if (versionId) {
      const rows = await db.query.deliveryConfigValue.findMany({ where: eq(deliveryConfigValue.versionId, versionId) });
      for (const r of rows) if (r.configValue !== null) values[r.configKey] = r.configValue;
    }
    this.snapshot = { at: now, versionId, values };
    return this.snapshot;
  }

  /** Forget the snapshot: the next read goes to the database. Called by publish and revert. */
  invalidate(): void {
    this.snapshot = null;
  }

  async publishedVersionId(): Promise<string | null> {
    return (await this.load()).versionId;
  }

  /**
   * Registry defaults with the published version layered on top. Returns
   * strings; the caller parses against the registry's declared type.
   */
  async currentValues(): Promise<Record<string, string>> {
    return { ...(await this.load()).values };
  }

  /** Numeric view, for the model. Non-numeric and unset keys are simply absent. */
  async numericValues(): Promise<Record<string, number>> {
    const raw = await this.currentValues();
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (v !== '' && Number.isFinite(n)) out[k] = n;
    }
    return out;
  }

  /** One customer-facing string, or null when the key is not in the registry. */
  async copy(key: string): Promise<string | null> {
    const values = await this.currentValues();
    return values[key] ?? null;
  }

  /** Whether a value was set by a person or proposed by the nightly model. */
  async provenance(): Promise<Record<string, 'human' | 'model_proposed'>> {
    const versionId = await this.publishedVersionId();
    if (!versionId) return {};
    const rows = await db.query.deliveryConfigValue.findMany({
      where: and(eq(deliveryConfigValue.versionId, versionId)),
    });
    const out: Record<string, 'human' | 'model_proposed'> = {};
    for (const r of rows) out[r.configKey] = r.origin as 'human' | 'model_proposed';
    return out;
  }
}

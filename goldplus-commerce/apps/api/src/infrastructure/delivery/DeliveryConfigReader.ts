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
export class DeliveryConfigReader {
  async publishedVersionId(): Promise<string | null> {
    const row = await db.query.deliveryConfigVersion.findFirst({
      where: eq(deliveryConfigVersion.status, 'published'),
      orderBy: [desc(deliveryConfigVersion.publishedAt)],
    });
    return row?.id ?? null;
  }

  /**
   * Registry defaults with the published version layered on top. Returns
   * strings; the caller parses against the registry's declared type.
   */
  async currentValues(): Promise<Record<string, string>> {
    const values = { ...registryDefaults() };
    const versionId = await this.publishedVersionId();
    if (!versionId) return values;
    const rows = await db.query.deliveryConfigValue.findMany({
      where: eq(deliveryConfigValue.versionId, versionId),
    });
    for (const r of rows) {
      if (r.configValue !== null) values[r.configKey] = r.configValue;
    }
    return values;
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

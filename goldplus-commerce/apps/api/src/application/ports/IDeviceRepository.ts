import { DeviceConfidence, DeviceFitType } from '../../domain/products/Devices';
import { ImportRowError, RawCompatibilityRow } from '../../domain/products/DeviceCompatibilityImport';

export interface CreateDeviceInput {
  brand: string;
  model: string;
  modelAliases?: string[];
  releaseYear?: number | null;
  connectorType?: string | null;
  chargingWattageMax?: number | null;
  popularityRankUg?: number | null;
}

export interface CompatibleProduct {
  productId: string;
  sku: string;
  name: string;
  fitType: DeviceFitType;
  confidence: DeviceConfidence;
}

export interface CompatibilityImportOutcome {
  committed: number;
  errors: ImportRowError[];
}

export interface IDeviceRepository {
  createDevice(input: CreateDeviceInput): Promise<{ id: string; slug: string }>;
  /** Resolve a free-text device query to one active device, or signal ambiguity. */
  resolveDeviceQuery(query: string): Promise<{ kind: 'RESOLVED'; deviceId: string } | { kind: 'NOT_FOUND' } | { kind: 'AMBIGUOUS'; deviceIds: string[] }>;
  /** AC1 — all compatible products for a device, fit_type then popularity, ONE query. */
  compatibleProducts(deviceId: string): Promise<CompatibleProduct[]>;
  /** AC3 — up to `limit` accessory suggestions for a device, excluding the given
   * cart products and any inactive / unapproved / out-of-stock product. ONE query. */
  accessorySuggestions(deviceId: string, excludeProductIds: string[], limit: number): Promise<CompatibleProduct[]>;
  /** AC5 — validate the ENTIRE file, then commit canonical rows in one transaction
   * only if there are zero errors. Refs are resolved (sku/id → product, slug →
   * device); unresolved refs are per-row errors. */
  importCompatibility(rows: RawCompatibilityRow[], ctx: { actorId: string; fileByteLength?: number }): Promise<CompatibilityImportOutcome>;
}

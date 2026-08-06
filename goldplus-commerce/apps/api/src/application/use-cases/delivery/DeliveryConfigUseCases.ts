import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { validateConfigDraft, ConfigProblem } from '../../../domain/delivery/DeliveryConfigValidation';
import { LAUNCH_KEYS } from '../../../domain/delivery/DeliveryConfigRegistry';
import {
  AreaInput,
  BandPreviewRow,
  DISTANCE_BANDS,
  DistanceBand,
  NEUTRAL_FACTOR,
  QuoteInputs,
  isDistanceBand,
  previewAcrossBands,
} from '../../../domain/delivery/DeliveryModel';
import { resolveFulfilmentMode } from '../../../domain/delivery/DeliveryFulfilmentMode';
import { quoteFulfilment } from '../../../domain/delivery/DeliveryQuoteService';

/**
 * Configuration draft → preview → publish → revert (brief PART 6).
 *
 * No change takes effect from typing. A draft is a version row with status
 * `draft`; publishing flips it and stamps who and why. Reverting does NOT
 * un-publish — it publishes a NEW version carrying the old values, with
 * `reverted_from` set, because an audit trail that can lose a row is not one.
 *
 * The preview is mandatory and is the only place a human catches an answer that
 * was right in form and wrong in meaning. It is therefore not optional in the
 * use case either: `PublishConfigVersionUseCase` refuses a version that has not
 * been previewed and confirmed.
 */

type Fail = { ok: false; code: string; message: string; problems?: ConfigProblem[] };
const fail = (code: string, message: string, problems?: ConfigProblem[]): Fail => ({ ok: false, code, message, problems });

export interface ConfigVersionRow {
  id: string;
  status: string;
  reason: string | null;
  createdBy: string | null;
  publishedBy: string | null;
  publishedAt: Date | null;
  scheduledFor: Date | null;
  revertedFrom: string | null;
  createdAt: Date;
}

export interface ConfigValueInput {
  key: string;
  value: string;
  /** `human` for a person, `model_proposed` for the nightly job. Never forged. */
  origin: 'human' | 'model_proposed';
  sampleSize: number | null;
}

export interface IDeliveryConfigRepository {
  createDraft(input: {
    createdBy: string | null;
    reason: string | null;
    values: ConfigValueInput[];
  }): Promise<ConfigVersionRow>;
  findVersion(versionId: string): Promise<ConfigVersionRow | null>;
  valuesForVersion(versionId: string): Promise<Record<string, string>>;
  valueRowsForVersion(versionId: string): Promise<Array<ConfigValueInput>>;
  publish(input: { versionId: string; publishedBy: string; scheduledFor: Date | null }): Promise<ConfigVersionRow>;
  publishedVersion(): Promise<ConfigVersionRow | null>;
  listVersions(limit: number): Promise<ConfigVersionRow[]>;
  /** One named real area per band, for the mandatory preview. */
  sampleAreaPerBand(): Promise<Array<{ band: DistanceBand; areaSlug: string; areaLabel: string; area: AreaInput }>>;
  /** Areas from recent real orders, so the preview is not only synthetic. */
  recentOrderAreas(limit: number): Promise<Array<{ orderNumber: string; areaSlug: string; areaLabel: string; area: AreaInput }>>;
}

/* ── Draft ──────────────────────────────────────────────────────────────── */

export class DraftConfigVersionUseCase {
  constructor(
    private readonly repo: IDeliveryConfigRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: {
    values: Record<string, string>;
    reason: string | null;
    actorId: string;
    origin?: 'human' | 'model_proposed';
    sampleSizes?: Record<string, number>;
  }): Promise<{ ok: true; version: ConfigVersionRow } | Fail> {
    const entries = Object.entries(input.values).filter(([, v]) => v !== null && v !== undefined);
    if (entries.length === 0) return fail('EMPTY_DRAFT', 'A draft with no values changes nothing.');

    const problems = validateConfigDraft(Object.fromEntries(entries));
    if (problems.length > 0) {
      return fail('INVALID_DRAFT', problems[0].message, problems);
    }

    const version = await this.repo.createDraft({
      createdBy: input.actorId,
      reason: input.reason,
      values: entries.map(([key, value]) => ({
        key,
        value,
        origin: input.origin ?? 'human',
        sampleSize: input.sampleSizes?.[key] ?? null,
      })),
    });

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_CONFIG_DRAFTED',
      entity: 'delivery_config_version',
      entityId: version.id,
      previousState: null,
      newState: { keys: entries.map(([k]) => k), reason: input.reason, origin: input.origin ?? 'human' },
    });
    return { ok: true, version };
  }
}

/* ── Preview ────────────────────────────────────────────────────────────── */

export interface ConfigPreview {
  versionId: string;
  /** The values as they would take effect: published, with the draft on top. */
  effective: Record<string, string>;
  /** Which of the mandatory launch values would still be missing. */
  stillMissing: string[];
  bands: BandPreviewRow[];
  /** Real recent orders repriced. Empty is a fact, not a failure. */
  orders: Array<{
    orderNumber: string;
    areaLabel: string;
    beforeFeeUgx: number | null;
    afterFeeUgx: number | null;
    differenceUgx: number | null;
    beforeReason: string | null;
    afterReason: string | null;
  }>;
  /** Plain-language summary above the tables, per PART 6. */
  impactSummary: string;
  problems: ConfigProblem[];
}

/**
 * Run a draft against real recent orders and one named area in every band.
 *
 * "An operator who answered 40 minutes when they meant 40 minutes each way will
 * see it here and nowhere else." That sentence is the reason this is mandatory
 * rather than offered.
 */
export class PreviewConfigVersionUseCase {
  constructor(
    private readonly repo: IDeliveryConfigRepository,
    private readonly currentValues: () => Promise<Record<string, string>>,
  ) {}

  async execute(input: { versionId: string; recentOrderLimit?: number }): Promise<{ ok: true; preview: ConfigPreview } | Fail> {
    const version = await this.repo.findVersion(input.versionId);
    if (!version) return fail('VERSION_NOT_FOUND', 'That configuration version does not exist.');

    const live = await this.currentValues();
    const draft = await this.repo.valuesForVersion(input.versionId);
    const effective = { ...live, ...draft };
    const problems = validateConfigDraft(draft);

    const numeric = (source: Record<string, string>): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(source)) {
        const n = Number(v);
        if (v !== '' && Number.isFinite(n)) out[k] = n;
      }
      return out;
    };
    const before = numeric(live);
    const after = numeric(effective);

    const [samples, orders] = await Promise.all([
      this.repo.sampleAreaPerBand(),
      this.repo.recentOrderAreas(input.recentOrderLimit ?? 20),
    ]);

    const base = (config: Record<string, number>): Omit<QuoteInputs, 'area'> => ({
      config,
      hasActiveOrigin: true,
      originCode: null,
      corridorFactor: NEUTRAL_FACTOR,
      hourFactor: NEUTRAL_FACTOR,
      detourFactor: NEUTRAL_FACTOR,
      lastMileMinutes: { value: 0, sampleSize: 0 },
      areaSampleSize: 0,
      observedMinutes: null,
      onTimeTargetBps: after.on_time_target_bps ?? null,
      windowMinSampleSize: after.window_min_sample_size ?? null,
      configVersionId: input.versionId,
    });

    // The preview must show what a CUSTOMER would see, which means going
    // through the one quoting service rather than the computed model directly.
    // An operator raising the rider ceiling needs to watch B5 flip from bus to
    // rider in this table — that is the change they are actually approving.
    const bandOf = (b: string | null): DistanceBand | null => (b && isDistanceBand(b) ? (b as DistanceBand) : null);
    const modeFor = (area: AreaInput, config: Record<string, number>, raw: Record<string, string>) =>
      resolveFulfilmentMode(
        { ...area, declaredMode: null },
        bandOf(raw.own_rider_max_band ?? null),
      );

    const withModes = (area: AreaInput, raw: Record<string, string>): AreaInput => ({
      ...area,
      fulfilmentMode: resolveFulfilmentMode({ ...area, declaredMode: null }, bandOf(raw.own_rider_max_band ?? null)),
    });

    const bands = previewAcrossBands(
      samples.map((s) => ({ ...s, area: withModes(s.area, effective) })),
      base(after),
    );

    const quoteFor = (area: AreaInput, config: Record<string, number>, raw: Record<string, string>) => {
      const mode = modeFor(area, config, raw);
      return quoteFulfilment({
        area: { ...area, fulfilmentMode: mode },
        mode,
        rider: base(config),
        bus: {
          // The preview never invents a rate card. A bus destination with no
          // negotiated card reads NO_RATE_CARD here exactly as it will at
          // checkout, which is the honest picture of coverage today.
          cards: [],
          office: null,
          parcelClass: 'small',
          parcelClassRefusal: null,
          destinationTown: area.district ?? null,
          destinationDistrict: area.district ?? null,
          at: new Date(0),
          declaredValueUgx: null,
        },
        subtotalUgx: 0,
        proportionality: { feeToValueRatioCeiling: null, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
      });
    };

    const orderRows = orders.map((o) => {
      const b = quoteFor(o.area, before, live);
      const a = quoteFor(o.area, after, effective);
      const beforeFee = b.kind === 'unavailable' ? null : b.feeUgx;
      const afterFee = a.kind === 'unavailable' ? null : a.feeUgx;
      return {
        orderNumber: o.orderNumber,
        areaLabel: o.areaLabel,
        beforeFeeUgx: beforeFee,
        afterFeeUgx: afterFee,
        differenceUgx: beforeFee !== null && afterFee !== null ? afterFee - beforeFee : null,
        beforeReason: b.kind === 'unavailable' ? b.reason : null,
        afterReason: a.kind === 'unavailable' ? a.reason : null,
      };
    });

    const stillMissing = LAUNCH_KEYS.filter((k) => {
      const v = after[k];
      return v === undefined || !Number.isFinite(v);
    });

    const quotable = bands.filter((r) => r.feeUgx !== null);
    const impactSummary = buildImpactSummary({ stillMissing, quotable, bands, orderRows });

    return { ok: true, preview: { versionId: input.versionId, effective, stillMissing, bands, orders: orderRows, impactSummary, problems } };
  }
}

function buildImpactSummary(input: {
  stillMissing: readonly string[];
  quotable: BandPreviewRow[];
  bands: BandPreviewRow[];
  orderRows: ConfigPreview['orders'];
}): string {
  if (input.stillMissing.length > 0) {
    return `${input.stillMissing.length} of the five required values are still missing, so this would publish without the module being able to quote. Nothing would change for customers.`;
  }
  if (input.quotable.length === 0) {
    return 'No band produced a fee. Something in these values stops the module quoting — check the table below before publishing.';
  }
  const fees = input.quotable.map((r) => r.feeUgx as number);
  const low = Math.min(...fees);
  const high = Math.max(...fees);
  const nearest = input.quotable[0];
  const furthest = input.quotable[input.quotable.length - 1];
  const changed = input.orderRows.filter((o) => o.differenceUgx !== null && o.differenceUgx !== 0).length;
  const newlyQuotable = input.orderRows.filter((o) => o.beforeReason !== null && o.afterReason === null).length;

  const parts = [
    `Delivery would cost between UGX ${low.toLocaleString('en-UG')} and UGX ${high.toLocaleString('en-UG')}, from UGX ${(nearest.feeUgx as number).toLocaleString('en-UG')} for ${nearest.areaLabel} to UGX ${(furthest.feeUgx as number).toLocaleString('en-UG')} for ${furthest.areaLabel}.`,
  ];
  if (input.orderRows.length === 0) {
    parts.push('There are no recent orders to reprice, so the band table above is the only check available. Read it carefully.');
  } else {
    parts.push(
      `Of ${input.orderRows.length} recent orders, ${newlyQuotable} would now get an automatic fee that previously did not, and ${changed} would be charged a different amount.`,
    );
  }
  return parts.join(' ');
}

/* ── Publish ────────────────────────────────────────────────────────────── */

export class PublishConfigVersionUseCase {
  constructor(
    private readonly repo: IDeliveryConfigRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: {
    versionId: string;
    actorId: string;
    /** The operator has seen the band preview and confirmed it. */
    previewConfirmed: boolean;
    scheduledFor: Date | null;
  }): Promise<{ ok: true; version: ConfigVersionRow } | Fail> {
    const version = await this.repo.findVersion(input.versionId);
    if (!version) return fail('VERSION_NOT_FOUND', 'That configuration version does not exist.');
    if (version.status === 'published') return fail('ALREADY_PUBLISHED', 'That version is already live.');
    // The preview is the safeguard, so it is enforced here and not only in the
    // interface. A route that forgot to ask cannot publish by accident.
    if (!input.previewConfirmed) {
      return fail('PREVIEW_NOT_CONFIRMED', 'Publish is only possible after the preview has been shown and confirmed.');
    }
    const values = await this.repo.valuesForVersion(input.versionId);
    const problems = validateConfigDraft(values);
    if (problems.length > 0) return fail('INVALID_DRAFT', problems[0].message, problems);

    const previous = await this.repo.publishedVersion();
    const published = await this.repo.publish({
      versionId: input.versionId,
      publishedBy: input.actorId,
      scheduledFor: input.scheduledFor,
    });

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_CONFIG_PUBLISHED',
      entity: 'delivery_config_version',
      entityId: input.versionId,
      previousState: { publishedVersionId: previous?.id ?? null },
      newState: {
        publishedVersionId: input.versionId,
        reason: version.reason,
        keys: Object.keys(values),
        scheduledFor: input.scheduledFor?.toISOString() ?? null,
      },
    });
    return { ok: true, version: published };
  }
}

/* ── Revert ─────────────────────────────────────────────────────────────── */

/**
 * One action, and it moves forward rather than backward: a NEW version carrying
 * the old values, published, with `reverted_from` recording where they came
 * from. Deleting or un-publishing would lose the fact that the bad version was
 * ever live, which is exactly what an operator needs to see afterwards.
 */
export class RevertConfigVersionUseCase {
  constructor(
    private readonly repo: IDeliveryConfigRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: { toVersionId: string; actorId: string; reason: string }): Promise<{ ok: true; version: ConfigVersionRow } | Fail> {
    const target = await this.repo.findVersion(input.toVersionId);
    if (!target) return fail('VERSION_NOT_FOUND', 'That configuration version does not exist.');
    if (!input.reason || input.reason.trim().length < 5) {
      return fail('REASON_REQUIRED', 'A revert needs a written reason.');
    }
    const rows = await this.repo.valueRowsForVersion(input.toVersionId);
    if (rows.length === 0) return fail('EMPTY_VERSION', 'That version holds no values, so there is nothing to revert to.');

    const current = await this.repo.publishedVersion();
    const draft = await this.repo.createDraft({
      createdBy: input.actorId,
      reason: `Revert to ${input.toVersionId}: ${input.reason.trim()}`,
      values: rows,
    });
    const published = await this.repo.publish({ versionId: draft.id, publishedBy: input.actorId, scheduledFor: null });

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'DELIVERY_CONFIG_REVERTED',
      entity: 'delivery_config_version',
      entityId: draft.id,
      previousState: { publishedVersionId: current?.id ?? null },
      newState: { publishedVersionId: draft.id, revertedFrom: input.toVersionId, reason: input.reason.trim() },
    });
    return { ok: true, version: published };
  }
}

/** Every band, so the setup screen can say which are covered. */
export const ALL_BANDS: readonly DistanceBand[] = DISTANCE_BANDS;

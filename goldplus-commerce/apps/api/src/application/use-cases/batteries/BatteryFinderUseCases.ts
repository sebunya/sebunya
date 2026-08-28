import { createHash } from 'node:crypto';
import {
  DEFAULT_BATTERY_FINDER_CONFIG,
  validateBatteryFinderConfig,
  type BatteryFinderConfig,
  type BatteryRequestStatus,
  type FinderBatteryResultDto,
  type FinderBrandDto,
  type FinderDeviceDto,
  type FinderResolution,
  type PublicFitState,
} from '@goldplus/shared';
import type { IBatteryFinderRepository, PublicFitRow, FinderEventWrite } from '../../ports/IBatteryFinderRepository';
import type { IBatteryCatalogueRepository } from '../../ports/IBatteryCatalogueRepository';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { orderBrands, orderModels } from '../../../domain/batteries/DeviceHierarchy';
import { publicFitLabel, publicFitRank, publicFitState } from '../../../domain/batteries/CompatibilityWorkflow';
import { isExactTier, rankSearch } from '../../../domain/batteries/FinderRanking';
import { normaliseBatteryCode } from '../../../domain/batteries/BatteryCodes';
import { normaliseDeviceToken } from '../../../domain/products/Devices';
import { invalid, notFound, unprocessable } from './BatteryOperationError';

const MAX_QUERY = 120;

/** Public finder + the admin demand queue. Nothing leaves here that a customer should not see. */
export class BatteryFinderUseCases {
  private readonly audit: CreateAuditLogUseCase;
  constructor(
    private readonly repo: IBatteryFinderRepository,
    private readonly batteries: IBatteryCatalogueRepository,
    auditRepo: IAuditRepository,
    private readonly pepper: string,
  ) {
    this.audit = new CreateAuditLogUseCase(auditRepo);
  }

  // ---------------------------------------------------------------- config
  async config(): Promise<BatteryFinderConfig> {
    const row = await this.repo.getConfig();
    return row ? { ...DEFAULT_BATTERY_FINDER_CONFIG, ...row.config } : DEFAULT_BATTERY_FINDER_CONFIG;
  }

  async configWithVersion() {
    const row = await this.repo.getConfig();
    return { config: row ? { ...DEFAULT_BATTERY_FINDER_CONFIG, ...row.config } : DEFAULT_BATTERY_FINDER_CONFIG, version: row?.version ?? 0 };
  }

  seedConfig() {
    return this.repo.seedConfig(DEFAULT_BATTERY_FINDER_CONFIG);
  }

  async saveConfig(input: unknown, expectedVersion: number, actorId: string) {
    const validated = validateBatteryFinderConfig(input);
    if (!validated.ok) throw unprocessable('INVALID_CONFIG', validated.errors[0], validated.errors);
    const before = await this.configWithVersion();
    const saved = await this.repo.saveConfig(validated.value, expectedVersion, actorId);
    if (!saved) throw unprocessable('STALE_VERSION', 'The finder settings changed since you loaded them. Reload and try again.');
    await this.audit.execute({ actorId, action: 'BATTERY_FINDER_CONFIG_UPDATED', entity: 'battery_finder_config', entityId: '00000000-0000-0000-0000-000000000001', previousState: before.config, newState: validated.value });
    return { config: validated.value, version: saved.version };
  }

  sessionHash(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    return createHash('sha256').update(`${this.pepper}:${sessionId}`).digest('hex');
  }

  // ---------------------------------------------------------------- browse
  async brands(): Promise<FinderBrandDto[]> {
    const cfg = await this.config();
    const brands = await this.repo.brands(cfg.showAwaitingVerification);
    // The admin's chosen mode decides the order; the repository only supplies
    // the inputs (manual order, verified coverage, recent demand).
    return orderBrands(brands, cfg.brandOrderMode).map(({ displayOrder: _o, demandCount: _d, ...b }) => b);
  }

  async brand(slug: string) {
    const cfg = await this.config();
    const found = await this.repo.brandBySlug(slug, cfg.showAwaitingVerification);
    if (!found) throw notFound('Brand');
    // The repository already returns series in their manual order; models are
    // ordered here so featured, newer and more-searched phones come first.
    const devices = orderModels(found.devices).map(({ displayOrder: _o, demandCount: _d, seriesId: _s, ...d }) => d);
    return { brand: found.brand, series: found.series, devices };
  }

  private toResult(row: PublicFitRow, state: PublicFitState): FinderBatteryResultDto {
    return {
      ...row.product,
      inStock: row.stockQuantity > 0,
      fitState: state,
      fitLabel: publicFitLabel(state),
      condition: state === 'CONDITIONAL' ? row.publicCondition : null,
    };
  }

  private async resultsForDevice(deviceId: string, cfg: BatteryFinderConfig): Promise<FinderBatteryResultDto[]> {
    const rows = await this.repo.fitsForDevice(deviceId);
    const out: Array<{ r: FinderBatteryResultDto; rank: number }> = [];
    for (const row of rows) {
      const state = publicFitState({ workflowStatus: row.workflowStatus as never, evidenceStatus: row.evidenceStatus as never, batteryLifecycle: row.batteryLifecycle, productApproved: row.productApproved, productActive: row.productActive, stockQuantity: row.stockQuantity, showAwaitingVerification: cfg.showAwaitingVerification });
      if (!state) continue;
      out.push({ r: this.toResult(row, state), rank: publicFitRank(state) });
    }
    return out.sort((a, b) => a.rank - b.rank || a.r.name.localeCompare(b.r.name)).map((x) => x.r);
  }

  async device(slug: string, sessionId?: string | null) {
    const cfg = await this.config();
    const device = await this.repo.deviceBySlug(slug);
    if (!device) throw notFound('Device');
    const results = await this.resultsForDevice(device.id, cfg);
    void this.repo.recordEvent({ eventType: 'DEVICE_SELECTED', mode: 'FIND_BY_PHONE', queryNormalised: null, outcome: results.length ? outcomeFor(results[0].fitState) : 'NO_RESULT', brandId: null, seriesId: null, deviceId: device.id, batteryProductId: null, resultCount: results.length, aliasHit: false, sessionHash: this.sessionHash(sessionId) }).catch(() => undefined);
    return { device, results, config: cfg };
  }

  /** Everything the product page needs about a battery. */
  async battery(slug: string) {
    const cfg = await this.config();
    const product = await this.repo.batteryPublicBySlug(slug);
    if (!product) return null;
    const rows = await this.repo.fitsForBattery(product.productId);
    const devices: Array<FinderDeviceDto & { fitState: PublicFitState; fitLabel: string; condition: string | null }> = [];
    for (const row of rows) {
      const state = publicFitState({ workflowStatus: row.workflowStatus as never, evidenceStatus: row.evidenceStatus as never, batteryLifecycle: row.batteryLifecycle, productApproved: row.productApproved, productActive: row.productActive, stockQuantity: row.stockQuantity, showAwaitingVerification: cfg.showAwaitingVerification });
      if (!state) continue;
      devices.push({ ...row.device, fitState: state, fitLabel: publicFitLabel(state), condition: state === 'CONDITIONAL' ? row.publicCondition : null });
    }
    devices.sort((a, b) => publicFitRank(a.fitState) - publicFitRank(b.fitState) || a.label.localeCompare(b.label));
    return { battery: product, devices, config: cfg, isPublished: product.lifecycleStatus === 'ACTIVE' };
  }

  /** Does this battery fit the device the customer selected? Used by the product page and the cart. */
  async check(deviceSlug: string, productIds: string[]) {
    const cfg = await this.config();
    const device = await this.repo.deviceBySlug(deviceSlug);
    if (!device) return { device: null, fits: {} as Record<string, { fitState: PublicFitState | null; fitLabel: string | null; condition: string | null }> };
    const rows = await this.repo.fitsForDevice(device.id);
    const fits: Record<string, { fitState: PublicFitState | null; fitLabel: string | null; condition: string | null }> = {};
    for (const id of productIds.slice(0, 100)) {
      const row = rows.find((r) => r.productId === id);
      const state = row ? publicFitState({ workflowStatus: row.workflowStatus as never, evidenceStatus: row.evidenceStatus as never, batteryLifecycle: row.batteryLifecycle, productApproved: row.productApproved, productActive: row.productActive, stockQuantity: row.stockQuantity, showAwaitingVerification: cfg.showAwaitingVerification }) : null;
      fits[id] = { fitState: state, fitLabel: state ? publicFitLabel(state) : null, condition: state === 'CONDITIONAL' ? row?.publicCondition ?? null : null };
    }
    return { device, fits };
  }

  // ---------------------------------------------------------------- search
  async search(rawQuery: string, sessionId?: string | null): Promise<FinderResolution & { query: string; config: BatteryFinderConfig }> {
    const cfg = await this.config();
    const query = rawQuery.replace(/[\x00-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
    if (query.length < 2) return { kind: 'NO_RESULT', message: 'Type at least two characters.', query, config: cfg };
    const [devices, batteries] = await Promise.all([this.repo.deviceCandidates(), this.repo.batteryCandidates()]);
    const qDev = normaliseDeviceToken(query);
    const qCode = normaliseBatteryCode(query);
    const [fuzzyDevices, fuzzyBatteries] = await Promise.all([
      qDev.length >= 3 ? this.repo.fuzzyDevices(qDev, 8) : Promise.resolve([]),
      qCode.length >= 3 ? this.repo.fuzzyBatteries(qCode, 8) : Promise.resolve([]),
    ]);
    const ranked = rankSearch({ query, devices, batteries, fuzzyDevices, fuzzyBatteries });
    const mode: FinderEventWrite['mode'] = ranked.some((r) => r.kind === 'BATTERY' && r.tier <= 2) ? 'SEARCH_CODE' : 'FIND_BY_PHONE';
    const event = (outcome: string, extra: Partial<FinderEventWrite> = {}) =>
      this.repo.recordEvent({ eventType: 'SEARCH', mode, queryNormalised: qDev.slice(0, 120), outcome, brandId: null, seriesId: null, deviceId: null, batteryProductId: null, resultCount: 0, aliasHit: false, sessionHash: this.sessionHash(sessionId), ...extra }).catch(() => undefined);

    const exact = ranked.filter((r) => isExactTier(r.tier));
    const exactBatteries = exact.filter((r): r is Extract<typeof r, { kind: 'BATTERY' }> => r.kind === 'BATTERY');
    const exactDevices = exact.filter((r): r is Extract<typeof r, { kind: 'DEVICE' }> => r.kind === 'DEVICE');

    if (exactBatteries.length === 1 && exactDevices.length === 0) {
      const productId = exactBatteries[0].productId;
      const product = await this.repo.batteryPublic(productId);
      const rows = await this.repo.fitsForBattery(productId);
      const publicDevices = rows
        .map((row) => ({ row, state: publicFitState({ workflowStatus: row.workflowStatus as never, evidenceStatus: row.evidenceStatus as never, batteryLifecycle: row.batteryLifecycle, productApproved: row.productApproved, productActive: row.productActive, stockQuantity: row.stockQuantity, showAwaitingVerification: cfg.showAwaitingVerification }) }))
        .filter((x) => x.state)
        .map((x) => x.row.device);
      if (product && product.lifecycleStatus === 'ACTIVE' && product.productApproved && product.productActive) {
        const { lifecycleStatus: _l, stockQuantity, productApproved: _a, productActive: _p, ...publicProduct } = product;
        const state: PublicFitState = stockQuantity > 0 ? 'VERIFIED_IN_STOCK' : 'VERIFIED_OUT_OF_STOCK';
        void event('RESOLVED', { mode: 'SEARCH_CODE', batteryProductId: productId, resultCount: publicDevices.length, aliasHit: exactBatteries[0].tier === 5 });
        return { kind: 'BATTERY', battery: { ...publicProduct, inStock: stockQuantity > 0, fitState: state, fitLabel: publicFitLabel(state), condition: null }, devices: publicDevices, query, config: cfg };
      }
      // The code exists but the battery is not published: say so, do not pretend it is absent.
      void event('NO_RESULT', { mode: 'SEARCH_CODE', batteryProductId: productId, aliasHit: exactBatteries[0].tier === 5 });
      return { kind: 'NO_RESULT', message: 'We know this battery code but it is not available online yet. Send us the details and we will confirm.', query, config: cfg };
    }
    if (exactDevices.length === 1) {
      const device = await this.repo.deviceById(exactDevices[0].deviceId);
      if (device) {
        const results = await this.resultsForDevice(device.id, cfg);
        void event(results.length ? outcomeFor(results[0].fitState) : 'NO_RESULT', { deviceId: device.id, resultCount: results.length, aliasHit: exactDevices[0].tier === 5 });
        return { kind: 'DEVICE', device, results, query, config: cfg };
      }
    }
    if (exactDevices.length > 1) {
      const list = (await Promise.all(exactDevices.map((d) => this.repo.deviceById(d.deviceId)))).filter((d): d is FinderDeviceDto => !!d);
      void event('AMBIGUOUS', { resultCount: list.length });
      return { kind: 'AMBIGUOUS_DEVICE', devices: list, message: 'More than one phone matches. Pick your exact model number so we show the right battery.', query, config: cfg };
    }
    const suggestions = ranked.filter((r) => !isExactTier(r.tier));
    if (suggestions.length) {
      const deviceList = (await Promise.all(suggestions.filter((s): s is Extract<typeof s, { kind: 'DEVICE' }> => s.kind === 'DEVICE').map((s) => this.repo.deviceById(s.deviceId)))).filter((d): d is FinderDeviceDto => !!d);
      const batteryIds = suggestions.filter((s): s is Extract<typeof s, { kind: 'BATTERY' }> => s.kind === 'BATTERY').map((s) => s.productId);
      // Only published, approved, active batteries are suggested. The candidate
      // set behind the prefix tier is every non-archived battery, which includes
      // drafts from Quick Add and imports, and those were suggested to the public
      // with their code, slug and name.
      const batteryList = (await Promise.all(batteryIds.map((id) => this.repo.batteryPublic(id))))
        .filter((b): b is NonNullable<typeof b> => !!b && b.lifecycleStatus === 'ACTIVE' && b.productApproved && b.productActive)
        .map((b) => ({ canonicalCode: b.canonicalCode, slug: b.slug, name: b.name }));
      void event('NO_RESULT', { resultCount: 0 });
      return { kind: 'SUGGESTIONS', devices: deviceList, batteries: batteryList, message: 'No exact match. Did you mean one of these? Pick it to see checked batteries; we never guess a fit from a similar name.', query, config: cfg };
    }
    void event('NO_RESULT');
    return { kind: 'NO_RESULT', message: cfg.noResultBody, query, config: cfg };
  }

  async recordEvent(input: { eventType: FinderEventWrite['eventType']; mode: FinderEventWrite['mode']; deviceSlug?: string | null; productId?: string | null; query?: string | null; outcome?: string | null; sessionId?: string | null }) {
    const device = input.deviceSlug ? await this.repo.deviceBySlug(input.deviceSlug) : null;
    await this.repo.recordEvent({
      eventType: input.eventType,
      mode: input.mode,
      queryNormalised: input.query ? normaliseDeviceToken(input.query).slice(0, 120) : null,
      outcome: input.outcome && ['NONE', 'RESOLVED', 'NO_RESULT', 'AMBIGUOUS', 'VERIFIED_IN_STOCK', 'VERIFIED_OUT_OF_STOCK', 'CONDITIONAL', 'AWAITING_VERIFICATION'].includes(input.outcome) ? input.outcome : 'NONE',
      brandId: null,
      seriesId: null,
      deviceId: device?.id ?? null,
      batteryProductId: input.productId ?? null,
      resultCount: 0,
      aliasHit: false,
      sessionHash: this.sessionHash(input.sessionId),
    });
  }

  // -------------------------------------------------------------- requests
  async submitRequest(input: { queryText: string | null; brandText: string | null; deviceText: string | null; modelNumberText: string | null; batteryCodeText: string | null; contactName: string | null; contactPhone: string | null; notes: string | null; source: 'FINDER_NO_RESULT' | 'PRODUCT_PAGE'; sessionId: string | null }) {
    const any = [input.queryText, input.deviceText, input.modelNumberText, input.batteryCodeText].some((v) => v && v.trim().length >= 2);
    if (!any) throw invalid('Tell us the phone model, its model number or the battery code.');
    const clip = (v: string | null, n: number) => (v ? v.replace(/\s+/g, ' ').trim().slice(0, n) || null : null);
    const query = clip(input.queryText, 200) ?? clip([input.brandText, input.deviceText, input.modelNumberText].filter(Boolean).join(' '), 200);
    const created = await this.repo.createRequest({
      source: input.source,
      queryText: query,
      queryNormalised: query ? normaliseDeviceToken(query).slice(0, 120) : null,
      brandText: clip(input.brandText, 80),
      deviceText: clip(input.deviceText, 120),
      modelNumberText: clip(input.modelNumberText, 80),
      batteryCodeText: clip(input.batteryCodeText, 120),
      contactName: clip(input.contactName, 120),
      contactPhone: clip(input.contactPhone, 32),
      notes: clip(input.notes, 1000),
      sessionHash: this.sessionHash(input.sessionId),
    });
    void this.repo.recordEvent({ eventType: 'REQUEST_SUBMITTED', mode: input.source === 'PRODUCT_PAGE' ? 'PRODUCT_PAGE' : 'FIND_BY_PHONE', queryNormalised: created.queryNormalised, outcome: 'NO_RESULT', brandId: null, seriesId: null, deviceId: null, batteryProductId: null, resultCount: 0, aliasHit: false, sessionHash: created.id ? this.sessionHash(input.sessionId) : null }).catch(() => undefined);
    return { id: created.id };
  }

  listRequests(status: BatteryRequestStatus | 'ALL', limit = 200) {
    return this.repo.listRequests(status, Math.min(limit, 500));
  }

  async resolveRequest(id: string, input: { action: 'MAP_DEVICE' | 'ADD_ALIAS' | 'MAP_BATTERY' | 'CREATE_DRAFT' | 'INVALID' | 'RESOLVED'; note: string | null; deviceId?: string | null; aliasId?: string | null; batteryProductId?: string | null }, actorId: string) {
    const request = await this.repo.findRequest(id);
    if (!request) throw notFound('Battery request');
    const statusByAction: Record<typeof input.action, BatteryRequestStatus> = { MAP_DEVICE: 'MAPPED_DEVICE', ADD_ALIAS: 'ALIAS_ADDED', MAP_BATTERY: 'BATTERY_MAPPED', CREATE_DRAFT: 'DRAFT_CREATED', INVALID: 'INVALID', RESOLVED: 'RESOLVED' };
    if (input.action === 'MAP_DEVICE' && !input.deviceId) throw invalid('Pick the device this request maps to.');
    if (input.action === 'ADD_ALIAS' && !input.aliasId) throw invalid('Add the alias first, then record it here.');
    if (input.action === 'MAP_BATTERY' && !input.batteryProductId) throw invalid('Pick the battery this request maps to.');
    if (input.action === 'CREATE_DRAFT' && !input.batteryProductId) throw invalid('Create the draft battery first, then record it here.');
    if ((input.action === 'INVALID' || input.action === 'RESOLVED') && !(input.note ?? '').trim()) throw invalid('A note is required.');
    const updated = await this.repo.resolveRequest(id, { status: statusByAction[input.action], resolutionNote: input.note, resolvedDeviceId: input.deviceId ?? null, resolvedAliasId: input.aliasId ?? null, resolvedBatteryProductId: input.batteryProductId ?? null, resolvedBy: actorId });
    await this.audit.execute({ actorId, action: 'BATTERY_REQUEST_RESOLVED', entity: 'battery_request', entityId: id, previousState: { status: request.status }, newState: { status: statusByAction[input.action], note: input.note, deviceId: input.deviceId ?? null, aliasId: input.aliasId ?? null, batteryProductId: input.batteryProductId ?? null } });
    return updated;
  }

  demandOverview(sinceDays = 30) {
    return this.repo.demandOverview(Math.min(Math.max(sinceDays, 1), 365));
  }

  async indexable(): Promise<boolean> {
    const cfg = await this.config();
    return (await this.repo.verifiedFitCount()) >= cfg.minVerifiedFitsForIndexing;
  }
}

function outcomeFor(state: PublicFitState): string {
  return state;
}

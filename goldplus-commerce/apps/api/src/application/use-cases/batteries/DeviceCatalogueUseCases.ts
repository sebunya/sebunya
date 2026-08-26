import type { IDeviceCatalogueRepository, DeviceListFilters, DeviceRecord } from '../../ports/IDeviceCatalogueRepository';
import type { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { normaliseAliases, normaliseDeviceToken } from '../../../domain/products/Devices';
import { brandSlug, deviceIdentitySlug, mergeImpact, normaliseOptional, seriesSlug } from '../../../domain/batteries/DeviceHierarchy';
import { conflict, invalid, notFound, unprocessable } from './BatteryOperationError';

export interface BrandWrite { name: string; searchAliases?: string[]; isFeatured?: boolean; displayOrder?: number; logoAssetId?: string | null }
export interface SeriesWrite { brandId: string; name: string; searchAliases?: string[]; displayOrder?: number }
export interface DeviceWrite {
  brandId: string;
  seriesId?: string | null;
  model: string;
  modelNumber?: string | null;
  variant?: string | null;
  modelAliases?: string[];
  releaseYear?: number | null;
  displayOrder?: number;
  sourceReference?: string | null;
}

export class DeviceCatalogueUseCases {
  private readonly audit: CreateAuditLogUseCase;
  constructor(private readonly repo: IDeviceCatalogueRepository, auditRepo: IAuditRepository) {
    this.audit = new CreateAuditLogUseCase(auditRepo);
  }

  // ---------------------------------------------------------------- brands
  listBrands(includeArchived = false) {
    return this.repo.listBrands(includeArchived);
  }

  async createBrand(input: BrandWrite, actorId: string) {
    const name = input.name.trim();
    if (!name || name.length > 60) throw invalid('Brand name is required (60 characters or fewer).');
    const nameNormalised = normaliseDeviceToken(name);
    if (await this.repo.findBrandByNormalised(nameNormalised)) throw conflict('BRAND_EXISTS', `Brand "${name}" already exists.`);
    const aliases = (input.searchAliases ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 20);
    const created = await this.repo.createBrand({
      name,
      nameNormalised,
      slug: brandSlug(name),
      searchAliases: aliases,
      searchAliasesNormalised: normaliseAliases(aliases),
      isFeatured: !!input.isFeatured,
      displayOrder: Math.max(0, Math.trunc(input.displayOrder ?? 0)),
      logoAssetId: input.logoAssetId ?? null,
      actorId,
    });
    await this.audit.execute({ actorId, action: 'DEVICE_BRAND_CREATED', entity: 'device_brand', entityId: created.id, newState: { name, aliases, isFeatured: created.isFeatured } });
    return created;
  }

  async updateBrand(id: string, input: Partial<BrandWrite>, actorId: string) {
    const before = await this.repo.findBrand(id);
    if (!before) throw notFound('Brand');
    const patch: Parameters<IDeviceCatalogueRepository['updateBrand']>[1] = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 60) throw invalid('Brand name is required (60 characters or fewer).');
      const nameNormalised = normaliseDeviceToken(name);
      const other = await this.repo.findBrandByNormalised(nameNormalised);
      if (other && other.id !== id) throw conflict('BRAND_EXISTS', `Brand "${name}" already exists. Merge devices into it instead.`);
      patch.name = name;
      patch.nameNormalised = nameNormalised;
      patch.slug = brandSlug(name);
    }
    if (input.searchAliases !== undefined) {
      const aliases = input.searchAliases.map((a) => a.trim()).filter(Boolean).slice(0, 20);
      patch.searchAliases = aliases;
      patch.searchAliasesNormalised = normaliseAliases(aliases);
    }
    if (input.isFeatured !== undefined) patch.isFeatured = !!input.isFeatured;
    if (input.displayOrder !== undefined) patch.displayOrder = Math.max(0, Math.trunc(input.displayOrder));
    if (input.logoAssetId !== undefined) patch.logoAssetId = input.logoAssetId;
    const updated = await this.repo.updateBrand(id, { ...patch, actorId });
    await this.audit.execute({ actorId, action: 'DEVICE_BRAND_UPDATED', entity: 'device_brand', entityId: id, previousState: { name: before.name, searchAliases: before.searchAliases, isFeatured: before.isFeatured, displayOrder: before.displayOrder }, newState: patch });
    return updated;
  }

  async setBrandStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string) {
    const before = await this.repo.findBrand(id);
    if (!before) throw notFound('Brand');
    const updated = await this.repo.setBrandStatus(id, status, actorId);
    await this.audit.execute({ actorId, action: status === 'ARCHIVED' ? 'DEVICE_BRAND_ARCHIVED' : 'DEVICE_BRAND_RESTORED', entity: 'device_brand', entityId: id, previousState: { status: before.status }, newState: { status } });
    return updated;
  }

  async reorderBrands(orderedIds: string[], actorId: string) {
    if (!orderedIds.length || orderedIds.length > 500) throw invalid('Provide the brand ids in the order you want.');
    await this.repo.reorderBrands(orderedIds, actorId);
    await this.audit.execute({ actorId, action: 'DEVICE_BRANDS_REORDERED', entity: 'device_brand', entityId: orderedIds[0], newState: { order: orderedIds } });
    return this.repo.listBrands(false);
  }

  // ---------------------------------------------------------------- series
  listSeries(brandId: string, includeArchived = false) {
    return this.repo.listSeries(brandId, includeArchived);
  }

  async createSeries(input: SeriesWrite, actorId: string) {
    const brand = await this.repo.findBrand(input.brandId);
    if (!brand) throw notFound('Brand');
    const name = input.name.trim();
    if (!name || name.length > 80) throw invalid('Series name is required (80 characters or fewer).');
    const nameNormalised = normaliseDeviceToken(name);
    if (await this.repo.findSeriesByNormalised(brand.id, nameNormalised)) throw conflict('SERIES_EXISTS', `Series "${name}" already exists under ${brand.name}.`);
    const aliases = (input.searchAliases ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 20);
    const created = await this.repo.createSeries({ brandId: brand.id, name, nameNormalised, slug: seriesSlug(name), searchAliases: aliases, searchAliasesNormalised: normaliseAliases(aliases), displayOrder: Math.max(0, Math.trunc(input.displayOrder ?? 0)), actorId });
    await this.audit.execute({ actorId, action: 'DEVICE_SERIES_CREATED', entity: 'device_series', entityId: created.id, newState: { brand: brand.name, name } });
    return created;
  }

  async updateSeries(id: string, input: Partial<Omit<SeriesWrite, 'brandId'>>, actorId: string) {
    const before = await this.repo.findSeries(id);
    if (!before) throw notFound('Series');
    const patch: Parameters<IDeviceCatalogueRepository['updateSeries']>[1] = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 80) throw invalid('Series name is required (80 characters or fewer).');
      const nameNormalised = normaliseDeviceToken(name);
      const other = await this.repo.findSeriesByNormalised(before.brandId, nameNormalised);
      if (other && other.id !== id) throw conflict('SERIES_EXISTS', `Series "${name}" already exists under this brand.`);
      patch.name = name;
      patch.nameNormalised = nameNormalised;
      patch.slug = seriesSlug(name);
    }
    if (input.searchAliases !== undefined) {
      const aliases = input.searchAliases.map((a) => a.trim()).filter(Boolean).slice(0, 20);
      patch.searchAliases = aliases;
      patch.searchAliasesNormalised = normaliseAliases(aliases);
    }
    if (input.displayOrder !== undefined) patch.displayOrder = Math.max(0, Math.trunc(input.displayOrder));
    const updated = await this.repo.updateSeries(id, { ...patch, actorId });
    await this.audit.execute({ actorId, action: 'DEVICE_SERIES_UPDATED', entity: 'device_series', entityId: id, previousState: { name: before.name, searchAliases: before.searchAliases, displayOrder: before.displayOrder }, newState: patch });
    return updated;
  }

  async setSeriesStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string) {
    const before = await this.repo.findSeries(id);
    if (!before) throw notFound('Series');
    const updated = await this.repo.setSeriesStatus(id, status, actorId);
    await this.audit.execute({ actorId, action: status === 'ARCHIVED' ? 'DEVICE_SERIES_ARCHIVED' : 'DEVICE_SERIES_RESTORED', entity: 'device_series', entityId: id, previousState: { status: before.status }, newState: { status } });
    return updated;
  }

  async reorderSeries(brandId: string, orderedIds: string[], actorId: string) {
    if (!orderedIds.length || orderedIds.length > 500) throw invalid('Provide the series ids in the order you want.');
    await this.repo.reorderSeries(brandId, orderedIds, actorId);
    await this.audit.execute({ actorId, action: 'DEVICE_SERIES_REORDERED', entity: 'device_brand', entityId: brandId, newState: { order: orderedIds } });
    return this.repo.listSeries(brandId, false);
  }

  // --------------------------------------------------------------- devices
  listDevices(filters: DeviceListFilters) {
    return this.repo.listDevices({ ...filters, limit: Math.min(Math.max(filters.limit ?? 200, 1), 1000) });
  }

  async findDevice(id: string) {
    const d = await this.repo.findDevice(id);
    if (!d) throw notFound('Device');
    return d;
  }

  /** Create an exact device model; identity = brand + model + model number + variant. */
  async createDevice(input: DeviceWrite, actorId: string): Promise<DeviceRecord> {
    const brand = await this.repo.findBrand(input.brandId);
    if (!brand) throw notFound('Brand');
    if (brand.status !== 'ACTIVE') throw unprocessable('BRAND_ARCHIVED', 'The brand is archived.');
    const model = input.model.trim();
    if (!model || model.length > 120) throw invalid('Marketing name is required (120 characters or fewer).');
    let seriesId: string | null = null;
    if (input.seriesId) {
      const series = await this.repo.findSeries(input.seriesId);
      if (!series || series.brandId !== brand.id) throw invalid('The series does not belong to this brand.');
      seriesId = series.id;
    }
    const modelNumber = input.modelNumber?.trim() || null;
    const variant = input.variant?.trim() || null;
    if (modelNumber && modelNumber.length > 80) throw invalid('Model number must be 80 characters or fewer.');
    if (variant && variant.length > 80) throw invalid('Variant must be 80 characters or fewer.');
    const identity = { brandNormalised: brand.nameNormalised, modelNormalised: normaliseDeviceToken(model), modelNumberNormalised: normaliseOptional(modelNumber), variantNormalised: normaliseOptional(variant) };
    const existing = await this.repo.findDeviceByIdentity(identity);
    if (existing) throw conflict('DEVICE_EXISTS', `${existing.brandName} ${existing.model}${existing.modelNumber ? ` (${existing.modelNumber})` : ''} already exists.`, { deviceId: existing.id });
    const aliases = (input.modelAliases ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 30);
    const releaseYear = input.releaseYear ?? null;
    if (releaseYear != null && (releaseYear < 1995 || releaseYear > 2100)) throw invalid('Release year looks wrong.');
    let slug = deviceIdentitySlug({ brand: brand.name, model, modelNumber, variant });
    const slugOwner = await this.repo.findDeviceBySlug(slug);
    if (slugOwner) slug = `${slug}-${slugOwner.id.slice(0, 4)}`;
    const created = await this.repo.createDevice({
      brandId: brand.id,
      brandName: brand.name,
      brandNormalised: brand.nameNormalised,
      seriesId,
      model,
      modelNormalised: identity.modelNormalised,
      modelNumber,
      modelNumberNormalised: identity.modelNumberNormalised,
      variant,
      variantNormalised: identity.variantNormalised,
      modelAliases: aliases,
      modelAliasesNormalised: normaliseAliases(aliases),
      slug,
      releaseYear,
      displayOrder: Math.max(0, Math.trunc(input.displayOrder ?? 0)),
      sourceReference: input.sourceReference ?? null,
      actorId,
    });
    await this.audit.execute({ actorId, action: 'DEVICE_CREATED', entity: 'device', entityId: created.id, newState: { brand: brand.name, model, modelNumber, variant, aliases } });
    return created;
  }

  /** Find-or-create by identity; used by the importer and the request queue. */
  async ensureDevice(input: DeviceWrite, actorId: string): Promise<{ device: DeviceRecord; created: boolean }> {
    const brand = await this.repo.findBrand(input.brandId);
    if (!brand) throw notFound('Brand');
    const identity = { brandNormalised: brand.nameNormalised, modelNormalised: normaliseDeviceToken(input.model), modelNumberNormalised: normaliseOptional(input.modelNumber ?? null), variantNormalised: normaliseOptional(input.variant ?? null) };
    const existing = await this.repo.findDeviceByIdentity(identity);
    if (existing) return { device: existing, created: false };
    return { device: await this.createDevice(input, actorId), created: true };
  }

  async ensureBrand(name: string, actorId: string): Promise<{ id: string; name: string; created: boolean }> {
    const normalised = normaliseDeviceToken(name);
    const existing = await this.repo.findBrandByNormalised(normalised);
    if (existing) return { id: existing.id, name: existing.name, created: false };
    const created = await this.createBrand({ name: name.trim() }, actorId);
    return { id: created.id, name: created.name, created: true };
  }

  async ensureSeries(brandId: string, name: string, actorId: string): Promise<{ id: string; created: boolean }> {
    const normalised = normaliseDeviceToken(name);
    const existing = await this.repo.findSeriesByNormalised(brandId, normalised);
    if (existing) return { id: existing.id, created: false };
    const created = await this.createSeries({ brandId, name: name.trim() }, actorId);
    return { id: created.id, created: true };
  }

  async updateDevice(id: string, input: Partial<DeviceWrite>, actorId: string) {
    const before = await this.repo.findDevice(id);
    if (!before) throw notFound('Device');
    if (before.status === 'MERGED') throw unprocessable('DEVICE_MERGED', 'This device was merged; edit the target device instead.');
    const brand = await this.repo.findBrand(input.brandId ?? before.brandId ?? '');
    if (!brand) throw notFound('Brand');
    const model = (input.model ?? before.model).trim();
    const modelNumber = input.modelNumber === undefined ? before.modelNumber : input.modelNumber?.trim() || null;
    const variant = input.variant === undefined ? before.variant : input.variant?.trim() || null;
    if (!model || model.length > 120) throw invalid('Marketing name is required (120 characters or fewer).');
    const identity = { brandNormalised: brand.nameNormalised, modelNormalised: normaliseDeviceToken(model), modelNumberNormalised: normaliseOptional(modelNumber), variantNormalised: normaliseOptional(variant) };
    const clash = await this.repo.findDeviceByIdentity(identity);
    if (clash && clash.id !== id) throw conflict('DEVICE_EXISTS', `${clash.brandName} ${clash.model}${clash.modelNumber ? ` (${clash.modelNumber})` : ''} already exists. Merge into it instead.`, { deviceId: clash.id });
    let seriesId = input.seriesId === undefined ? before.seriesId : input.seriesId;
    if (seriesId) {
      const series = await this.repo.findSeries(seriesId);
      if (!series || series.brandId !== brand.id) throw invalid('The series does not belong to this brand.');
    } else seriesId = null;
    const aliases = input.modelAliases === undefined ? before.modelAliases : input.modelAliases.map((a) => a.trim()).filter(Boolean).slice(0, 30);
    const patch = {
      brandId: brand.id,
      brandName: brand.name,
      brandNormalised: brand.nameNormalised,
      seriesId,
      model,
      modelNormalised: identity.modelNormalised,
      modelNumber,
      modelNumberNormalised: identity.modelNumberNormalised,
      variant,
      variantNormalised: identity.variantNormalised,
      modelAliases: aliases,
      modelAliasesNormalised: normaliseAliases(aliases),
      releaseYear: input.releaseYear === undefined ? before.releaseYear : input.releaseYear,
      displayOrder: input.displayOrder === undefined ? before.displayOrder : Math.max(0, Math.trunc(input.displayOrder)),
      actorId,
    };
    const updated = await this.repo.updateDevice(id, patch);
    await this.audit.execute({ actorId, action: 'DEVICE_UPDATED', entity: 'device', entityId: id, previousState: { brand: before.brandName, model: before.model, modelNumber: before.modelNumber, variant: before.variant, aliases: before.modelAliases, seriesId: before.seriesId }, newState: { brand: brand.name, model, modelNumber, variant, aliases, seriesId } });
    return updated;
  }

  async setDeviceStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string) {
    const before = await this.repo.findDevice(id);
    if (!before) throw notFound('Device');
    if (before.status === 'MERGED') throw unprocessable('DEVICE_MERGED', 'A merged device cannot be archived or restored.');
    const updated = await this.repo.setDeviceStatus(id, status, actorId);
    await this.audit.execute({ actorId, action: status === 'ARCHIVED' ? 'DEVICE_ARCHIVED' : 'DEVICE_RESTORED', entity: 'device', entityId: id, previousState: { status: before.status }, newState: { status } });
    return updated;
  }

  async mergePreview(sourceId: string, targetId: string) {
    const [source, target] = await Promise.all([this.repo.findDevice(sourceId), this.repo.findDevice(targetId)]);
    if (!source) throw notFound('Source device');
    if (!target) throw notFound('Target device');
    const [sourceProducts, targetProducts, openRequests] = await Promise.all([
      this.repo.deviceMappingProducts(sourceId),
      this.repo.deviceMappingProducts(targetId),
      this.repo.openRequestsForDevice(sourceId),
    ]);
    return {
      source,
      target,
      impact: mergeImpact({ source: { id: source.id, aliases: source.modelAliases, model: source.model, status: source.status }, target: { id: target.id, status: target.status }, sourceMappingDeviceProducts: sourceProducts, targetMappingDeviceProducts: targetProducts, openRequests }),
    };
  }

  async merge(sourceId: string, targetId: string, actorId: string, reason: string) {
    if (!reason.trim()) throw invalid('A reason is required to merge devices.');
    const preview = await this.mergePreview(sourceId, targetId);
    if (preview.impact.blocked) throw unprocessable('MERGE_BLOCKED', preview.impact.blocked);
    const result = await this.repo.merge(sourceId, targetId, actorId, preview.impact.aliasesToCarry);
    await this.audit.execute({ actorId, action: 'DEVICE_MERGED', entity: 'device', entityId: sourceId, previousState: { source: preview.source.slug, status: preview.source.status }, newState: { target: preview.target.slug, moved: result.moved, archivedDuplicates: result.archivedDuplicates, aliasesCarried: preview.impact.aliasesToCarry, reason } });
    return { ...result, target: await this.repo.findDevice(targetId) };
  }
}

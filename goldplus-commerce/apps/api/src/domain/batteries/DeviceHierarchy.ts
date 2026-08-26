import { normaliseDeviceToken } from '../products/Devices';
import type { BrandOrderMode } from '@goldplus/shared';

/**
 * Device brand → series → exact model. Pure domain: normalisation, slugs, the
 * public ordering rules and the merge impact preview. Display strings are
 * stored verbatim; normalised forms are separate columns.
 */

export function slugify(value: string): string {
  return normaliseDeviceToken(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
}

export function brandSlug(name: string): string {
  return slugify(name).slice(0, 80);
}

export function seriesSlug(name: string): string {
  return slugify(name).slice(0, 100);
}

/** Identity of an exact device: brand + marketing model + model number + variant. */
export interface DeviceIdentityInput {
  brand: string;
  model: string;
  modelNumber?: string | null;
  variant?: string | null;
}

export function deviceIdentitySlug(input: DeviceIdentityInput): string {
  const parts = [input.brand, input.model, input.modelNumber ?? '', input.variant ?? '']
    .map((p) => slugify(p))
    .filter(Boolean);
  return parts.join('-').slice(0, 160);
}

export function deviceLabel(input: { brandName: string; model: string; modelNumber?: string | null; variant?: string | null }): string {
  const bits = [`${input.brandName} ${input.model}`.trim()];
  const detail = [input.modelNumber, input.variant].filter((v) => v && v.trim()).join(', ');
  if (detail) bits.push(`(${detail})`);
  return bits.join(' ');
}

/** Normalised forms; empty strings become null so COALESCE-based identity works. */
export function normaliseOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  const n = normaliseDeviceToken(value);
  return n || null;
}

export interface BrandOrderingInput {
  id: string;
  name: string;
  isFeatured: boolean;
  displayOrder: number;
  verifiedFits: number;
  demandCount: number;
}

/**
 * Public brand order. FEATURED_THEN_COVERAGE: featured brands in their manual
 * order, then brands by verified coverage and customer demand, then the rest
 * alphabetically. Never baked into code as a fixed brand list.
 */
export function orderBrands<T extends BrandOrderingInput>(brands: T[], mode: BrandOrderMode): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'en');
  if (mode === 'ALPHABETICAL') return [...brands].sort(byName);
  if (mode === 'MANUAL') return [...brands].sort((a, b) => a.displayOrder - b.displayOrder || byName(a, b));
  return [...brands].sort((a, b) => {
    if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
    if (a.isFeatured && b.isFeatured && a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    const scoreA = a.verifiedFits * 10 + a.demandCount;
    const scoreB = b.verifiedFits * 10 + b.demandCount;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return byName(a, b);
  });
}

export interface SeriesOrderingInput {
  id: string;
  name: string;
  displayOrder: number;
  demandCount: number;
  verifiedFits: number;
}

/** Within a brand: manually ordered series first, then by demand, then alphabetically. */
export function orderSeries<T extends SeriesOrderingInput>(series: T[]): T[] {
  return [...series].sort((a, b) => {
    const manualA = a.displayOrder > 0 ? a.displayOrder : Number.MAX_SAFE_INTEGER;
    const manualB = b.displayOrder > 0 ? b.displayOrder : Number.MAX_SAFE_INTEGER;
    if (manualA !== manualB) return manualA - manualB;
    const scoreA = a.demandCount * 2 + a.verifiedFits;
    const scoreB = b.demandCount * 2 + b.verifiedFits;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.name.localeCompare(b.name, 'en');
  });
}

export interface ModelOrderingInput {
  id: string;
  model: string;
  modelNumber: string | null;
  displayOrder: number;
  releaseYear: number | null;
  demandCount: number;
}

/** Within a series: featured (manual order) first, then newer, then demand, then alphabetical. */
export function orderModels<T extends ModelOrderingInput>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const manualA = a.displayOrder > 0 ? a.displayOrder : Number.MAX_SAFE_INTEGER;
    const manualB = b.displayOrder > 0 ? b.displayOrder : Number.MAX_SAFE_INTEGER;
    if (manualA !== manualB) return manualA - manualB;
    const yearA = a.releaseYear ?? -1;
    const yearB = b.releaseYear ?? -1;
    if (yearA !== yearB) return yearB - yearA;
    if (a.demandCount !== b.demandCount) return b.demandCount - a.demandCount;
    const byModel = a.model.localeCompare(b.model, 'en', { numeric: true });
    if (byModel !== 0) return byModel;
    return (a.modelNumber ?? '').localeCompare(b.modelNumber ?? '', 'en', { numeric: true });
  });
}

export interface MergeImpact {
  sourceDeviceId: string;
  targetDeviceId: string;
  mappingsToMove: number;
  mappingsAlreadyOnTarget: number;
  aliasesToCarry: string[];
  requestsToRepoint: number;
  blocked: string | null;
}

/**
 * What merging `source` into `target` would do, so the operator confirms with
 * the facts in front of them. A mapping that exists on both devices is kept on
 * the target and the source copy is archived (history preserved, never lost).
 */
export function mergeImpact(input: {
  source: { id: string; aliases: string[]; model: string; status: string };
  target: { id: string; status: string };
  sourceMappingDeviceProducts: string[];
  targetMappingDeviceProducts: string[];
  openRequests: number;
}): MergeImpact {
  const targetSet = new Set(input.targetMappingDeviceProducts);
  const already = input.sourceMappingDeviceProducts.filter((p) => targetSet.has(p)).length;
  let blocked: string | null = null;
  if (input.source.id === input.target.id) blocked = 'A device cannot be merged into itself.';
  else if (input.target.status !== 'ACTIVE') blocked = 'The target device must be active.';
  else if (input.source.status === 'MERGED') blocked = 'This device has already been merged.';
  return {
    sourceDeviceId: input.source.id,
    targetDeviceId: input.target.id,
    mappingsToMove: input.sourceMappingDeviceProducts.length - already,
    mappingsAlreadyOnTarget: already,
    aliasesToCarry: Array.from(new Set([input.source.model, ...input.source.aliases])).filter(Boolean),
    requestsToRepoint: input.openRequests,
    blocked,
  };
}

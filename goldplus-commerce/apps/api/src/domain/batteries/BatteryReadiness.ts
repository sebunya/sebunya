import { VERIFIED_EVIDENCE_STATUSES, type BatteryLifecycleStatus } from '@goldplus/shared';

/**
 * Publication readiness for one battery. Pure domain. Every blocker says
 * exactly why publication is refused; warnings do not block.
 */

export type ReadinessCode =
  | 'NO_CANONICAL_CODE'
  | 'UNRESOLVED_COMPOUND_CODE'
  | 'ALIAS_CONFLICT'
  | 'NO_PRIMARY_IMAGE'
  | 'NO_PRICE'
  | 'PRICE_BELOW_FLOOR'
  | 'NO_STOCK_LINKAGE'
  | 'NO_VERIFIED_COMPATIBILITY'
  | 'INVALID_DEVICE_MAPPING'
  | 'BATTERY_UNVERIFIED'
  | 'MISSING_REQUIRED_SPECS'
  | 'PRODUCT_NOT_APPROVED';

export type ReadinessWarningCode = 'NO_BARCODE' | 'NO_WARRANTY' | 'NO_PUBLIC_NOTES' | 'AWAITING_CLAIMS_ONLY' | 'OUT_OF_STOCK';

export interface ReadinessInput {
  canonicalCode: string;
  codeStatus: string; // CONFIRMED | PROVISIONAL | DEVICE_NAMED | MISSING
  verificationStatus: string; // UNVERIFIED | VERIFIED
  lifecycleStatus: BatteryLifecycleStatus | string;
  hasPrimaryImage: boolean;
  priceUgx: number;
  /** The battery's own floor (Price A), or null when none is set (then it is simply not discountable). */
  floorPriceUgx: number | null;
  productApproved: boolean;
  stockQuantity: number;
  movementCount: number;
  capacityMah: number | null;
  nominalVoltageMv: number | null;
  barcode: string | null;
  warrantyMonths: number | null;
  publicNotes: string | null;
  aliasConflicts: string[]; // normalised aliases that also resolve to another active battery
  mappings: Array<{ workflowStatus: string; evidenceStatus: string; deviceStatus: string }>;
}

export interface ReadinessItem {
  code: ReadinessCode | ReadinessWarningCode;
  message: string;
}

export interface ReadinessReport {
  ready: boolean;
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
}

const CODE_STATUS_MESSAGE: Record<string, string> = {
  PROVISIONAL: 'The battery code has not been confirmed from the physical pack.',
  DEVICE_NAMED: 'The stock identifier is a phone name. Record the printed battery code from the pack.',
  MISSING: 'No battery code has been recorded.',
};

export function assessReadiness(input: ReadinessInput): ReadinessReport {
  const blockers: ReadinessItem[] = [];
  const warnings: ReadinessItem[] = [];

  if (!input.canonicalCode.trim() || input.codeStatus !== 'CONFIRMED') {
    blockers.push({ code: 'NO_CANONICAL_CODE', message: CODE_STATUS_MESSAGE[input.codeStatus] ?? 'Missing canonical battery code.' });
  }
  if (/[\/]/.test(input.canonicalCode) || /\bAND\b/i.test(input.canonicalCode)) {
    blockers.push({ code: 'UNRESOLVED_COMPOUND_CODE', message: `"${input.canonicalCode}" combines more than one battery reference. Split it or confirm it is one packaged cross-reference.` });
  }
  if (input.aliasConflicts.length) {
    blockers.push({ code: 'ALIAS_CONFLICT', message: `Alias conflict: ${input.aliasConflicts.join(', ')} also resolve(s) to another active battery.` });
  }
  if (!input.hasPrimaryImage) blockers.push({ code: 'NO_PRIMARY_IMAGE', message: 'No primary image. Upload at least the front of the pack.' });
  if (!(input.priceUgx > 0)) blockers.push({ code: 'NO_PRICE', message: 'No retail price has been set.' });
  else if (input.floorPriceUgx !== null && input.priceUgx < input.floorPriceUgx) {
    blockers.push({ code: 'PRICE_BELOW_FLOOR', message: `Price UGX ${input.priceUgx.toLocaleString('en-UG')} is below this battery's own floor (Price A) of UGX ${input.floorPriceUgx.toLocaleString('en-UG')}. Raise the price or lower the floor.` });
  }
  if (input.movementCount === 0) blockers.push({ code: 'NO_STOCK_LINKAGE', message: 'No stock has ever been recorded for this battery. Record opening stock or a receipt, even if the count is zero.' });
  if (input.verificationStatus !== 'VERIFIED') blockers.push({ code: 'BATTERY_UNVERIFIED', message: 'The battery has not been verified against its physical pack.' });
  if (input.capacityMah == null || input.nominalVoltageMv == null) {
    blockers.push({ code: 'MISSING_REQUIRED_SPECS', message: 'Capacity (mAh) and nominal voltage are required before publication. Read them from the pack; never guess.' });
  }
  if (!input.productApproved) blockers.push({ code: 'PRODUCT_NOT_APPROVED', message: 'The product record is not approved in the catalogue.' });

  const liveOrReady = input.mappings.filter((m) => m.workflowStatus === 'READY' || m.workflowStatus === 'ACTIVE');
  const verified = liveOrReady.filter((m) => (VERIFIED_EVIDENCE_STATUSES as readonly string[]).includes(m.evidenceStatus) || m.evidenceStatus === 'CONDITIONAL');
  if (verified.length === 0) {
    blockers.push({ code: 'NO_VERIFIED_COMPATIBILITY', message: 'No verified compatible device. At least one phone must be verified (package, fit test or exact) before publication.' });
  } else if (verified.every((m) => m.evidenceStatus === 'CONDITIONAL')) {
    warnings.push({ code: 'AWAITING_CLAIMS_ONLY', message: 'Every verified fit is conditional.' });
  }
  if (liveOrReady.some((m) => m.deviceStatus !== 'ACTIVE')) {
    blockers.push({ code: 'INVALID_DEVICE_MAPPING', message: 'A ready or live compatibility row points at an archived or merged device.' });
  }

  if (!input.barcode) warnings.push({ code: 'NO_BARCODE', message: 'No barcode recorded; receiving and counting will rely on the code.' });
  if (input.warrantyMonths == null) warnings.push({ code: 'NO_WARRANTY', message: 'No warranty period recorded.' });
  if (!input.publicNotes) warnings.push({ code: 'NO_PUBLIC_NOTES', message: 'No customer-facing notes.' });
  if (input.stockQuantity <= 0) warnings.push({ code: 'OUT_OF_STOCK', message: 'Stock is zero; the battery will show as verified but out of stock.' });

  return { ready: blockers.length === 0, blockers, warnings };
}

/** Allowed battery lifecycle transitions. */
export type BatteryAction = 'SUBMIT_REVIEW' | 'MARK_READY' | 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE' | 'RESTORE' | 'REOPEN';

export function transitionBattery(
  current: string,
  action: BatteryAction,
  readiness: ReadinessReport,
): { ok: true; next: BatteryLifecycleStatus } | { ok: false; code: 'INVALID_TRANSITION' | 'NOT_READY'; message: string } {
  const fail = (code: 'INVALID_TRANSITION' | 'NOT_READY', message: string) => ({ ok: false as const, code, message });
  switch (action) {
    case 'SUBMIT_REVIEW':
      if (current !== 'DRAFT') return fail('INVALID_TRANSITION', `Only a draft can be submitted for review (this one is ${current}).`);
      return { ok: true, next: 'REVIEW' };
    case 'MARK_READY':
      if (current !== 'REVIEW' && current !== 'DRAFT') return fail('INVALID_TRANSITION', `Only a draft or a battery in review can be marked ready (this one is ${current}).`);
      if (!readiness.ready) return fail('NOT_READY', `Not ready: ${readiness.blockers.map((b) => b.message).join(' ')}`);
      return { ok: true, next: 'READY' };
    case 'PUBLISH':
      if (current !== 'READY') return fail('INVALID_TRANSITION', `Only a ready battery can be published (this one is ${current}).`);
      if (!readiness.ready) return fail('NOT_READY', `Not ready: ${readiness.blockers.map((b) => b.message).join(' ')}`);
      return { ok: true, next: 'ACTIVE' };
    case 'UNPUBLISH':
      if (current !== 'ACTIVE') return fail('INVALID_TRANSITION', 'Only a live battery can be unpublished.');
      return { ok: true, next: 'READY' };
    case 'ARCHIVE':
      if (current === 'ARCHIVED') return fail('INVALID_TRANSITION', 'Already archived.');
      return { ok: true, next: 'ARCHIVED' };
    case 'RESTORE':
      if (current !== 'ARCHIVED') return fail('INVALID_TRANSITION', 'Only an archived battery can be restored.');
      return { ok: true, next: 'DRAFT' };
    case 'REOPEN':
      if (current === 'DRAFT' || current === 'ARCHIVED') return fail('INVALID_TRANSITION', 'Nothing to reopen.');
      return { ok: true, next: 'DRAFT' };
    default:
      return fail('INVALID_TRANSITION', 'Unknown action.');
  }
}

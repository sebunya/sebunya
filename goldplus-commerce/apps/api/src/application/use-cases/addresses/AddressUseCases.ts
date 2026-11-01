import {
  CreateAddressInput,
  IAddressRepository,
  UpdateAddressPatch,
  AddressStructuredFields,
} from '../../ports/IAddressRepository';
import { IAddressAuditRepository } from '../../ports/IAddressAudit';
import { AddressDto, normalizeUgandaDistrict, normalizeUgandanPhone } from '@goldplus/shared';

export class ListMyAddressesUseCase {
  constructor(private readonly addresses: IAddressRepository) {}
  execute(userId: string): Promise<AddressDto[]> {
    return this.addresses.listForUser(userId);
  }
}

export interface AddAddressInput extends AddressStructuredFields {
  userId: string;
  label: string;
  recipientName: string;
  phone: string;
  district: string;
  areaDetails: string;
  makeDefault: boolean;
}

export type AddAddressResult =
  | { ok: true; address: AddressDto; phoneWarning: string | null }
  | { ok: false; code: 'BAD_INPUT'; message: string };

function validateCore(input: {
  label?: string;
  recipientName?: string;
  phone?: string;
  district?: string;
  areaDetails?: string;
  landmarkText?: string | null;
  areaSlug?: string | null;
  rawAddressText?: string | null;
}): { ok: true; district?: string; phoneE164?: string; phoneWarning: string | null } | { ok: false; message: string } {
  for (const [key, value] of Object.entries({
    label: input.label,
    recipientName: input.recipientName,
    phone: input.phone,
    district: input.district,
    areaDetails: input.areaDetails,
  })) {
    if (value === undefined) continue; // patch semantics — absent means unchanged
    const v = (value ?? '').toString().trim();
    if (!v) return { ok: false, message: `Field "${key}" is required.` };
    if (v.length > 200) return { ok: false, message: `Field "${key}" is too long.` };
  }
  let district: string | undefined;
  if (input.district !== undefined) {
    // A saved address feeds checkout's deliveryLocation verbatim, so a junk
    // district here becomes a mis-zoned order later. Canonicalise or refuse.
    const canonical = normalizeUgandaDistrict(input.district);
    if (!canonical) {
      return { ok: false, message: `"${input.district.trim()}" is not a Uganda district. Pick the district from the list.` };
    }
    district = canonical;
  }
  let phoneE164: string | undefined;
  let phoneWarning: string | null = null;
  if (input.phone !== undefined) {
    // PART G field 3: strict shape, E.164 normalisation, warn-never-block on
    // an unrecognised operator prefix.
    const phone = normalizeUgandanPhone(input.phone);
    if (!phone) return { ok: false, message: 'Enter a valid Ugandan phone number (07XXXXXXXX or +2567XXXXXXXX).' };
    phoneE164 = phone.e164;
    phoneWarning = phone.warning;
  }
  // A structured (area-linked) address must carry the landmark line — Ugandan
  // last-mile runs on landmarks (PART G field 6). The manual PART H path
  // (rawAddressText) and legacy free-text rows are exempt.
  if (input.areaSlug && input.landmarkText !== undefined && !(input.landmarkText ?? '').trim()) {
    return { ok: false, message: 'Add a landmark the rider will know — a shop, stage, church or school nearby.' };
  }
  return { ok: true, district, phoneE164, phoneWarning };
}

export class AddAddressUseCase {
  constructor(
    private readonly addresses: IAddressRepository,
    private readonly audit: IAddressAuditRepository,
  ) {}

  async execute(input: AddAddressInput): Promise<AddAddressResult> {
    // Create semantics: a missing landmark is an EMPTY landmark, not "unchanged".
    const core = validateCore({ ...input, landmarkText: input.landmarkText ?? '' });
    if (!core.ok) return { ok: false, code: 'BAD_INPUT', message: core.message };
    const address = await this.addresses.createForUser({
      ...input,
      label: input.label.trim(),
      recipientName: input.recipientName.trim(),
      phone: core.phoneE164 ?? input.phone.trim(),
      district: core.district ?? input.district,
      areaDetails: input.areaDetails.trim(),
      // The manual fallback (PART H) arrives with rawAddressText and no area —
      // it enters the ops review queue rather than pretending to be resolved.
      resolutionStatus:
        input.resolutionStatus ?? (input.rawAddressText && !input.areaSlug ? 'needs_ops_review' : 'resolved'),
    } satisfies CreateAddressInput);
    await this.audit.append({
      addressId: address.id,
      actorType: 'customer',
      actorId: input.userId,
      action: 'created',
      after: address,
    });
    return { ok: true, address, phoneWarning: core.phoneWarning };
  }
}

export type UpdateAddressResult =
  | { ok: true; address: AddressDto; phoneWarning: string | null }
  | { ok: false; code: 'BAD_INPUT' | 'NOT_FOUND'; message: string };

export class UpdateAddressUseCase {
  constructor(
    private readonly addresses: IAddressRepository,
    private readonly audit: IAddressAuditRepository,
  ) {}

  async execute(userId: string, addressId: string, patch: UpdateAddressPatch): Promise<UpdateAddressResult> {
    if (!addressId.trim()) return { ok: false, code: 'NOT_FOUND', message: 'Address not found.' };
    const core = validateCore(patch);
    if (!core.ok) return { ok: false, code: 'BAD_INPUT', message: core.message };
    const result = await this.addresses.updateForUser(userId, addressId.trim(), {
      ...patch,
      ...(core.district ? { district: core.district } : {}),
      ...(core.phoneE164 ? { phone: core.phoneE164 } : {}),
    });
    if (!result) return { ok: false, code: 'NOT_FOUND', message: 'Address not found.' };
    // Post-placement address edits are exactly what generates disputes —
    // before and after are recorded verbatim (brief E.2 address_audit).
    await this.audit.append({
      addressId,
      actorType: 'customer',
      actorId: userId,
      action: 'edited',
      before: result.before,
      after: result.after,
    });
    return { ok: true, address: result.after, phoneWarning: core.phoneWarning };
  }
}

export class SetDefaultAddressUseCase {
  constructor(
    private readonly addresses: IAddressRepository,
    private readonly audit: IAddressAuditRepository,
  ) {}
  async execute(userId: string, addressId: string): Promise<AddressDto | null> {
    if (!addressId.trim()) return null;
    const result = await this.addresses.setDefaultForUser(userId, addressId.trim());
    if (result) {
      await this.audit.append({
        addressId: result.id,
        actorType: 'customer',
        actorId: userId,
        action: 'default_changed',
        after: { isDefault: true },
      });
    }
    return result;
  }
}

export class DeleteAddressUseCase {
  constructor(
    private readonly addresses: IAddressRepository,
    private readonly audit: IAddressAuditRepository,
  ) {}
  async execute(userId: string, addressId: string): Promise<boolean> {
    if (!addressId.trim()) return false;
    const removed = await this.addresses.deleteForUser(userId, addressId.trim());
    if (removed) {
      await this.audit.append({
        addressId: removed.id,
        actorType: 'customer',
        actorId: userId,
        action: 'soft_deleted',
        before: removed,
      });
    }
    return Boolean(removed);
  }
}

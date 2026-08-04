import { AddressDto } from '@goldplus/shared';

/**
 * Structured fields the location module adds to an address (brief E.2).
 * All optional: the pre-module flow (district + free-text areaDetails) keeps
 * working until the new form replaces every call site.
 */
export interface AddressStructuredFields {
  areaSlug?: string | null;
  areaGroupId?: string | null;
  landmarkText?: string | null;
  additionalDirections?: string | null;
  phoneSecondary?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  gpsAccuracyM?: number | null;
  gpsSource?: 'device' | 'pasted_link' | 'ops_entered' | null;
  rawAddressText?: string | null;
  resolutionStatus?: 'resolved' | 'needs_ops_review' | 'ops_confirmed' | 'undeliverable';
  deliveryMethod?: 'door' | 'pickup_point';
  pickupPointId?: string | null;
  snapshotAreaLabel?: string | null;
  snapshotDistrict?: string | null;
  snapshotPostcode?: string | null;
  snapshotDataVersion?: number | null;
}

export interface CreateAddressInput extends AddressStructuredFields {
  userId: string;
  label: string;
  recipientName: string;
  phone: string;
  district: string;
  areaDetails: string;
  makeDefault: boolean;
}

export interface UpdateAddressPatch extends AddressStructuredFields {
  label?: string;
  recipientName?: string;
  phone?: string;
  district?: string;
  areaDetails?: string;
}

export interface IAddressRepository {
  /** Live (non-deleted) addresses only. */
  listForUser(userId: string): Promise<AddressDto[]>;
  findForUser(userId: string, addressId: string): Promise<AddressDto | null>;
  createForUser(input: CreateAddressInput): Promise<AddressDto>;
  /**
   * User-scoped edit. Returns before+after for the audit trail, or null when
   * the id does not belong to the caller (never a cross-user write).
   */
  updateForUser(
    userId: string,
    addressId: string,
    patch: UpdateAddressPatch,
  ): Promise<{ before: AddressDto; after: AddressDto } | null>;
  /** Both are user-scoped: an id belonging to another user is a not-found, never a cross-user write. */
  setDefaultForUser(userId: string, addressId: string): Promise<AddressDto | null>;
  /** SOFT delete (deleted_at) — orders reference addresses historically. */
  deleteForUser(userId: string, addressId: string): Promise<AddressDto | null>;
}

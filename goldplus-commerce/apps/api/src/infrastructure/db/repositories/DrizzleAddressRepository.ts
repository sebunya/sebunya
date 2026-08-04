import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../client';
import { addresses } from '../schema/addresses';
import {
  CreateAddressInput,
  IAddressRepository,
  UpdateAddressPatch,
} from '../../../application/ports/IAddressRepository';
import { AddressDto } from '@goldplus/shared';

function rowToDto(row: typeof addresses.$inferSelect): AddressDto {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    district: row.district,
    areaDetails: row.areaDetails,
    isDefault: row.isDefault,
    areaSlug: row.areaSlug,
    landmarkText: row.landmarkText,
    additionalDirections: row.additionalDirections,
    phoneSecondary: row.phoneSecondary,
    deliveryMethod: (row.deliveryMethod as AddressDto['deliveryMethod']) ?? 'door',
    pickupPointId: row.pickupPointId,
    resolutionStatus: (row.resolutionStatus as AddressDto['resolutionStatus']) ?? 'resolved',
    hasPin: row.gpsLat !== null && row.gpsLng !== null,
    snapshotAreaLabel: row.snapshotAreaLabel,
  };
}

const STRUCTURED_KEYS = [
  'areaSlug',
  'areaGroupId',
  'landmarkText',
  'additionalDirections',
  'phoneSecondary',
  'gpsLat',
  'gpsLng',
  'gpsAccuracyM',
  'gpsSource',
  'rawAddressText',
  'resolutionStatus',
  'deliveryMethod',
  'pickupPointId',
  'snapshotAreaLabel',
  'snapshotDistrict',
  'snapshotPostcode',
  'snapshotDataVersion',
] as const;

function structuredValues(input: Partial<CreateAddressInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of STRUCTURED_KEYS) {
    if (input[k as keyof typeof input] !== undefined) out[k] = input[k as keyof typeof input];
  }
  if (input.gpsLat !== undefined && input.gpsLat !== null) out.gpsCapturedAt = new Date();
  return out;
}

const live = (userId: string) => and(eq(addresses.userId, userId), isNull(addresses.deletedAt));

export class DrizzleAddressRepository implements IAddressRepository {
  async listForUser(userId: string): Promise<AddressDto[]> {
    const rows = await db.query.addresses.findMany({ where: live(userId) });
    return rows.map(rowToDto);
  }

  async findForUser(userId: string, addressId: string): Promise<AddressDto | null> {
    const row = await db.query.addresses.findFirst({
      where: and(eq(addresses.id, addressId), live(userId)),
    });
    return row ? rowToDto(row) : null;
  }

  async createForUser(input: CreateAddressInput): Promise<AddressDto> {
    return db.transaction(async (tx) => {
      const existing = await tx.query.addresses.findMany({ where: live(input.userId) });
      const shouldBeDefault = input.makeDefault || existing.length === 0;

      if (shouldBeDefault && existing.some((a) => a.isDefault)) {
        await tx.update(addresses).set({ isDefault: false }).where(live(input.userId));
      }

      const [row] = await tx
        .insert(addresses)
        .values({
          userId: input.userId,
          label: input.label,
          recipientName: input.recipientName,
          phone: input.phone,
          district: input.district,
          areaDetails: input.areaDetails,
          isDefault: shouldBeDefault,
          ...structuredValues(input),
        })
        .returning();
      return rowToDto(row);
    });
  }

  async updateForUser(
    userId: string,
    addressId: string,
    patch: UpdateAddressPatch,
  ): Promise<{ before: AddressDto; after: AddressDto } | null> {
    return db.transaction(async (tx) => {
      const target = await tx.query.addresses.findFirst({
        where: and(eq(addresses.id, addressId), live(userId)),
      });
      if (!target) return null;
      const set: Record<string, unknown> = { updatedAt: new Date(), ...structuredValues(patch) };
      for (const k of ['label', 'recipientName', 'phone', 'district', 'areaDetails'] as const) {
        if (patch[k] !== undefined) set[k] = patch[k];
      }
      const [row] = await tx
        .update(addresses)
        .set(set)
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
        .returning();
      return { before: rowToDto(target), after: rowToDto(row) };
    });
  }

  async setDefaultForUser(userId: string, addressId: string): Promise<AddressDto | null> {
    return db.transaction(async (tx) => {
      const target = await tx.query.addresses.findFirst({
        where: and(eq(addresses.id, addressId), live(userId)),
      });
      if (!target) return null;
      await tx.update(addresses).set({ isDefault: false }).where(live(userId));
      const [row] = await tx
        .update(addresses)
        .set({ isDefault: true })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
        .returning();
      return row ? rowToDto(row) : null;
    });
  }

  async deleteForUser(userId: string, addressId: string): Promise<AddressDto | null> {
    return db.transaction(async (tx) => {
      const target = await tx.query.addresses.findFirst({
        where: and(eq(addresses.id, addressId), live(userId)),
      });
      if (!target) return null;
      // SOFT delete — orders reference addresses historically (brief E.2).
      const [removed] = await tx
        .update(addresses)
        .set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
        .returning();
      if (!removed) return null;
      // Deleting the default must not leave the book default-less while other
      // addresses remain — checkout preselects the default.
      if (target.isDefault) {
        const remaining = await tx.query.addresses.findMany({ where: live(userId) });
        if (remaining.length > 0) {
          await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, remaining[0].id));
        }
      }
      return rowToDto(removed);
    });
  }
}

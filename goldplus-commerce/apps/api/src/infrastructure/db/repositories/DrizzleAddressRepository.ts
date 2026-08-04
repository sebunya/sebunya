import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { addresses } from '../schema/addresses';
import { IAddressRepository } from '../../../application/ports/IAddressRepository';
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
  };
}

export class DrizzleAddressRepository implements IAddressRepository {
  async listForUser(userId: string): Promise<AddressDto[]> {
    const rows = await db.query.addresses.findMany({ where: eq(addresses.userId, userId) });
    return rows.map(rowToDto);
  }

  async createForUser(input: {
    userId: string;
    label: string;
    recipientName: string;
    phone: string;
    district: string;
    areaDetails: string;
    makeDefault: boolean;
  }): Promise<AddressDto> {
    return db.transaction(async (tx) => {
      const existing = await tx.query.addresses.findMany({ where: eq(addresses.userId, input.userId) });
      const shouldBeDefault = input.makeDefault || existing.length === 0;

      if (shouldBeDefault && existing.some((a) => a.isDefault)) {
        await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, input.userId));
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
        })
        .returning();
      return rowToDto(row);
    });
  }

  async setDefaultForUser(userId: string, addressId: string): Promise<AddressDto | null> {
    return db.transaction(async (tx) => {
      const target = await tx.query.addresses.findFirst({
        where: and(eq(addresses.id, addressId), eq(addresses.userId, userId)),
      });
      if (!target) return null;
      await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
      const [row] = await tx
        .update(addresses)
        .set({ isDefault: true })
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
        .returning();
      return row ? rowToDto(row) : null;
    });
  }

  async deleteForUser(userId: string, addressId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(addresses)
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
        .returning();
      if (!removed) return false;
      // Deleting the default must not leave the book default-less while other
      // addresses remain — checkout preselects the default.
      if (removed.isDefault) {
        const remaining = await tx.query.addresses.findMany({ where: eq(addresses.userId, userId) });
        if (remaining.length > 0) {
          await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, remaining[0].id));
        }
      }
      return true;
    });
  }
}

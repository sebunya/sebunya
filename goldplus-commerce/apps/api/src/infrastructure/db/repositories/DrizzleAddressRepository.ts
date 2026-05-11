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
}

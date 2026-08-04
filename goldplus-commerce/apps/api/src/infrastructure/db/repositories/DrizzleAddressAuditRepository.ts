import { db } from '../client';
import { addressAudit } from '../schema/locations';
import { AddressAuditEntry, IAddressAuditRepository } from '../../../application/ports/IAddressAudit';

export class DrizzleAddressAuditRepository implements IAddressAuditRepository {
  async append(entry: AddressAuditEntry): Promise<void> {
    await db.insert(addressAudit).values({
      addressId: entry.addressId ?? null,
      orderId: entry.orderId ?? null,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? null,
    });
  }
}

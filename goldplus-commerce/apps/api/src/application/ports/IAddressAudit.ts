/**
 * Append-only address audit (location-module brief E.2 `address_audit`).
 * Customers phone in address changes after ordering and disputes follow —
 * every create, edit, ops resolution, status change, admin view and soft
 * delete is recorded with actor, before and after.
 */
export interface AddressAuditEntry {
  addressId?: string | null;
  orderId?: string | null;
  actorType: 'customer' | 'ops' | 'system';
  actorId?: string | null;
  action:
    | 'created'
    | 'edited'
    | 'ops_resolved'
    | 'status_changed'
    | 'viewed_by_admin'
    | 'soft_deleted'
    | 'default_changed'
    | 'migration_linked';
  before?: unknown;
  after?: unknown;
  note?: string | null;
}

export interface IAddressAuditRepository {
  append(entry: AddressAuditEntry): Promise<void>;
}

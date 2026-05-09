export type AuditAction = 'product_approval' | 'dealer_approval' | 'inventory_update' | 'security_alert';

export class AuditLog {
  constructor(
    public readonly id: string,
    public readonly actorId: string | 'system',
    public readonly action: AuditAction,
    public readonly entityId: string,
    public readonly previousState: any,
    public readonly newState: any,
    public readonly timestamp: Date,
    public readonly ipAddress?: string
  ) {}

  public static log(
    id: string,
    actorId: string | 'system',
    action: AuditAction,
    entityId: string,
    previousState: any,
    newState: any
  ): AuditLog {
    return new AuditLog(
      id,
      actorId,
      action,
      entityId,
      previousState,
      newState,
      new Date()
    );
  }
}

export class AuditLogEntity {
  constructor(
    public readonly id: string,
    public readonly actorId: string | null,
    public readonly action: string,
    public readonly entity: string,
    public readonly entityId: string,
    public readonly previousState: any,
    public readonly newState: any,
    public readonly createdAt: Date
  ) {}

  public static record(
    id: string,
    actorId: string | null,
    action: string,
    entity: string,
    entityId: string,
    previousState: any,
    newState: any
  ): AuditLogEntity {
    return new AuditLogEntity(
      id,
      actorId,
      action,
      entity,
      entityId,
      previousState,
      newState,
      new Date()
    );
  }
}

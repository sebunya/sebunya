export class AuditLogEntity {
  constructor(
    public readonly id: string,
    public readonly action: string,
    public readonly entityId: string
  ) {}
}

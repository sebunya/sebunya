export interface ConsentReadRepository {
  listAuditTrail(limit: number): Promise<any[]>;
}

export class MeasurementControlTowerMapper {
  // Add mapping functions if needed
  public static mapStatus(dbStatus: string | null): string {
    return dbStatus || 'NOT_CONFIGURED';
  }
}

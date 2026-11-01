/** Where a dollar-rate reading from the Bank of Uganda is kept (measurement.control_series, key usd_ugx_bou). */
export interface FxReadingPort {
  recordBou(reading: { day: string; mid: number; buying: number | null; selling: number | null; note: string }): Promise<void>;
}

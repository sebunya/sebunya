export interface MeasurementConfigPort {
  values(): Promise<Record<string, string>>;
  set(input: { key: string; value: string; actorId: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  unset(input: { key: string; actorId: string }): Promise<{ ok: true; wasSet: boolean } | { ok: false; message: string }>;
}

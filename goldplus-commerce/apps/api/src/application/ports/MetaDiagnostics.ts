/** A Graph API answer: the parsed body on success, Meta's own account of the refusal otherwise. */
export type MetaAnswer<T> = { ok: true; value: T; servedVersion?: string | null } | { ok: false; message: string; credentials: boolean; transient: boolean };

/**
 * Read-only questions to Meta about one dataset, plus one test send. The
 * token is given per call and never stored, logged or returned.
 */
export interface MetaDiagnosticsGateway {
  /** The dataset as Meta names it: proves the ID is real and the token can read it. */
  dataset(datasetId: string, token: string): Promise<MetaAnswer<{ id: string; name: string | null }>>;
  /** The Dataset Quality API's raw answer (see domain/advertising/MetaDiagnostics.parseDatasetQuality). */
  quality(datasetId: string, token: string): Promise<MetaAnswer<unknown>>;
  /** One event carrying a test event code: it appears under Test events in Events Manager and is not counted. */
  sendTestEvent(datasetId: string, token: string, event: Record<string, unknown>, testEventCode: string): Promise<MetaAnswer<{ eventsReceived: number; fbtraceId: string | null }>>;
}

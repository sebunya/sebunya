/** TikTok's answer to one call: its request id on success, its own account of the refusal otherwise. */
export type TikTokAnswer = { ok: true; requestId: string | null; sentValue: { value: number; currency: string } | null }
  | { ok: false; message: string; credentials: boolean; transient: boolean };

export interface TikTokTestEvent {
  /** The saved destination settings (pixel code, rate). */
  config: Record<string, string>;
  token: string;
  testEventCode: string;
  kind: 'view' | 'purchase';
  /** The storefront address: TikTok requires the page a web event came from. */
  origin: string;
  eventId: string;
  /** Unix seconds. */
  eventTime: number;
}

/**
 * One event carrying the owner's test event code, built by the same code that
 * builds real ones. TikTok lists it under Test events and does not count it.
 * The token is given per call and never stored, logged or returned.
 */
export interface TikTokDiagnosticsGateway {
  sendTestEvent(input: TikTokTestEvent): Promise<TikTokAnswer>;
}

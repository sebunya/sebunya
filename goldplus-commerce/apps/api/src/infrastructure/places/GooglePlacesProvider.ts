/**
 * Google Places API (New), server-side only: the key never reaches a browser.
 * Contract read 2026-10-16 from developers.google.com/maps/documentation/places/web-service/place-autocomplete
 * and .../data-fields:
 *  - POST https://places.googleapis.com/v1/places:autocomplete, headers X-Goog-Api-Key + X-Goog-FieldMask,
 *    body { input, sessionToken, includedRegionCodes, locationBias.circle{center,radius≤50000}, languageCode }.
 *  - GET https://places.googleapis.com/v1/places/{id}?sessionToken=… with FieldMask "location" only: a Place Details
 *    ESSENTIALS field. displayName is PRO (3× the price, half the free cap), so it is never asked for: the name
 *    already arrived with the suggestion. Nothing else is asked for because nothing else is kept.
 */
import { PlaceProviderError, type IPlaceSearchProvider, type PlacePoint, type PlaceSuggestion } from '../../application/ports/IPlaceSearch';

const KAMPALA = { latitude: 0.3476, longitude: 32.5825 };

/**
 * Google's error body (google.rpc.Status): { error: { code, message, status, details: [{ '@type': …ErrorInfo, reason }] } }.
 * The reason is the useful part: BILLING_DISABLED, SERVICE_DISABLED, API_KEY_INVALID, API_KEY_IP_ADDRESS_BLOCKED.
 */
export async function placesError(res: Response): Promise<PlaceProviderError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; status?: string; details?: Array<{ reason?: string }> };
  } | null;
  const reason = body?.error?.details?.find((d) => typeof d?.reason === 'string' && d.reason)?.reason ?? body?.error?.status ?? `HTTP_${res.status}`;
  return new PlaceProviderError(res.status, reason.slice(0, 80), String(body?.error?.message ?? '').slice(0, 300));
}

function transportError(err: unknown): PlaceProviderError {
  const name = (err as { name?: string })?.name;
  return name === 'TimeoutError' || name === 'AbortError'
    ? new PlaceProviderError(null, 'TIMEOUT', 'Google did not answer within 3.5 s.')
    : new PlaceProviderError(null, 'NETWORK', String((err as Error)?.message ?? err).slice(0, 200));
}

export class GooglePlacesProvider implements IPlaceSearchProvider {
  constructor(private readonly apiKey: string | undefined = process.env.GOOGLE_PLACES_API_KEY?.trim() || undefined) {}

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  async suggest(input: { query: string; sessionToken: string }): Promise<PlaceSuggestion[]> {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey!,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
      },
      body: JSON.stringify({
        input: input.query,
        sessionToken: input.sessionToken,
        includedRegionCodes: ['ug'],
        // Greater Kampala first, without excluding the rest of Uganda.
        locationBias: { circle: { center: KAMPALA, radius: 50000 } },
        languageCode: 'en',
      }),
      signal: AbortSignal.timeout(3500),
    }).catch((err) => { throw transportError(err); });
    if (!res.ok) throw await placesError(res);
    const json = (await res.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId?: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }>;
    };
    return (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId && p.structuredFormat?.mainText?.text))
      .slice(0, 5)
      .map((p) => ({
        placeId: p.placeId!,
        name: p.structuredFormat!.mainText!.text!.slice(0, 120),
        detail: (p.structuredFormat!.secondaryText?.text ?? '').replace(/,?\s*Uganda$/i, '').slice(0, 160),
      }));
  }

  async locate(input: { placeId: string; sessionToken: string }): Promise<PlacePoint | null> {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(input.placeId)}?sessionToken=${encodeURIComponent(input.sessionToken)}`;
    const res = await fetch(url, {
      headers: { 'X-Goog-Api-Key': this.apiKey!, 'X-Goog-FieldMask': 'location' },
      signal: AbortSignal.timeout(3500),
    }).catch((err) => { throw transportError(err); });
    if (!res.ok) throw await placesError(res);
    const json = (await res.json()) as { location?: { latitude?: number; longitude?: number } };
    const lat = Number(json.location?.latitude);
    const lng = Number(json.location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }
}

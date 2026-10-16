import { decode as decodePlusCode, isFull as isFullPlusCode, isShort as isShortPlusCode, recoverNearest } from '../../../../packages/shared/src/locations/openLocationCode';

/**
 * A Plus Code the customer pasted or typed (Google Maps shows one for any dropped pin; businesses list them, ours
 * included: "8H7H+M5M Kampala"). Decoded offline by the open-source algorithm — no Google request. A short code is
 * recovered against central Kampala, which is exact anywhere in Greater Kampala (within half a degree); a short
 * code named for a place further away is refused rather than guessed.
 */
export const PLUS_CODE = /(^|[\s,(])([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3})(?=$|[\s,)])/i;
const NEAR_KAMPALA = /\b(kampala|wakiso|mukono|mpigi|entebbe|kira|nansana|makindye|ssabagabo|najjera|ntinda|kawempe|nakawa|rubaga|lubaga|bweyogerere|namugongo|seeta|gayaza|kajjansi|kasangati|matugga|kyaliwajala|kololo|bukoto|kisaasi|kyanja|mengo|nsambya|muyenga|bugolobi|lugogo|naalya)\b/i;
export function plusCodePoint(raw: string): { lat: number; lng: number } | null {
  const m = raw.match(PLUS_CODE);
  if (!m) return null;
  let code = m[2].toUpperCase();
  try {
    if (isShortPlusCode(code)) {
      const rest = raw.replace(m[2], ' ').trim();
      if (rest && !NEAR_KAMPALA.test(rest)) return null;
      code = recoverNearest(code, 0.3476, 32.5825);
    }
    if (!isFullPlusCode(code)) return null;
    const area = decodePlusCode(code);
    const lat = Number(area.latitudeCenter.toFixed(6));
    const lng = Number(area.longitudeCenter.toFixed(6));
    return lat >= -2.5 && lat <= 5.5 && lng >= 28 && lng <= 36.5 ? { lat, lng } : null;
  } catch {
    return null;
  }
}

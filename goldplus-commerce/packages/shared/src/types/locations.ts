/**
 * Minimal JSON on-disk format to save bundle space.
 */
export interface UgandaLocationIndexRecord {
  r: string; // Region
  d: string; // District
  c: string; // County / Municipality
  s: string; // Subcounty / Division / TC
  p: string; // Parish / Ward
  code: string; // Postcode
}

/**
 * Full structured application shape for reliable payload transfer and logic.
 * All client code & database adapters must utilize this interface going forward.
 */
export interface UgandaLocationSelection {
  id: string; 
  locationId: string; // Canonical global identifier requested by audit
  country: "Uganda";
  region: string;
  district: string;
  districtCode?: string;
  countyOrMunicipality: string;
  subcountyDivisionTc: string;
  parishWard: string;
  postcode: string;
  displayLabel: string;
  searchText: string; // Pre-joined field for ranking
  aliases?: string[];
  source?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

/**
 * Normalized structure specifically for preserving legacy support 
 * alongside the full modern entity payload.
 */
export interface UgandaLocationPayload {
  structuredLocation: UgandaLocationSelection;
  addressDetails?: string; // Raw user free-text addition
}

import type { UgandaLocationIndexRecord, UgandaLocationSelection } from '@goldplus/shared';

export interface RankedSearchResult {
  record: UgandaLocationIndexRecord;
  selection: UgandaLocationSelection;
  score: number;
}

/**
 * Capitalizes text nicely for friendly UI display
 */
function titleCase(s: string): string {
  return s.toLowerCase().split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.substring(1))
    .join(' ');
}

/**
 * Global canonical map ensuring unified matching of known variant spellings in dataset.
 */
const CANONICAL_SPELLING: Record<string, string> = {
  'LUWERO': 'LUWEERO',
  'LUWEERO': 'LUWEERO',
  'KATAKWI': 'KATAKWI',
  'KATAWI': 'KATAKWI',
  'NTUNGAMO': 'NTUNGAMO',
  'NTUGAMO': 'NTUNGAMO',
  'NAKAPIRIPIRIT': 'NAKAPIRIPIRIT',
  'NAKAPIRIPIT': 'NAKAPIRIPIRIT'
};

/**
 * Standardizes a word into its primary canonical equivalent for identical comparison weight.
 */
function toCanonical(word: string): string {
  return CANONICAL_SPELLING[word] || word;
}

/**
 * Normalizes input to match dataset case conventions and strips punctuation.
 */
function prepareQuery(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^\w\s]/g, '');
}

/**
 * Canonical conversion mapping Raw mini-record into fully expanded object.
 */
export function normalizeToSelection(row: UgandaLocationIndexRecord): UgandaLocationSelection {
  const subLabel = titleCase(row.s);
  const disLabel = titleCase(row.d);
  const parLabel = titleCase(row.p);
  
  // Disambiguate duplicate label edge-case (e.g., Rubaga parish in Rubaga division)
  const secPart = subLabel === parLabel ? disLabel : `${subLabel}, ${disLabel}`;

  const rawSearch = `${row.p} ${row.s} ${row.c} ${row.d} ${row.code}`.toUpperCase();
  const id = `ug-${row.code}-${row.p.replace(/\s+/g, '')}-${row.s.replace(/\s+/g, '')}-${row.d.replace(/\s+/g, '')}`.toLowerCase();

  return {
    id,
    locationId: id,
    country: "Uganda",
    region: titleCase(row.r || 'Uganda'),
    district: disLabel,
    countyOrMunicipality: titleCase(row.c),
    subcountyDivisionTc: subLabel,
    parishWard: parLabel,
    postcode: row.code,
    displayLabel: `${parLabel} · ${secPart} · ${row.code}`,
    searchText: rawSearch, // Stored raw without duplicate synonym strings
    source: "canonical_v1"
  };
}

export function searchLocations(query: string, dataset: UgandaLocationIndexRecord[], limit = 50): RankedSearchResult[] {
  const cleanQuery = prepareQuery(query);
  if (!cleanQuery || cleanQuery.length < 2) return [];

  const queryParts = cleanQuery.split(/\s+/);
  const canonicalQueryParts = queryParts.map(toCanonical);
  const canonicalWholeQuery = canonicalQueryParts.join(' ');
  
  const results: RankedSearchResult[] = [];
  
  for (const row of dataset) {
    let score = 0;
    const selection = normalizeToSelection(row);
    
    // Fully canonicalized database representations for absolute matching parity
    const cCode = row.code;
    const cParish = toCanonical(row.p);
    const cSub = toCanonical(row.s);
    const cCounty = toCanonical(row.c);
    const cDist = toCanonical(row.d);
    
    const lookupText = `${cParish} ${cSub} ${cCounty} ${cDist} ${cCode}`;

    // 1. WHOLE QUERY EXACT MATCHES
    if (cCode === canonicalWholeQuery) {
      score += 200; // Immediate top priority for exact numeric/string postcodes
    }
    if (cParish === canonicalWholeQuery) score += 120; 
    if (cSub === canonicalWholeQuery) score += 90;
    if (cCounty === canonicalWholeQuery) score += 70;
    if (cDist === canonicalWholeQuery) score += 50;

    // 2. COMPONENT WORD MATCHES
    if (canonicalQueryParts.length > 1) {
      let matchesAll = true;
      let matchCount = 0;
      
      for (const part of canonicalQueryParts) {
        let partMatched = false;
        if (cCode === part) { score += 100; partMatched = true; }
        if (cParish === part) { score += 60; partMatched = true; }
        if (cSub === part) { score += 45; partMatched = true; }
        if (cCounty === part) { score += 35; partMatched = true; }
        if (cDist === part) { score += 25; partMatched = true; }

        if (partMatched) {
          matchCount++;
        } else if (lookupText.includes(part)) {
          score += 15; // Record contains part of components but no field exact hit
          matchCount++;
        } else {
          matchesAll = false;
        }
      }

      // Boost collective intersect score
      if (matchesAll) score += 40;
      else if (matchCount > 0) score += 10 * matchCount;
    } else {
      // Single word partial query matches
      const singlePart = canonicalQueryParts[0];
      if (cCode.startsWith(singlePart)) score += 40;
      if (cParish.startsWith(singlePart)) score += 30;
      if (cSub.startsWith(singlePart)) score += 20;
      if (cDist.startsWith(singlePart)) score += 10;
      
      if (cParish.includes(singlePart)) score += 10;
      if (cSub.includes(singlePart)) score += 5;
      if (cDist.includes(singlePart)) score += 2;
    }

    // Catch-all general search text match if no specific weights hit
    if (score === 0 && lookupText.includes(canonicalWholeQuery)) {
      score += 25;
    }

    // 3. KAMPALA CAPITAL CITY CLARITY RESOLVER
    // Boost local Kampala capital city districts immediately over outlying accidental parish overlaps
    if (canonicalWholeQuery.includes('KAMPALA') && cDist === 'KAMPALA') {
      score += 60;
    }

    if (score > 0) {
      results.push({
        record: row,
        selection,
        score
      });
    }
  }

  // Sort absolutely by calculated relevance weight, falling back on alphabetic disambiguation
  return results
    .sort((a, b) => b.score - a.score || a.selection.parishWard.localeCompare(b.selection.parishWard))
    .slice(0, limit);
}


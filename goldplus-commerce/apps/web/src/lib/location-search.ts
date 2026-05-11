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
 * Maps common data inconsistencies and spelling variants defined by the user auditing constraints.
 */
const SPELLING_ALIASES: Record<string, string> = {
  'LUWERO': 'LUWEERO',
  'LUWEERO': 'LUWERO',
  'KATAKWI': 'KATAWI',
  'KATAWI': 'KATAKWI',
  'NTUNGAMO': 'NTUGAMO',
  'NTUGAMO': 'NTUNGAMO',
  'NAKAPIRIPIRIT': 'NAKAPIRIPIT',
  'NAKAPIRIPIT': 'NAKAPIRIPIRIT'
};

/**
 * Normalizes input to match dataset case conventions.
 */
function prepareQuery(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^\w\s]/g, ''); // clear punctuation
}

/**
 * Identifies relevant synonyms to append to the search index.
 */
function getSynonyms(base: string): string {
  const words = base.toUpperCase().split(/\s+/);
  const results: string[] = [];
  words.forEach(w => {
    if (SPELLING_ALIASES[w]) results.push(SPELLING_ALIASES[w]);
  });
  return results.join(' ');
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
  const synonyms = getSynonyms(rawSearch);
  const id = `ug-${row.code}-${row.p.replace(/\s+/g, '')}`;

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
    searchText: `${rawSearch} ${synonyms}`.trim(), // Enriched search includes both spellings
    source: "canonical_v1"
  };
}

export function searchLocations(query: string, dataset: UgandaLocationIndexRecord[], limit = 50): RankedSearchResult[] {
  const cleanQuery = prepareQuery(query);
  if (!cleanQuery || cleanQuery.length < 2) return [];

  const isNumeric = /^\d+$/.test(cleanQuery);
  
  const results: RankedSearchResult[] = [];
  
  for (const row of dataset) {
    let score = 0;
    const selection = normalizeToSelection(row);

    // Rule A: Exact Postcode Trigger
    if (row.code === cleanQuery) {
      score += 150; // Guaranteed top placement over all text matching
    } else if (isNumeric && row.code.startsWith(cleanQuery)) {
      score += 85;
    }

    // Rule B: Precise scoring metrics from auditing constraints
    const lookupText = selection.searchText;
    
    // Check if query matches canonical fields specifically (supports alternative spellings via searchText cascade)
    // Parish Exact: 95
    if (row.p === cleanQuery) score += 95;
    else if (row.p.startsWith(cleanQuery)) score += 30;
    else if (row.p.includes(cleanQuery)) score += 10;
    
    // Subcounty Exact: 70
    if (row.s === cleanQuery) score += 70;
    else if (row.s.includes(cleanQuery)) score += 5;
    
    // District Exact: 40
    if (row.d === cleanQuery) score += 40;
    else if (row.d.includes(cleanQuery)) score += 2;

    // Catch-all synonym matching boost if specific slots failed but alias matched.
    // Upgraded from 5 to 35 so misspelled variants rank immediately behind exact text matching.
    if (score < 20 && lookupText.includes(cleanQuery)) {
      score += 35; 
    }

    // Split-word matching boost
    const queryParts = cleanQuery.split(/\s+/);
    if (queryParts.length > 1) {
       // Use dynamic target text that includes ALL variants computed by normalizer
       const textTarget = selection.searchText;
       
       // Check how many individual query terms intersect the record string
       let matchesCount = 0;
       for (const part of queryParts) {
         if (textTarget.includes(part)) {
            matchesCount++;
         }
       }
       
       // Partial matching: boost if ANY multiple words hit. Bigger boost if ALL words hit.
       if (matchesCount === queryParts.length) score += 30; // Perfect intersection
       else if (matchesCount > 0) score += 10 * matchesCount; 
    }

    if (score > 0) {
      results.push({
        record: row,
        selection,
        score
      });
    }
  }

  // Sort purely by weight, resolving collisions by parish name sort alphabetically
  return results
    .sort((a, b) => b.score - a.score || a.selection.parishWard.localeCompare(b.selection.parishWard))
    .slice(0, limit);
}

/**
 * The ONE table of district spellings other sources use for a district the shop spells differently. Keys are upper
 * case; values are the shop's Title Case name (as `normalizeUgandaDistrict` returns it). Both the district normaliser
 * (uganda.ts) and the lineage matcher (districtLineage.ts) read it, so the two can never disagree about a spelling.
 * Add a row the first time a dataset's district fails to match, never a guess.
 */
export const DISTRICT_SPELLING_VARIANTS: Readonly<Record<string, string>> = {
  LUWEERO: 'Luwero',
  SSEMBABULE: 'Sembabule',
  KATAWI: 'Katakwi',
  NAKAPIRIPIT: 'Nakapiripirit',
  NTUGAMO: 'Ntungamo',
  'MADI OKOLLO': 'Madi-Okollo',
  MADIOKOLLO: 'Madi-Okollo',
  // The 2019 Ministry of ICT postcode source spells these with a single consonant/vowel where the current official
  // list doubles it. Same districts, different orthography.
  KASANDA: 'Kassanda',
  KIKUBE: 'Kikuube',
  // The UBOS 2016 parish file writes KABONG for Kaabong.
  KABONG: 'Kaabong',
  LUBAGA: 'Kampala',
  'FORT PORTAL': 'Kabarole',
  'KAMPALA CITY': 'Kampala',
  'KAMPALA CAPITAL CITY': 'Kampala',
};

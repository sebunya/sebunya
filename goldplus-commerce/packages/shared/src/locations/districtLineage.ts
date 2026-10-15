/**
 * District lineage: which current district was carved out of which, so that
 * name matching between datasets that each use a different district list
 * (UBOS 2016 polygons: 116; the 2019 postcode tables: 128; the 2021 list in
 * `uganda.ts`: 135 + Kampala; the Electoral Commission's 2025 count: 146
 * districts and cities) runs inside a FAMILY, never on district equality.
 *
 * A family is a district, its parents, its grandparents and every sibling
 * carved from the same parent. "Kazo" and "Kiruhura" are one family, so a
 * Kazo parish can match a polygon the 2016 file lists under Kiruhura; a
 * "Kampala" parish in Sembabule can never match Kampala.
 *
 * Sources: the Ministry of ICT 2019 prefix table (which still lists Kazo under
 * Kiruhura, Madi-Okollo under Arua, Kitagwenda under Kamwenge, Kalaki under
 * Kaberamaido, Obongi under Moyo, Rwampara under Mbarara) and the creations
 * gazetted between 2016 and 2021. The ten cities of 2020 are families with the
 * district they were carved from. Districts approved in 2025 (Mukuju, Mulanda,
 * a third from Tororo; Tororo City) are listed so a customer naming them
 * resolves, marked `proposed` until gazetted.
 *
 * Reviewed in a pull request like any other data; the yearly administrative
 * drift report (spec §7.4) is what adds to it.
 */
export interface DistrictLineageRow {
  /** Current district or city, Title Case as `normalizeUgandaDistrict` returns it. */
  child: string;
  /** The district it was carved from, Title Case. */
  parent: string;
  /** Year it became operational, when known. */
  year?: number;
  /** 'city' when the child is a city carved out of (and still surrounded by) its parent district. */
  kind?: 'district' | 'city';
  /** Approved but not yet gazetted as operational at the time of writing. */
  proposed?: boolean;
}

export const DISTRICT_LINEAGE: readonly DistrictLineageRow[] = [
  // Created 2016–2021, in the order the Ministry's 2019 prefix table still nests them.
  { child: 'Kagadi', parent: 'Kibaale', year: 2016 },
  { child: 'Kakumiro', parent: 'Kibaale', year: 2016 },
  { child: 'Omoro', parent: 'Gulu', year: 2016 },
  { child: 'Rubanda', parent: 'Kabale', year: 2016 },
  { child: 'Namisindwa', parent: 'Manafwa', year: 2017 },
  { child: 'Pakwach', parent: 'Nebbi', year: 2017 },
  { child: 'Butebo', parent: 'Pallisa', year: 2017 },
  { child: 'Rukiga', parent: 'Kabale', year: 2017 },
  { child: 'Kyotera', parent: 'Rakai', year: 2017 },
  { child: 'Bunyangabu', parent: 'Kabarole', year: 2017 },
  { child: 'Nabilatuk', parent: 'Nakapiripirit', year: 2018 },
  { child: 'Bugweri', parent: 'Iganga', year: 2018 },
  { child: 'Kassanda', parent: 'Mubende', year: 2018 },
  { child: 'Kwania', parent: 'Apac', year: 2018 },
  { child: 'Kapelebyong', parent: 'Amuria', year: 2018 },
  { child: 'Kikuube', parent: 'Hoima', year: 2018 },
  { child: 'Obongi', parent: 'Moyo', year: 2019 },
  { child: 'Kazo', parent: 'Kiruhura', year: 2019 },
  { child: 'Rwampara', parent: 'Mbarara', year: 2019 },
  { child: 'Kitagwenda', parent: 'Kamwenge', year: 2019 },
  { child: 'Madi-Okollo', parent: 'Arua', year: 2019 },
  { child: 'Karenga', parent: 'Kaabong', year: 2019 },
  { child: 'Kalaki', parent: 'Kaberamaido', year: 2019 },
  { child: 'Terego', parent: 'Arua', year: 2020 },
  // The ten cities of 2020–2021: one family with the district around them.
  { child: 'Arua City', parent: 'Arua', year: 2020, kind: 'city' },
  { child: 'Fort Portal City', parent: 'Kabarole', year: 2020, kind: 'city' },
  { child: 'Gulu City', parent: 'Gulu', year: 2020, kind: 'city' },
  { child: 'Hoima City', parent: 'Hoima', year: 2020, kind: 'city' },
  { child: 'Jinja City', parent: 'Jinja', year: 2020, kind: 'city' },
  { child: 'Lira City', parent: 'Lira', year: 2020, kind: 'city' },
  { child: 'Masaka City', parent: 'Masaka', year: 2020, kind: 'city' },
  { child: 'Mbale City', parent: 'Mbale', year: 2020, kind: 'city' },
  { child: 'Mbarara City', parent: 'Mbarara', year: 2020, kind: 'city' },
  { child: 'Soroti City', parent: 'Soroti', year: 2020, kind: 'city' },
  // Approved April 2025; operational dates to be confirmed in the Gazette.
  { child: 'Mukuju', parent: 'Tororo', proposed: true },
  { child: 'Mulanda', parent: 'Tororo', proposed: true },
  { child: 'Tororo City', parent: 'Tororo', kind: 'city', proposed: true },
];

/**
 * Spellings other datasets use for a district the shop spells differently.
 * The UBOS 2016 parish file writes KABONG for Kaabong; the shop's own list
 * cannot normalise it. Keys and values are upper case. Add a row the first
 * time a dataset's district fails to match, never a guess.
 */
export const DISTRICT_NAME_VARIANTS: Readonly<Record<string, string>> = {
  KABONG: 'KAABONG',
  'MADI OKOLLO': 'MADI-OKOLLO',
  KASANDA: 'KASSANDA',
  SSEMBABULE: 'SEMBABULE',
  LUWEERO: 'LUWERO',
};

/** Upper-cased, whitespace-collapsed, with known variant spellings mapped to the shop's. */
export function canonicalDistrictKey(name: string): string {
  const key = name.trim().replace(/\s+/g, ' ').toUpperCase();
  return DISTRICT_NAME_VARIANTS[key] ?? key;
}

const KEY = canonicalDistrictKey;

/** parent → children and child → parent, both upper-cased, built once. */
const PARENT_OF = new Map<string, string>();
const CHILDREN_OF = new Map<string, Set<string>>();
for (const row of DISTRICT_LINEAGE) {
  const child = KEY(row.child);
  const parent = KEY(row.parent);
  PARENT_OF.set(child, parent);
  if (!CHILDREN_OF.has(parent)) CHILDREN_OF.set(parent, new Set());
  CHILDREN_OF.get(parent)!.add(child);
}

/**
 * Every district name (upper-cased) that may be treated as the same place
 * when matching names across datasets: the district itself, its ancestors,
 * and every descendant of those ancestors. Always contains the input.
 */
export function lineageFamily(district: string): ReadonlySet<string> {
  const start = KEY(district);
  if (!start) return new Set();
  // Climb to the root of the family.
  let root = start;
  const seen = new Set<string>([root]);
  while (PARENT_OF.has(root)) {
    root = PARENT_OF.get(root)!;
    if (seen.has(root)) break; // a cycle would be a data error; never loop
    seen.add(root);
  }
  // Collect everything beneath the root.
  const family = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of CHILDREN_OF.get(current) ?? []) {
      if (!family.has(child)) {
        family.add(child);
        queue.push(child);
      }
    }
  }
  family.add(start);
  return family;
}

/** True when two district names belong to one lineage family. */
export function sameLineageFamily(a: string, b: string): boolean {
  return lineageFamily(a).has(KEY(b));
}

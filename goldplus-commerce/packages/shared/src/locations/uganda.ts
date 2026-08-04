/**
 * Canonical Uganda location vocabulary for delivery capture.
 *
 * WHY THIS REPLACED THE GAZETTEER
 * The previous picker searched a 5,700-row postcode spreadsheet that was
 * provably wrong where it mattered most: Wakiso — the country's most populous
 * district and the heart of Kampala metro — was missing from the detail data
 * entirely; Kireka and Nansana (both Wakiso) were filed under Mukono, which
 * silently mis-zoned deliveries; Ntinda was placed in the wrong division;
 * Bugolobi, Najjera and Kisaasi did not exist at all; district names carried
 * typos (KATAWI, NTUGAMO); and every result advertised a postal code nobody in
 * Uganda uses to receive a parcel.
 *
 * The replacement keeps structure ONLY where it can be verified:
 *   - the official district list (135 districts + Kampala Capital City), which
 *     is what delivery-fee zones and routing key on;
 *   - a curated alias index of well-known towns and neighbourhoods, each
 *     mapped to its VERIFIED district, so customers can type the place name
 *     they actually use ("Najjera", "Seeta", "Fort Portal") and land on the
 *     right district.
 * Everything finer-grained (estate, road, landmark) is deliberately free text:
 * Ugandan last-mile delivery runs on landmarks and a phone call, and any
 * parish/postcode dropdown is precision theatre on bad data.
 */

/** All 136 district-level units (135 districts + Kampala Capital City), Title Case. */
export const UGANDA_DISTRICTS: readonly string[] = [
  // Central
  'Buikwe', 'Bukomansimbi', 'Butambala', 'Buvuma', 'Gomba', 'Kalangala',
  'Kalungu', 'Kampala', 'Kassanda', 'Kayunga', 'Kiboga', 'Kyankwanzi',
  'Kyotera', 'Luwero', 'Lwengo', 'Lyantonde', 'Masaka', 'Mityana', 'Mpigi',
  'Mubende', 'Mukono', 'Nakaseke', 'Nakasongola', 'Rakai', 'Sembabule',
  'Wakiso',
  // Eastern
  'Amuria', 'Budaka', 'Bududa', 'Bugiri', 'Bugweri', 'Bukedea', 'Bukwo',
  'Bulambuli', 'Busia', 'Butaleja', 'Butebo', 'Buyende', 'Iganga', 'Jinja',
  'Kaberamaido', 'Kalaki', 'Kaliro', 'Kamuli', 'Kapchorwa', 'Kapelebyong',
  'Katakwi', 'Kibuku', 'Kumi', 'Kween', 'Luuka', 'Manafwa', 'Mayuge', 'Mbale',
  'Namayingo', 'Namisindwa', 'Namutumba', 'Ngora', 'Pallisa', 'Serere',
  'Sironko', 'Soroti', 'Tororo',
  // Northern (Acholi, Lango, West Nile, Karamoja)
  'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat', 'Amuru',
  'Apac', 'Arua', 'Dokolo', 'Gulu', 'Kaabong', 'Karenga', 'Kitgum', 'Koboko',
  'Kole', 'Kotido', 'Kwania', 'Lamwo', 'Lira', 'Madi-Okollo', 'Maracha',
  'Moroto', 'Moyo', 'Nabilatuk', 'Nakapiripirit', 'Napak', 'Nebbi', 'Nwoya',
  'Obongi', 'Omoro', 'Otuke', 'Oyam', 'Pader', 'Pakwach', 'Terego', 'Yumbe',
  'Zombo',
  // Western (Ankole, Kigezi, Tooro, Bunyoro)
  'Buhweju', 'Buliisa', 'Bundibugyo', 'Bunyangabu', 'Bushenyi', 'Hoima',
  'Ibanda', 'Isingiro', 'Kabale', 'Kabarole', 'Kagadi', 'Kakumiro',
  'Kamwenge', 'Kanungu', 'Kasese', 'Kazo', 'Kibaale', 'Kikuube', 'Kiruhura',
  'Kiryandongo', 'Kisoro', 'Kitagwenda', 'Kyegegwa', 'Kyenjojo', 'Masindi',
  'Mbarara', 'Mitooma', 'Ntoroko', 'Ntungamo', 'Rubanda', 'Rubirizi',
  'Rukiga', 'Rukungiri', 'Rwampara', 'Sheema',
] as const;

/**
 * Common spelling variants → canonical district. Includes the typos the old
 * dataset itself shipped, so anything it stored still normalises.
 */
const DISTRICT_SPELLING_VARIANTS: Record<string, string> = {
  LUWEERO: 'Luwero',
  SSEMBABULE: 'Sembabule',
  KATAWI: 'Katakwi',
  NAKAPIRIPIT: 'Nakapiripirit',
  NTUGAMO: 'Ntungamo',
  'MADI OKOLLO': 'Madi-Okollo',
  MADIOKOLLO: 'Madi-Okollo',
  LUBAGA: 'Kampala',
  'FORT PORTAL': 'Kabarole',
  'KAMPALA CITY': 'Kampala',
  'KAMPALA CAPITAL CITY': 'Kampala',
};

/**
 * Well-known places customers actually type, each mapped to its verified
 * district. Curated and conservative: an alias earns its row only when the
 * area→district mapping is unambiguous — a wrong entry here mis-zones real
 * deliveries, which is the exact failure this module exists to end.
 */
export const UGANDA_PLACE_ALIASES: ReadonlyArray<{ area: string; district: string }> = [
  // Kampala city neighbourhoods & divisions
  { area: 'Ntinda', district: 'Kampala' },
  { area: 'Kololo', district: 'Kampala' },
  { area: 'Nakasero', district: 'Kampala' },
  { area: 'Bugolobi', district: 'Kampala' },
  { area: 'Muyenga', district: 'Kampala' },
  { area: 'Kabalagala', district: 'Kampala' },
  { area: 'Kansanga', district: 'Kampala' },
  { area: 'Wandegeya', district: 'Kampala' },
  { area: 'Makerere', district: 'Kampala' },
  { area: 'Kamwokya', district: 'Kampala' },
  { area: 'Bukoto', district: 'Kampala' },
  { area: 'Kisaasi', district: 'Kampala' },
  { area: 'Kyanja', district: 'Kampala' },
  { area: 'Naguru', district: 'Kampala' },
  { area: 'Luzira', district: 'Kampala' },
  { area: 'Mbuya', district: 'Kampala' },
  { area: 'Mengo', district: 'Kampala' },
  { area: 'Old Kampala', district: 'Kampala' },
  { area: 'Kibuli', district: 'Kampala' },
  { area: 'Nsambya', district: 'Kampala' },
  { area: 'Katwe', district: 'Kampala' },
  { area: 'Ndeeba', district: 'Kampala' },
  { area: 'Nateete', district: 'Kampala' },
  { area: 'Bwaise', district: 'Kampala' },
  { area: 'Kawempe', district: 'Kampala' },
  { area: 'Makindye', district: 'Kampala' },
  { area: 'Nakawa', district: 'Kampala' },
  { area: 'Rubaga', district: 'Kampala' },
  { area: 'Najjanankumbi', district: 'Kampala' },
  { area: 'Munyonyo', district: 'Kampala' },
  { area: 'Buziga', district: 'Kampala' },
  { area: 'Kibuye', district: 'Kampala' },
  { area: 'Kalerwe', district: 'Kampala' },
  { area: 'Kitintale', district: 'Kampala' },

  // Wakiso — Kampala metro (the district the old data lost entirely)
  { area: 'Entebbe', district: 'Wakiso' },
  { area: 'Kira', district: 'Wakiso' },
  { area: 'Kireka', district: 'Wakiso' },
  { area: 'Bweyogerere', district: 'Wakiso' },
  { area: 'Namugongo', district: 'Wakiso' },
  { area: 'Kyaliwajjala', district: 'Wakiso' },
  { area: 'Najjera', district: 'Wakiso' },
  { area: 'Buwaate', district: 'Wakiso' },
  { area: 'Naalya', district: 'Wakiso' },
  { area: 'Kasangati', district: 'Wakiso' },
  { area: 'Gayaza', district: 'Wakiso' },
  { area: 'Nansana', district: 'Wakiso' },
  { area: 'Kajjansi', district: 'Wakiso' },
  { area: 'Zzana', district: 'Wakiso' },
  { area: 'Bwebajja', district: 'Wakiso' },
  { area: 'Kisubi', district: 'Wakiso' },
  { area: 'Nsangi', district: 'Wakiso' },
  { area: 'Kyengera', district: 'Wakiso' },
  { area: 'Matugga', district: 'Wakiso' },
  { area: 'Wakiso Town', district: 'Wakiso' },
  { area: 'Busabala', district: 'Wakiso' },
  { area: 'Nalumunye', district: 'Wakiso' },

  // Greater Kampala neighbours & notable towns with a different district name
  { area: 'Mukono Town', district: 'Mukono' },
  { area: 'Seeta', district: 'Mukono' },
  { area: 'Namilyango', district: 'Mukono' },
  { area: 'Lugazi', district: 'Buikwe' },
  { area: 'Njeru', district: 'Buikwe' },
  { area: 'Bombo', district: 'Luwero' },
  { area: 'Wobulenzi', district: 'Luwero' },
  { area: 'Bugembe', district: 'Jinja' },
  { area: 'Fort Portal', district: 'Kabarole' },
  { area: 'Ishaka', district: 'Bushenyi' },
  { area: 'Bweyale', district: 'Kiryandongo' },
];

const DISTRICT_LOOKUP: ReadonlyMap<string, string> = new Map([
  ...UGANDA_DISTRICTS.map((d) => [d.toUpperCase(), d] as const),
  ...Object.entries(DISTRICT_SPELLING_VARIANTS).map(([k, v]) => [k, v] as const),
]);

/**
 * Resolve free-form input to a canonical district name, or null.
 * Trims, collapses whitespace, ignores case, and accepts known variants.
 */
export function normalizeUgandaDistrict(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!key) return null;
  return DISTRICT_LOOKUP.get(key) ?? null;
}

/** The lean location payload the picker emits. Finer detail is free text by design. */
export interface UgandaPlaceSelection {
  district: string;
  /** Neighbourhood/town label when the customer picked a known place. */
  area?: string;
  displayLabel: string;
}

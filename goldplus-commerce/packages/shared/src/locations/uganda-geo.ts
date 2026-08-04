import { UGANDA_PLACE_ALIASES } from './uganda';

/**
 * Geography as data: approximate TRUNK-ROAD distance from Kampala (km) for
 * every district-level unit, plus finer-grained distances from the CBD for the
 * curated metro areas.
 *
 * WHY THIS EXISTS
 * Uganda has no street addressing and the platform has almost no fee history,
 * so delivery-fee prediction cannot come from ML over orders. What IS stable,
 * public and verifiable is road geography: Jinja is ~80 km away, Mbarara ~270,
 * Arua ~500 — and parcel cost tracks that distance in bands (boda rings inside
 * Kampala metro, bus-parcel bands upcountry). Embedding the geography once
 * turns "price the whole country" into "tune eight band prices".
 *
 * PRECISION IS DELIBERATELY COARSE. Distances are rounded (±10–15% is fine):
 * the fee model quantises into bands, so small errors almost never change the
 * predicted fee — and predictions are always labelled estimates until an
 * operator confirms a zone. Do not "improve" this file with fake precision.
 */
export const UGANDA_DISTRICT_ROAD_KM: Readonly<Record<string, number>> = {
  // Central
  Kampala: 0, Wakiso: 15, Mukono: 25, Mpigi: 40, Buikwe: 60, Luwero: 65,
  Kayunga: 75, Mityana: 75, Butambala: 75, Buvuma: 90, Nakaseke: 90,
  Gomba: 100, Kalungu: 115, Kiboga: 120, Masaka: 130, Nakasongola: 130,
  Kalangala: 130, Kassanda: 130, Mubende: 150, Bukomansimbi: 150, Lwengo: 150,
  Kyankwanzi: 150, Kyotera: 160, Sembabule: 180, Lyantonde: 180, Rakai: 180,
  // Eastern
  Jinja: 80, Luuka: 100, Iganga: 115, Kamuli: 120, Bugweri: 125, Mayuge: 130,
  Bugiri: 140, Kaliro: 150, Namutumba: 150, Buyende: 170, Kibuku: 180,
  Namayingo: 180, Busia: 200, Pallisa: 200, Butebo: 200, Tororo: 210, Budaka: 210,
  Mbale: 225, Butaleja: 230, Sironko: 250, Bududa: 250, Manafwa: 250,
  Bulambuli: 260, Namisindwa: 260, Bukedea: 260, Kapchorwa: 280, Kumi: 285,
  Kween: 300, Ngora: 300, Serere: 320, Soroti: 330, Bukwo: 350,
  Kaberamaido: 360, Amuria: 370, Kalaki: 370, Katakwi: 380, Kapelebyong: 400,
  // Northern (Acholi, Lango, West Nile, Karamoja)
  Amolatar: 250, Kwania: 280, Apac: 300, Dokolo: 300, Omoro: 300, Gulu: 330,
  Lira: 340, Nwoya: 350, Oyam: 350, Kole: 360, Alebtong: 360, Amuru: 380,
  Pakwach: 390, Pader: 400, Otuke: 400, Agago: 420, Nebbi: 430, Kitgum: 440,
  Adjumani: 450, Moyo: 470, 'Madi-Okollo': 470, Zombo: 470, Lamwo: 480,
  Arua: 500, Obongi: 500, Terego: 520, Yumbe: 520, Maracha: 530, Koboko: 560,
  Abim: 450, Nakapiripirit: 400, Nabilatuk: 420, Amudat: 430, Napak: 440,
  Moroto: 480, Kotido: 520, Kaabong: 600, Karenga: 650,
  // Western (Bunyoro, Tooro, Ankole, Kigezi)
  Kakumiro: 190, Hoima: 200, Masindi: 210, Kyegegwa: 210, Kibaale: 220,
  Kikuube: 230, Kiryandongo: 230, Kiruhura: 230, Kagadi: 250, Kyenjojo: 250,
  Kazo: 260, Mbarara: 270, Rwampara: 290, Kabarole: 300, Bushenyi: 300,
  Buliisa: 300, Isingiro: 300, Ibanda: 300, Sheema: 310, Bunyangabu: 320,
  Kamwenge: 320, Buhweju: 320, Mitooma: 330, Ntungamo: 340, Kitagwenda: 340,
  Rubirizi: 350, Kasese: 370, Bundibugyo: 380, Rukungiri: 380, Ntoroko: 390,
  Rukiga: 390, Kabale: 410, Kanungu: 420, Rubanda: 430, Kisoro: 470,
};

/**
 * Distance from Kampala CBD for the curated metro areas (km). Only areas that
 * genuinely sit inside the Greater-Kampala rider radius carry an entry —
 * upcountry aliases (Lugazi, Fort Portal, Bweyale…) intentionally fall back to
 * their district's road distance. An area entry lets Wakiso price honestly:
 * Nansana at ~12 km is a boda trip; Entebbe at ~40 km is not the same fee.
 */
export const UGANDA_METRO_AREA_KM: Readonly<Record<string, number>> = {
  // Kampala city
  Nakasero: 1, 'Old Kampala': 2, Wandegeya: 3, Mengo: 3, Katwe: 3, Kololo: 4,
  Makerere: 4, Kamwokya: 4, Kibuli: 4, Kibuye: 4, Naguru: 5, Bugolobi: 5,
  Nsambya: 5, Ndeeba: 5, Rubaga: 5, Bukoto: 6, Kabalagala: 6, Bwaise: 6,
  Makindye: 6, Nakawa: 6, Kalerwe: 6, Muyenga: 7, Kansanga: 7, Mbuya: 7,
  Nateete: 7, Najjanankumbi: 7, Ntinda: 8, Kawempe: 8, Kitintale: 8,
  Kisaasi: 9, Kyanja: 10, Luzira: 10, Buziga: 10, Munyonyo: 12,
  // Wakiso metro
  Nansana: 12, Kireka: 12, Kyengera: 13, Naalya: 13, Najjera: 14,
  Bweyogerere: 14, Zzana: 14, Kira: 15, Busabala: 15, Kyaliwajjala: 15,
  Namugongo: 16, Buwaate: 16, Kasangati: 16, Nalumunye: 16, Nsangi: 17,
  Gayaza: 18, Kajjansi: 18, Matugga: 18, 'Wakiso Town': 20, Bwebajja: 22,
  Kisubi: 30, Entebbe: 40,
  // Mukono metro edge
  Seeta: 20, Namilyango: 23, 'Mukono Town': 25,
};

/** Road distance for a district, or null when the name is not canonical. */
export function districtRoadKm(district: string): number | null {
  return UGANDA_DISTRICT_ROAD_KM[district] ?? null;
}

/**
 * Best available distance for a delivery point: the metro area's own distance
 * when the area is known and mapped, otherwise the district's road distance.
 */
export function deliveryPointKm(district: string, area?: string | null): number | null {
  if (area) {
    const areaKm = UGANDA_METRO_AREA_KM[area.trim()];
    if (areaKm !== undefined) return areaKm;
  }
  return districtRoadKm(district);
}

/** Every curated alias either has a metro distance or falls back to a district that has one. */
export function geoCoverageGaps(): string[] {
  const gaps: string[] = [];
  for (const alias of UGANDA_PLACE_ALIASES) {
    if (UGANDA_METRO_AREA_KM[alias.area] === undefined && UGANDA_DISTRICT_ROAD_KM[alias.district] === undefined) {
      gaps.push(`${alias.area} -> ${alias.district}`);
    }
  }
  return gaps;
}

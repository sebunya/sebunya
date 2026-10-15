# Geographic reference data

## `ug_parishes_2016_centroids_wgs84.csv`

One row per parish polygon in the Uganda Bureau of Statistics 2016 parish boundary file (`Ug_Parishes_2016.shp`,
7,566 polygons, 116 districts of 2016), reduced to what the delivery module needs: the polygon's geometric centroid,
its area and its bounding box, in WGS84.

| Column | Meaning |
|---|---|
| `objectid` | the shapefile's record number |
| `district`, `county`, `subcounty`, `parish` | names as the shapefile spells them (upper case, 2016 units) |
| `village_hq` | the shapefile's reference village for the parish |
| `pcode` | the shapefile's PCODE (district + county + sub-county + parish, concatenated) |
| `lat`, `lng` | geometric centroid of the polygon, WGS84 degrees |
| `area_km2` | polygon area |
| `bbox_s`, `bbox_w`, `bbox_n`, `bbox_e` | bounding box, WGS84 degrees |

**Derivation (2026-10-15):** coordinates reprojected from Arc 1960 / UTM zone 36S (EPSG:21036; Clarke 1880 RGS)
with the Transverse Mercator inverse and the EPSG:1122 datum shift (dX −160, dY −6, dZ −302 m). Verified against
known points: Civic Centre 0.3127, 32.5860; Kabalagala 0.3011, 32.5992; Ntinda 0.3467, 32.6181; Bugolobi 0.3112,
32.6227. MD5 `21c31d6a7c04ed6213f24b56d7da0fad`; the importer refuses any other.

**What it is used for:** `apps/api/src/scripts/geo-import-parish-centroids.ts` gives each metro delivery area
(`delivery_corridor`) the centroid of the parish it names, with an expected error derived from the polygon's size,
and reports every area whose point disagrees with the distance band the team assigned by hand. The polygons
themselves (the rings) are not in the repository; the shapefile is in the owner's `uganda-APIs` archive.

**Attribution:** Uganda Bureau of Statistics, 2016 parish boundaries. The 2016 district list predates 30 of today's
districts; `packages/shared/src/locations/districtLineage.ts` maps each current district to its 2016 parent so names
are matched inside the right family.

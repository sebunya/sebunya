# Vendored packages

`xlsx-0.20.3.tgz`: SheetJS spreadsheet reader, used by the battery list import
(`apps/api/src/infrastructure/batteries/XlsxSpreadsheetParser.ts`).

SheetJS stopped publishing to npm at 0.18.5, which carries prototype-pollution
and ReDoS advisories (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) with no npm fix.
The fixed releases are published at https://cdn.sheetjs.com, and SheetJS
recommends vendoring the tarball. Downloaded 2026-10-07 from
https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

sha256 8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8

To upgrade: download the new tarball from the same CDN, record its sha256 here,
point both package.json files at it, and run the battery import tests.

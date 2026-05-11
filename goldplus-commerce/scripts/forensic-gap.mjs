import XLSX from 'xlsx';
import fs from 'fs';

const wb = XLSX.readFile('./apps/web/public/data/uganda-locations.xlsx');
const allCodes = [];
const targetSheets = [
  'Kampala', 'Central Region', 'Eastern Region', 'Western Region',
  'Mid-Western District', 'West Nile', 'Northern Region', 'North Eastern Region'
];

targetSheets.forEach(sheet => {
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {header: 1});
  data.forEach(row => {
    row.forEach(cell => {
      const s = String(cell || '').trim();
      if (/^[1-9]\d{4}$/.test(s)) {
        allCodes.push({sheet, code: s, row: row.filter(x => x)});
      }
    });
  });
});

console.log(`Total raw codes found across region sheets: ${allCodes.length}`);
const counts = {};
allCodes.forEach(c => { counts[c.code] = (counts[c.code] || 0) + 1; });
console.log(`Unique codes: ${Object.keys(counts).length}`);

const saved = JSON.parse(fs.readFileSync('./apps/web/public/data/uganda-locations-final.json', 'utf8'));
const savedMap = {};
saved.forEach(r => { savedMap[r.code] = (savedMap[r.code] || 0) + 1; });
console.log(`Saved in final json: ${saved.length}`);

console.log("Diff analysis:");
const missing = [];
allCodes.forEach(c => {
  if (!savedMap[c.code]) {
     missing.push(c);
  }
});

console.log("ABSOLUTELY MISSING ENTRIES (Code exists in raw sheet but not saved):");
console.log(JSON.stringify(missing, null, 2));

import xlsx from 'xlsx';
const wb = xlsx.readFile('./apps/web/public/data/uganda-locations.xlsx');
const data = xlsx.utils.sheet_to_json(wb.Sheets['Central Region'], { header: 1 });

let lastSeenDistrict = null;
for (let i = 0; i <= 729; i++) {
   const row = data[i];
   if (!row || !row[0]) continue;
   const firstVal = String(row[0]).toUpperCase();
   if (firstVal.includes("DISTRICT")) {
      lastSeenDistrict = row[0];
   }
}
console.log("Final Detected Inherited District at index 729:", lastSeenDistrict);

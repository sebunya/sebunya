import xlsx from 'xlsx';
const wb = xlsx.readFile('./apps/web/public/data/uganda-locations.xlsx');
const data = xlsx.utils.sheet_to_json(wb.Sheets['Central Region'], { header: 1 });

let currentD = null;
let currentC = null;
for (let i = 0; i < 735; i++) {
  const row = data[i];
  if (row && row[0] && typeof row[0] === 'string') { currentD = row[0]; } // Wait, look at script
  if (row && row[1] && typeof row[1] === 'string') { currentC = row[1]; }
  
  if (i === 729) {
     console.log("Kireka Parent Inheritance State at Index", i, ":", { district: currentD, county: currentC });
  }
}

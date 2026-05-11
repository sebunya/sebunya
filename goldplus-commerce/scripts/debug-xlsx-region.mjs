import xlsx from 'xlsx';
const wb = xlsx.readFile('./apps/web/public/data/uganda-locations.xlsx');
const data = xlsx.utils.sheet_to_json(wb.Sheets['Central Region'], { header: 1 });

for (let i = 710; i < 735; i++) {
  console.log(`[Row ${i}]:`, JSON.stringify(data[i]));
}

import XLSX from 'xlsx';
const wb = XLSX.readFile('./apps/web/public/data/uganda-locations.xlsx');
const data = XLSX.utils.sheet_to_json(wb.Sheets['Kampala']);
const target = data.find(r => Object.values(r).includes(10318));
console.log(JSON.stringify(target, null, 2));

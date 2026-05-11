import xlsx from 'xlsx';

const wb = xlsx.readFile('./apps/web/public/data/uganda-locations.xlsx');

wb.SheetNames.forEach(sheetName => {
  const data = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
  data.forEach((row, idx) => {
    const str = JSON.stringify(row).toUpperCase();
    if (str.includes("KIREKA")) {
       console.log(`[Sheet: ${sheetName} | Row ${idx}]:`, JSON.stringify(row));
    }
  });
});

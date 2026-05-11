import { execSync } from 'node:child_process';
import fs from 'node:fs';

const sheets = [
  'Kampala',
  'Central Region',
  'Eastern Region',
  'Western Region',
  'Mid-Western District',
  'West Nile',
  'Northern Region',
  'North Eastern Region'
];

const finalRecords = [];

function normalizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/\uFEFF/g, '').trim();
}

for (const sheet of sheets) {
  console.log(`Processing sheet: ${sheet}`);
  
  const cmd = `npx -y xlsx-cli apps/web/public/data/uganda-locations.xlsx --sheet "${sheet}" --json`;
  const stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  
  const jsonStartIndex = stdout.indexOf('[');
  if (jsonStartIndex === -1) {
    console.warn(`No JSON array in stdout for ${sheet}`);
    continue;
  }
  const rawRows = JSON.parse(stdout.slice(jsonStartIndex));
  
  let currentDistrict = '';
  let currentCounty = '';
  let currentSubcounty = '';
  
  // Explicitly map per sheet to prevent drifting columns if headers missing
  let countyKey = null;
  let subcountyKey = null;
  let parishKey = null;
  let postcodeKey = null;

  for (const row of rawRows) {
    const keys = Object.keys(row);
    if (keys.length === 0) continue;
    
    // Read values robustly
    const firstKey = keys[0];
    const firstVal = normalizeText(row[firstKey]);
    
    // 1. Handle District Header reset
    if (firstVal.toUpperCase().includes('DISTRICT')) {
       const match = firstVal.match(/([A-Za-z\s]+) DISTRICT/i);
       if (match) {
         currentDistrict = match[1].trim();
         currentCounty = '';
         currentSubcounty = '';
       }
       continue;
    }
    
    // 2. Search for dynamic column mapping dynamically based on value matching
    const isRowWithHeaders = keys.some(k => normalizeText(row[k]).toLowerCase().includes('postcode'));
    if (isRowWithHeaders) {
      countyKey = keys.find(k => /County|Municipality/i.test(normalizeText(row[k])));
      subcountyKey = keys.find(k => /Sub/i.test(normalizeText(row[k])));
      parishKey = keys.find(k => /Parish|Ward/i.test(normalizeText(row[k])));
      postcodeKey = keys.find(k => /Postcode/i.test(normalizeText(row[k])));
      continue;
    }
    
    // 3. Kampala edge-case logic
    if (sheet === 'Kampala') {
       currentDistrict = 'KAMPALA';
       // {"__EMPTY":1,"Kampal District":"CENTRAL","__EMPTY_1":"Civic Centre","__EMPTY_2":10101}
       const maybeDiv = normalizeText(row['Kampal District']);
       if (maybeDiv && isNaN(maybeDiv) && ['CENTRAL','KAWEMPE','NAKAWA','MAKINDYE','RUBAGA'].includes(maybeDiv.toUpperCase())) {
          currentSubcounty = maybeDiv.toUpperCase();
       }
       
       const pCode = keys.map(k => normalizeText(row[k])).find(v => /^\d{5}$/.test(v));
       if (pCode) {
          let parVal = normalizeText(row['__EMPTY_1']);
          if(!parVal || /^\d+$/.test(parVal)) {
             parVal = normalizeText(row['Kampal District']); // Sometimes shifts
          }
          // If we have a non-numeric text identifier, trust it - headers were already bypassed by the /^\d{5}$/ pCode check above
          if (parVal && !/^\d+$/.test(parVal)) {
             finalRecords.push({
                district: 'KAMPALA',
                county: 'KAMPALA',
                subcounty: currentSubcounty || 'KAMPALA',
                parish: parVal,
                postcode: pCode,
                region: 'Central Region'
             });
          }
       }
       continue;
    }
    
    // 4. Standard Regions parsing
    // Find if this row has a valid 5-digit Postcode
    const foundPostcode = keys.map(k => normalizeText(row[k])).find(v => /^\d{5}$/.test(v));
    if (!foundPostcode) {
       // Diagnostic: capture if a 5-digit sequence got munged, say padded spaces or floating point
       const maybePostcode = keys.map(k => normalizeText(row[k])).find(v => /\b[1-9]\d{4}\b/.test(v));
       if (maybePostcode) console.warn(`[SKIPPED-WEIRD] Potentially missed postcode formatting: "${maybePostcode}" in row keys: ${JSON.stringify(row)}`);
       continue;
    }
    
    // Acknowledge location hierarchy cascade values if defined
    const kCounty = countyKey || '__EMPTY';
    const kSub = subcountyKey || '__EMPTY_1';
    const kParish = parishKey || '__EMPTY_2';
    
    const valCounty = normalizeText(row[kCounty]);
    if (valCounty && isNaN(valCounty) && valCounty.length > 2 && !/^\d+$/.test(valCounty)) {
      currentCounty = valCounty;
    }
    
    const valSub = normalizeText(row[kSub]);
    if (valSub && isNaN(valSub) && valSub.length > 2 && !/^\d+$/.test(valSub)) {
      currentSubcounty = valSub;
    }
    
    let valParish = normalizeText(row[kParish]);
    // Fallback: extract best remaining text column if parish value came out garbage
    if (!valParish || valParish.length < 2 || /^\d+$/.test(valParish)) {
       const fallbacks = keys.map(k => normalizeText(row[k])).filter(v => 
         v && v.length > 2 && !/^\d+$/.test(v) && v !== currentCounty && v !== currentSubcounty && v !== foundPostcode
       );
       if (fallbacks.length > 0) valParish = fallbacks[0];
    }
    
    if (!valParish || valParish.toLowerCase() === 'parish') {
      console.warn(`[REJECT] Sheet: ${sheet}, Row skipped due to no parish. Postcode: ${foundPostcode}. County: ${currentCounty}, Sub: ${currentSubcounty}`);
      continue;
    }

    let finalRegion = sheet;
    if (sheet === 'Kampala') finalRegion = 'Central Region';
    if (sheet === 'Mid-Western District') finalRegion = 'Western Region';

    finalRecords.push({
      district: currentDistrict,
      county: currentCounty,
      subcounty: currentSubcounty,
      parish: valParish,
      postcode: foundPostcode,
      region: finalRegion
    });
  }
}

console.log(`Success! Loaded ${finalRecords.length} interim records.`);

// Global Cascade fix logic:
let districtCascade = 'KAMPALA';
const validOutput = [];
for (const r of finalRecords) {
  if (r.district) districtCascade = r.district.toUpperCase().replace(/\s*DISTRICT.*/, '').trim();
  
  const entry = {
    r: (r.region || 'UGANDA').toUpperCase(),
    d: districtCascade,
    c: (r.county || districtCascade).toUpperCase(),
    s: (r.subcounty || 'UNKNOWN').toUpperCase(),
    p: r.parish.toUpperCase(),
    code: r.postcode
  };
  
  // Basic truth gating - reduced minimum length to 2 for legitimate names like 'Ha'
  if (entry.p.length >= 2 && entry.p !== 'NAME' && entry.p !== 'PARISH') {
    validOutput.push(entry);
  } else {
    console.warn(`[POST-REJECT] Drop due to format: ${JSON.stringify(r)}`);
  }
}

fs.writeFileSync('apps/web/public/data/uganda-locations-final.json', JSON.stringify(validOutput, null, 2));
console.log(`Saved ${validOutput.length} fully normalized rows to final json.`);

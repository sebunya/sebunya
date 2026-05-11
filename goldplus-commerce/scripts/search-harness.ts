import { searchLocations } from '../apps/web/src/lib/location-search.ts';
import fs from 'fs';

const dataset = JSON.parse(fs.readFileSync('./apps/web/public/data/uganda-locations-final.json', 'utf8'));

const testQueries = [
  "Kireka",
  "Kireka 30223",
  "30223",
  "Kamwokya",
  "Kamwokya I",
  "10109",
  "Ntinda",
  "Wakiso",
  "Kampala",
  "Central",
  "Kira",
  "Mukono",
  "Jinja",
  "Luweero",
  "Luwero",
  "Ntugamo",
  "Nakapiripit"
];

console.log("Starting Search Quality Forensic Test...\n");

testQueries.forEach(q => {
  console.log(`QUERY: "${q}"`);
  const res = searchLocations(q, dataset, 5);
  if (res.length === 0) {
     console.log("  [NO RESULTS FOUND]");
  } else {
     res.forEach((r, idx) => {
       console.log(`  ${idx+1}. [Score: ${r.score}] ${r.selection.displayLabel} (${r.selection.region})`);
     });
  }
  console.log("-".repeat(50));
});

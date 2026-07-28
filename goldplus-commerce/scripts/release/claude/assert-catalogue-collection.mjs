#!/usr/bin/env node
/**
 * Asserts the public catalogue collection is at `data`.
 * A monitor that parsed `data.items` caused the production zero-products
 * incident, so that shape is rejected explicitly.
 */
let raw = '';
process.stdin.on('data', (d) => (raw += d)).on('end', () => {
  let body;
  try { body = JSON.parse(raw); } catch { console.error('CATALOGUE_RESPONSE_MALFORMED'); process.exit(1); }
  if (body === null || typeof body !== 'object') { console.error('CATALOGUE_RESPONSE_MALFORMED'); process.exit(1); }
  if (!('data' in body)) { console.error('CATALOGUE_COLLECTION_MISSING'); process.exit(1); }
  if (!Array.isArray(body.data)) {
    const hint = body.data && typeof body.data === 'object' && 'items' in body.data ? ' (found data.items)' : '';
    console.error(`CATALOGUE_COLLECTION_MALFORMED${hint}`);
    process.exit(1);
  }
  console.log(`catalogue collection at data (${body.data.length})`);
});

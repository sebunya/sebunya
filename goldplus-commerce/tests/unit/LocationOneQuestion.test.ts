import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('checkout location: one question, answered the easiest way first (2026-10-16)', () => {
  const picker = read('apps/web/src/components/UgandaLocationPicker.astro');
  const client = read('apps/web/src/lib/locationPickerClient.ts');
  const routes = read('apps/api/src/interfaces/http/routes/locations.ts');

  it('offers the phone location inside the search box, not in a separate pin section', () => {
    expect(picker).toMatch(/js-pin-gps absolute/);
    expect(picker).not.toMatch(/js-pin-section/);
  });

  it('folds the district list, the pasted link and written directions behind one "Can\'t find your area?"', () => {
    const details = picker.slice(picker.indexOf('<details class="js-fallbacks'), picker.indexOf('</details>'));
    for (const hook of ['js-district-select', 'js-pin-link', 'js-manual-text', 'js-manual-commit']) expect(details).toContain(hook);
  });

  it('a pin offers the nearest areas to choose from, and never decides alone', () => {
    expect(client).toMatch(/\/locations\/near\?lat=/);
    expect(routes).toMatch(/routes\.get\('\/near'/);
    expect(routes).toMatch(/nearestAreas\(/);
    // The pin is never echoed back from the endpoint.
    const near = routes.slice(routes.indexOf("routes.get('/near'"), routes.indexOf("routes.post('/search-events'"));
    expect(near).not.toMatch(/data: \{[^}]*lat/);
  });

  it('after Locate me nothing is chosen for the customer', () => {
    const after = client.slice(client.indexOf('async function afterPin'), client.indexOf("pinGps?.addEventListener('click'"));
    expect(after).not.toMatch(/\bcommit\(/);
    expect(after).toMatch(/renderResults\(current\)/);
  });

  it('changing the place drops the old pin', () => {
    const change = client.slice(client.indexOf("changeBtn?.addEventListener('click'"));
    expect(change).toMatch(/pin = null/);
  });

  it('says why an alias matched, and puts the metro namesake first', () => {
    expect(client).toMatch(/includes \$\{opt\.matchedAs\}/);
    expect(client).toMatch(/isMetro === true \? 0 : 1/);
  });
});

describe('a customer we know confirms who is buying in one line (2026-10-16)', () => {
  const checkout = read('apps/web/src/pages/checkout.astro');

  it('collapses name, email and phone into a summary only on a clean first view with name and phone known', () => {
    expect(checkout).toMatch(/const whoSummary =\s*Astro\.request\.method !== 'POST' && Boolean\(values\.name\?\.trim\(\)\) && Boolean\(values\.phone\?\.trim\(\)\)/);
    expect(checkout).toMatch(/!errors\.name && !errors\.phone && !errors\.email/);
  });

  it('hides only the three contact fields, never the delivery section', () => {
    const start = checkout.indexOf('<div id="who-fields"');
    const block = checkout.slice(start, checkout.indexOf('</div>', start));
    expect(block).toContain('id="name"');
    expect(block).toContain('id="phone"');
    expect(block).not.toContain('UgandaLocationPicker');
  });

  it('"Buying for someone else?" empties name and phone for the recipient; Edit keeps them', () => {
    expect(checkout).toMatch(/who-someone-else[\s\S]*for \(const id of \['name', 'phone'\]\)/);
    expect(checkout).toMatch(/who-edit'\)\?\.addEventListener\('click', \(\) => open\('name'\)\)/);
  });

  it('a signed-in customer without a saved address still gets their account phone', () => {
    expect(checkout).toMatch(/phone: defaultAddress\?\.phone \|\| accountPhone \|\| guestPrefill\.phone/);
  });
});

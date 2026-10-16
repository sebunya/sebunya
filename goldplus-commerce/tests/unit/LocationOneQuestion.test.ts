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

  it('a pin alone names the area through the quote\'s own nearest-area rule, and invents nothing', () => {
    expect(client).toMatch(/\/locations\/near\?lat=/);
    expect(routes).toMatch(/routes\.get\('\/near'/);
    expect(routes).toMatch(/resolved\.via === 'pin'/);
    // The pin is never echoed back from the endpoint.
    const near = routes.slice(routes.indexOf("routes.get('/near'"), routes.indexOf("routes.post('/search-events'"));
    expect(near).not.toMatch(/data: \{[^}]*lat/);
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

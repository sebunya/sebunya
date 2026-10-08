import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV_CONFIG } from '@goldplus/shared';

/**
 * Menu tile descriptions say only what the listings say (2026-10-08). The
 * header markup and the shared default config carried claims no product backed:
 * car Bluetooth (none stocked), "wired and wireless" mice (the listings say
 * neither), chargers "built for Kampala potholes", "studio" sound cards.
 */

const nav = readFileSync(resolve(__dirname, '../../apps/web/src/components/GpNav.astro'), 'utf8');
const config = JSON.stringify(DEFAULT_NAV_CONFIG);

const RETIRED = [
  'Chargers and Bluetooth',
  'Bluetooth for cars',
  'Over-ear headphones',
  'Kampala potholes',
  'Wired and wireless',
  'External audio for laptops and studios',
  'On-ear, for everyday listening',
  'How we verify stock',
];

describe('menu copy matches the stock', () => {
  it.each(RETIRED)('neither the header nor the default config says "%s"', (phrase) => {
    expect(nav).not.toContain(phrase);
    expect(config).not.toContain(phrase);
  });

  it('the tiles describe what the listings say', () => {
    for (const phrase of ['Car chargers', 'Charge on the road from the 12V socket', 'For desktop and laptop', 'Headphone and mic jacks over USB', 'Flash drives and memory cards', 'Verify a product']) {
      expect(nav, phrase).toContain(phrase);
      expect(config, phrase).toContain(phrase);
    }
  });

  it('the card-reader link looks like a link', () => {
    expect(nav).toContain('.gp-nav__note a{color:var(--gpn-green);font-weight:500;}');
  });
});

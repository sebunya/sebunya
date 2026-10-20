import { describe, expect, it } from 'vitest';
import { findChargers, matchCharger, parseFinderQuery } from '../../apps/web/src/lib/chargerFinder';

const spec = (name: string, value: string, unit: string | null = null) => ({ name, value, unit, isVerified: true });
const p = (id: string, name: string, attrs: ReturnType<typeof spec>[], price = 30_000, categoryName = 'Power Devices') =>
  ({ id, slug: id, name, categoryName, retailPriceUgx: price, attributeValues: attrs }) as never;

const c12 = p('c12', 'GoldPlus GP-C12 GaN USB-C Fast Charger', [spec('Ports', 'USB-C'), spec('In the box', 'Charger, USB-C to Lightning cable'), spec('Output power', '20', 'W')]);
const c13 = p('c13', 'GoldPlus GP-C13 GaN USB-C Fast Charger', [spec('Ports', 'USB-C'), spec('In the box', 'Charger, USB-C to USB-C cable'), spec('Output power', '20', 'W')]);
const c08 = p('c08', 'GoldPlus GP-C08 12W USB Fast Charger', [spec('Ports', 'USB-A'), spec('Output power', '12', 'W')]);
const gan = p('gan', 'GoldPlus GP-GAN01 65W GaN Fast Charger', [spec('Ports', 'Built-in retractable USB-C cable + USB-A + USB-C'), spec('Output power', '65', 'W')], 120_000);
const ca01 = p('ca01', 'GoldPlus GP-CA01 65W Fast Charging Car Charger', [spec('Ports', 'USB-C (PD 30W) + USB-A (QC 4.0)'), spec('Output power', '65', 'W')], 60_000, 'Car Accessories');
const microCable = p('m02', 'GoldPlus GP-M02 Micro-USB (V8) Fast Charging Cable', [spec('Connector', 'USB-A to Micro-USB')]);
const usbcCable = p('pd04', 'GoldPlus GP-PD04 USB-C to USB-C 66W Flat Fast Charging Cable', [spec('Connector', 'USB-C to USB-C'), spec('Output power', '66', 'W')]);
const noSpec = p('ca03', 'GoldPlus GP-CA03 Car Charger', [spec('Type', 'Car charger (12/24V socket)')], 20_000, 'Car Accessories');

describe('charger and cable finder (gap #12)', () => {
  it('an iPhone gets the charger with the Lightning cable in the box first; the USB-C cable box is not "for iPhone"', () => {
    const r = findChargers([c13, c12, c08], { device: 'phone', port: 'lightning', need: 'wall', watts: null });
    expect(r[0].product.id).toBe('c12');
    expect(r[0].reasons[0]).toBe('In the box: Charger, USB-C to Lightning cable');
    expect(r.find((m) => m.product.id === 'c13')!.caveat).toBe('Use it with a USB-C to Lightning cable (not in the box).');
    expect(r.find((m) => m.product.id === 'c08')!.caveat).toBe('Use it with a USB-A to Lightning cable (not in the box).');
  });

  it('a cable fits by its device end', () => {
    expect(matchCharger(microCable, { device: 'phone', port: 'micro-usb', need: 'cable', watts: null })).not.toBeNull();
    expect(matchCharger(microCable, { device: 'phone', port: 'usb-c', need: 'cable', watts: null })).toBeNull();
  });

  it('a laptop needs USB-C with enough checked watts; a per-port figure beats the total', () => {
    const r = findChargers([gan, c13, c08], { device: 'laptop', port: 'usb-c', need: 'wall', watts: 45 });
    expect(r.map((m) => m.product.id)).toEqual(['gan']);
    expect(r[0].caveat).toContain('not on our checked specification');
    // 65 W car charger, but its USB-C port is 30 W: not for a 45 W laptop.
    expect(matchCharger(ca01, { device: 'laptop', port: 'usb-c', need: 'car', watts: 45 })).toBeNull();
    expect(matchCharger(usbcCable, { device: 'laptop', port: 'usb-c', need: 'cable', watts: 65 })!.watts).toBe(66);
  });

  it('a product with nothing checked about ports is left out, never guessed in', () => {
    expect(matchCharger(noSpec, { device: 'phone', port: 'usb-c', need: 'car', watts: null })).toBeNull();
  });

  it('reads only known answers from the URL; a laptop is always USB-C', () => {
    expect(parseFinderQuery(new URLSearchParams('device=laptop&port=lightning&need=wall&watts=65'))).toEqual({ device: 'laptop', port: 'usb-c', need: 'wall', watts: 65 });
    expect(parseFinderQuery(new URLSearchParams('device=phone&port=x&need=wall'))).toBeNull();
  });
});

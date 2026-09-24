import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../../apps/web/src/components/product-finder/ProductFinderShell.astro'), 'utf8');

describe('product finder keyboard and screen-reader use', () => {
  it('choosing an option does not rebuild the radios (focus stays on the group)', () => {
    const handler = src.slice(src.indexOf("input.addEventListener('change'"), src.indexOf("label.append(input"));
    expect(handler).toContain('answers[q.id] = option');
    expect(handler).not.toMatch(/renderQuestion\(\)/);
  });

  it('the question is the radio group legend', () => {
    expect(src).toMatch(/createElement\('fieldset'\)/);
    expect(src).toMatch(/text\('legend', q\.title/);
  });

  it('the green buttons carry dark text', () => {
    for (const id of ['pf-next', 'pf-submit']) {
      const tag = src.slice(src.indexOf(`id="${id}"`), src.indexOf('>', src.indexOf(`id="${id}"`)));
      expect(tag, id).toContain('text-brand-black');
      expect(tag, id).not.toContain('text-white');
    }
  });
});

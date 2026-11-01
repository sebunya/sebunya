import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const nav = readFileSync(join(__dirname, '../../apps/web/src/components/GpNav.astro'), 'utf8');

describe('header mini-cart', () => {
  it('the same-day line is running text, not a flex row that splits every word group into a column', () => {
    const rule = nav.slice(nav.indexOf('.gp-nav__mini-cut{'), nav.indexOf('}', nav.indexOf('.gp-nav__mini-cut{')));
    expect(rule).toContain('display:block');
    expect(rule).not.toMatch(/display:\s*flex/);
  });
  it('each line shows the product photo when the catalogue has one, looked up by id with a short timeout', () => {
    expect(nav).toMatch(/\{it\.imageUrl && <img src=\{it\.imageUrl\}/);
    expect(nav).toContain('/products?ids=${batch.join');
    expect(nav).toContain('AbortSignal.timeout(1500)');
  });
});

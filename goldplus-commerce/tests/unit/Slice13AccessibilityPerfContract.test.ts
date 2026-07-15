import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');
const layout = read('apps/web/src/layouts/BaseLayout.astro');

const discover = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? discover(path) : [path];
  }).filter((p) => p.endsWith('.astro'));

describe('Slice 13 accessibility & performance static contract', () => {
  it('declares the document language and a zoom-friendly viewport', () => {
    expect(layout).toContain('<html lang="en-UG">');
    expect(layout).toContain('width=device-width, initial-scale=1.0');
    expect(layout).not.toMatch(/user-scalable\s*=\s*no|maximum-scale=1(\.0)?\b/);
  });

  it('provides a focus-visible skip link with a landing target on every page', () => {
    expect(layout).toContain('href="#main"');
    expect(layout).toContain('Skip to content');
    expect(layout).toContain('id="main" tabindex="-1"');
  });

  it('honours prefers-reduced-motion globally', () => {
    expect(read('apps/web/src/styles/global.css')).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps product imagery lazy and described', () => {
    const card = read('apps/web/src/components/ProductCard.astro');
    expect(card).toContain('loading="lazy"');
    expect(card).toMatch(/alt=\{/);
  });

  it('never disables zoom or injects fixed-width viewports in any page', () => {
    for (const page of discover(resolve(root, 'apps/web/src/pages'))) {
      const source = readFileSync(page, 'utf8');
      expect(source, `${relative(root, page)} must not disable zoom`).not.toMatch(/user-scalable\s*=\s*no/);
    }
  });
});

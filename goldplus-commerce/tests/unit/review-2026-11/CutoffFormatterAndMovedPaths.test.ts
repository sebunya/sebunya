import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatCutoffHour, cutoffPhrase } from '../../../apps/web/src/lib/businessInfo';

const web = (p: string) => join(__dirname, '../../../apps/web/src', p);

describe('one cut-off formatter', () => {
  it('formats valid hours and refuses junk', () => {
    expect(formatCutoffHour(15)).toBe('3pm');
    expect(formatCutoffHour(0)).toBe('12am');
    expect(formatCutoffHour(12)).toBe('12pm');
    expect(formatCutoffHour(9)).toBe('9am');
    expect(formatCutoffHour(Number.NaN)).toBeNull();
    expect(formatCutoffHour(24)).toBeNull();
    expect(cutoffPhrase(Number.NaN)).toBe('the daily cut-off');
  });
  it('no page keeps its own copy', () => {
    for (const f of ['lib/agentDocuments.ts', 'pages/llms.txt.ts', 'pages/faq.astro', 'pages/phone-batteries/[device].astro', 'pages/delivery/kampala-wakiso.astro']) {
      expect(readFileSync(web(f), 'utf8'), f).not.toMatch(/% 12/);
    }
  });
});

describe('/locations lives in MOVED_PATHS', () => {
  it('the redirect page is gone and the middleware carries it with a one-day cache', () => {
    expect(existsSync(web('pages/locations/index.astro'))).toBe(false);
    const mw = readFileSync(web('middleware.ts'), 'utf8');
    expect(mw).toMatch(/'\/locations': '\/locations\/zainab-aziza'/);
    expect(mw).toMatch(/res\.headers\.set\('Cache-Control', 'public, max-age=86400'\)/);
  });
});

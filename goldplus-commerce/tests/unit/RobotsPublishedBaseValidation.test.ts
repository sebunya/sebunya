import { describe, expect, it } from 'vitest';
import { safeRobotsBase, fallbackRobotsTxt } from '../../apps/api/src/application/use-cases/seo-growth/RobotsGovernanceUseCases';

describe('/seo/robots-published base parameter', () => {
  it('keeps an http(s) origin and drops path/query', () => {
    expect(safeRobotsBase('https://shopgoldplus.com')).toBe('https://shopgoldplus.com');
    expect(safeRobotsBase('http://localhost:4321/x?y=1')).toBe('http://localhost:4321');
  });
  it('refuses injection and odd schemes', () => {
    for (const bad of ['https://a.com\nDisallow: /', 'javascript:alert(1)', 'not a url', 'https://u:p@a.com', 'x'.repeat(300)]) {
      expect(safeRobotsBase(bad), bad).toBe('https://shopgoldplus.com');
    }
    expect(fallbackRobotsTxt(safeRobotsBase('https://a.com\r\nDisallow: /'))).not.toMatch(/^Disallow: \/$/m);
  });
});

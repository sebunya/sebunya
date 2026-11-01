import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CampaignReadinessScorer } from '../../apps/api/src/domain/advertising/CampaignReadinessScorer';
import { RecomputeCampaignReadinessUseCase } from '../../apps/api/src/application/use-cases/campaigns/RecomputeCampaignReadinessUseCase';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('CampaignReadinessScorer', () => {
  const scorer = new CampaignReadinessScorer();
  it('scores a complete campaign 100', () => {
    expect(scorer.score({ name: 'A', objective: 'SALES', channel: 'EMAIL', targetUrl: 'https://shopgoldplus.com/x', utmLinkCount: 1 }))
      .toEqual({ score: 100, missing: [] });
  });
  it('lists what is missing and never goes below 0', () => {
    const r = scorer.score({ name: '', objective: null, channel: undefined, targetUrl: 'https://evil.example', utmLinkCount: 0 });
    expect(r.score).toBe(0);
    expect(r.missing).toEqual(['name', 'objective', 'channel', 'targetUrl', 'utmLink']);
  });
  it('a draft without URL or UTM link scores 30', () => {
    expect(scorer.score({ name: 'A', objective: 'B', channel: 'C', targetUrl: null, utmLinkCount: 0 }).score).toBe(30);
  });
});

describe('RecomputeCampaignReadinessUseCase', () => {
  it('stores the computed score', async () => {
    const saved: Array<[string, number]> = [];
    const repo = {
      findById: async (id: string) => ({ id, name: 'A', objective: 'B', channel: 'C', targetUrl: 'https://shopgoldplus.com/' }),
      countUtmLinks: async () => 2,
      setReadinessScore: async (id: string, score: number) => { saved.push([id, score]); },
    };
    const r = await new RecomputeCampaignReadinessUseCase(repo).execute('c1');
    expect(r?.score).toBe(100);
    expect(saved).toEqual([['c1', 100]]);
  });
  it('returns null for an unknown campaign and writes nothing', async () => {
    let writes = 0;
    const repo = { findById: async () => null, countUtmLinks: async () => 0, setReadinessScore: async () => { writes++; } };
    expect(await new RecomputeCampaignReadinessUseCase(repo).execute('x')).toBeNull();
    expect(writes).toBe(0);
  });
});

describe('campaign readiness wiring', () => {
  const route = read('apps/api/src/interfaces/http/routes/admin/campaigns.ts');
  it('recomputes on create and on UTM link add', () => {
    expect(route.match(/new RecomputeCampaignReadinessUseCase\(registry\.campaignRepo\)\.execute/g)?.length).toBe(2);
  });
  it('the repository implements the port methods', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleCampaignRepository.ts');
    expect(repo).toContain('async countUtmLinks(');
    expect(repo).toContain('readinessScore: score');
  });
  it('the admin campaigns page shows the score', () => {
    expect(read('apps/web/src/pages/admin/campaigns/index.astro')).toContain('Readiness {Number(cmp.readinessScore ?? 0)}/100');
  });
});

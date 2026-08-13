import { describe, expect, it } from 'vitest';
import {
  extractSeoFacts,
  compareSeoFacts,
  verdictForRenderState,
  describeRenderState,
  normaliseDiffUrl,
  NotConfiguredSeoPageRenderer,
  RunRenderDiffUseCase,
  type RenderDiffRecord,
  type SeoPageRenderer,
  type RawSeoFetcher,
} from '../../apps/api/src/application/use-cases/seo-growth/RenderDiffUseCases';

/**
 * Raw vs rendered (0120). The load-bearing assertion in this file is that a
 * page which was never rendered reports UNKNOWN — never "no difference found".
 */

const RAW_HTML = `<!doctype html><html><head>
  <title>Phone Batteries in Kampala | GoldPlus</title>
  <meta name="description" content="Replacement batteries, tested." />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="https://www.shopgoldplus.com/batteries" />
  <script type="application/ld+json">{"@type":"ItemList"}</script>
</head><body>
  <h1>Phone batteries</h1>
  <p>We stock tested replacement batteries for common models.</p>
  <a href="/batteries/samsung">Samsung</a>
  <a href="/batteries/tecno">Tecno</a>
</body></html>`;

const SPA_SHELL = `<!doctype html><html><head></head><body><div id="root"></div>
  <script>window.hydrate()</script></body></html>`;

const SPA_RENDERED = `<!doctype html><html><head>
  <title>Phone Batteries in Kampala | GoldPlus</title>
  <link rel="canonical" href="https://www.shopgoldplus.com/batteries" />
  <meta name="robots" content="index,follow" />
</head><body><h1>Phone batteries</h1>
  <a href="/a">a</a><a href="/b">b</a></body></html>`;

describe('extractSeoFacts (pure, no network or browser)', () => {
  it('pulls every SEO-relevant fact out of raw HTML', () => {
    const facts = extractSeoFacts(RAW_HTML);
    expect(facts.title).toBe('Phone Batteries in Kampala | GoldPlus');
    expect(facts.metaDescription).toBe('Replacement batteries, tested.');
    expect(facts.metaRobots).toBe('index,follow');
    expect(facts.canonical).toBe('https://www.shopgoldplus.com/batteries');
    expect(facts.h1).toBe('Phone batteries');
    expect(facts.linkCount).toBe(2);
    expect(facts.jsonLdCount).toBe(1);
    expect(facts.wordCount).toBeGreaterThan(8);
  });

  it('excludes script and style content from the word count', () => {
    const withScript = extractSeoFacts('<html><body><p>one two</p><script>var a = "three four five";</script></body></html>');
    expect(withScript.wordCount).toBe(2);
  });

  it('returns nulls rather than guesses when facts are absent', () => {
    const facts = extractSeoFacts(SPA_SHELL);
    expect(facts.title).toBeNull();
    expect(facts.canonical).toBeNull();
    expect(facts.metaRobots).toBeNull();
    expect(facts.h1).toBeNull();
    expect(facts.jsonLdCount).toBe(0);
  });

  it('does not count anchors without an href as links', () => {
    expect(extractSeoFacts('<a name="x">x</a><a href="/y">y</a>').linkCount).toBe(1);
  });
});

describe('compareSeoFacts (pure)', () => {
  it('reports NONE and no differences for identical documents', () => {
    const facts = extractSeoFacts(RAW_HTML);
    const verdict = compareSeoFacts(facts, facts);
    expect(verdict.differences).toEqual([]);
    expect(verdict.severity).toBe('NONE');
  });

  it('marks title, canonical and meta robots that appear only after rendering as CRITICAL', () => {
    const verdict = compareSeoFacts(extractSeoFacts(SPA_SHELL), extractSeoFacts(SPA_RENDERED));
    expect(verdict.severity).toBe('CRITICAL');
    const critical = verdict.differences.filter((d) => d.severity === 'CRITICAL').map((d) => d.field).sort();
    expect(critical).toEqual(['canonical', 'metaRobots', 'title']);
  });

  it('warns on a large word-count gap and a large link-count gap', () => {
    const raw = { ...extractSeoFacts(RAW_HTML), wordCount: 10, linkCount: 1 };
    const rendered = { ...raw, wordCount: 400, linkCount: 60 };
    const verdict = compareSeoFacts(raw, rendered);
    expect(verdict.differences.find((d) => d.field === 'wordCount')?.severity).toBe('WARNING');
    expect(verdict.differences.find((d) => d.field === 'linkCount')?.severity).toBe('WARNING');
    expect(verdict.severity).toBe('WARNING');
  });

  it('treats a small difference as INFO', () => {
    const raw = extractSeoFacts(RAW_HTML);
    const rendered = { ...raw, wordCount: raw.wordCount + 3 };
    const verdict = compareSeoFacts(raw, rendered);
    expect(verdict.severity).toBe('INFO');
  });

  it('flags a changed critical field (present in both views) as WARNING, not CRITICAL', () => {
    const raw = extractSeoFacts(RAW_HTML);
    const rendered = { ...raw, title: 'A different title' };
    const verdict = compareSeoFacts(raw, rendered);
    expect(verdict.differences[0]).toMatchObject({ field: 'title', severity: 'WARNING' });
  });
});

describe('a page that was not rendered is never reported as "no difference"', () => {
  it('forces severity UNKNOWN for every non-RENDERED state', () => {
    for (const state of ['NOT_ATTEMPTED', 'RENDER_FAILED', 'FETCH_FAILED'] as const) {
      const verdict = verdictForRenderState(state, { differences: [], severity: 'NONE' });
      expect(verdict.severity).toBe('UNKNOWN');
      expect(verdict.differences).toEqual([]);
    }
    expect(verdictForRenderState('RENDERED', { differences: [], severity: 'NONE' }).severity).toBe('NONE');
  });

  it('describes NOT_ATTEMPTED explicitly as not a finding of no difference', () => {
    const note = describeRenderState('NOT_ATTEMPTED');
    expect(note).toMatch(/not attempted/i);
    expect(note).toMatch(/NOT a finding of "no difference"/i);
  });
});

describe('normaliseDiffUrl', () => {
  it('accepts absolute http(s) and rejects everything else', () => {
    expect(normaliseDiffUrl('https://www.shopgoldplus.com/x')).toBe('https://www.shopgoldplus.com/x');
    expect(normaliseDiffUrl('file:///etc/passwd')).toBeNull();
    expect(normaliseDiffUrl('/relative')).toBeNull();
    expect(normaliseDiffUrl('')).toBeNull();
  });
});

describe('NotConfiguredSeoPageRenderer', () => {
  it('refuses honestly instead of returning the raw HTML as if rendered', async () => {
    const result = await new NotConfiguredSeoPageRenderer().render('https://www.shopgoldplus.com/');
    expect(result.rendered).toBe(false);
    if (!result.rendered) {
      expect(result.state).toBe('NOT_ATTEMPTED');
      expect(result.reason).toMatch(/no rendering engine is configured/i);
    }
  });
});

describe('RunRenderDiffUseCase', () => {
  const store = () => {
    const saved: RenderDiffRecord[] = [];
    return {
      saved,
      async saveRenderDiff(record: RenderDiffRecord) { saved.push(record); return { id: 'row-1' }; },
    };
  };
  const fetcherOf = (body: string | null, status = 200): RawSeoFetcher => ({
    async fetchPage() { return { status, body }; },
  });

  it('stores NOT_ATTEMPTED with UNKNOWN severity when no renderer is configured', async () => {
    const s = store();
    const record = await new RunRenderDiffUseCase(fetcherOf(RAW_HTML), new NotConfiguredSeoPageRenderer(), s).execute({
      url: 'https://www.shopgoldplus.com/batteries',
    });
    expect(record.renderState).toBe('NOT_ATTEMPTED');
    expect(record.severity).toBe('UNKNOWN');
    expect(record.severity).not.toBe('NONE');
    expect(record.raw?.title).toBe('Phone Batteries in Kampala | GoldPlus');
    expect(record.rendered).toBeNull();
    expect(s.saved).toHaveLength(1);
  });

  it('records RENDER_FAILED with UNKNOWN severity when the renderer throws', async () => {
    const s = store();
    const throwing: SeoPageRenderer = { async render() { throw new Error('browser crashed'); } };
    const record = await new RunRenderDiffUseCase(fetcherOf(RAW_HTML), throwing, s).execute({
      url: 'https://www.shopgoldplus.com/batteries',
    });
    expect(record.renderState).toBe('RENDER_FAILED');
    expect(record.severity).toBe('UNKNOWN');
    expect(record.error).toMatch(/browser crashed/);
  });

  it('records FETCH_FAILED with UNKNOWN severity when no HTML body comes back', async () => {
    const s = store();
    const record = await new RunRenderDiffUseCase(fetcherOf(null, 500), new NotConfiguredSeoPageRenderer(), s).execute({
      url: 'https://www.shopgoldplus.com/batteries',
    });
    expect(record.renderState).toBe('FETCH_FAILED');
    expect(record.severity).toBe('UNKNOWN');
    expect(record.rawStatus).toBe(500);
  });

  it('produces a CRITICAL verdict when a fake renderer reveals JS-only metadata', async () => {
    const s = store();
    const fake: SeoPageRenderer = { async render() { return { rendered: true, html: SPA_RENDERED }; } };
    const record = await new RunRenderDiffUseCase(fetcherOf(SPA_SHELL), fake, s).execute({
      url: 'https://www.shopgoldplus.com/spa',
    });
    expect(record.renderState).toBe('RENDERED');
    expect(record.severity).toBe('CRITICAL');
    expect(record.differences.some((d) => d.field === 'title' && d.severity === 'CRITICAL')).toBe(true);
  });

  it('refuses a non-absolute URL rather than storing a fabricated row', async () => {
    const s = store();
    await expect(
      new RunRenderDiffUseCase(fetcherOf(RAW_HTML), new NotConfiguredSeoPageRenderer(), s).execute({ url: '/relative' }),
    ).rejects.toThrow(/absolute http/i);
    expect(s.saved).toHaveLength(0);
  });
});

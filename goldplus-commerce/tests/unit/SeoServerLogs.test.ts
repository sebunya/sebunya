import { describe, expect, it } from 'vitest';
import {
  parseAccessLogLine,
  parseLogTimestamp,
  parseAccessLog,
  identifyCrawler,
  decideVerification,
  verifyHits,
  summariseHits,
  describeCoverage,
  validateIngestInput,
  IngestServerLogUseCase,
  ReverseDnsCrawlerVerifier,
  NotConfiguredCrawlerVerifier,
  KNOWN_CRAWLERS,
  MAX_LOG_BYTES,
  type CrawlerHitCandidate,
  type CrawlerVerifier,
  type DnsResolver,
} from '../../apps/api/src/application/use-cases/seo-growth/ServerLogSeoUseCases';

/**
 * Server-log SEO (0120). The load-bearing assertion: a forged Googlebot
 * user-agent from an unrelated IP must never come back VERIFIED.
 */

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const line = (ip: string, path: string, status: number, ua: string, when = '10/Oct/2025:13:55:36 +0000') =>
  `${ip} - - [${when}] "GET ${path} HTTP/1.1" ${status} 2326 "-" "${ua}"`;

describe('parseAccessLogLine (pure)', () => {
  it('parses a Combined Log Format line', () => {
    const parsed = parseAccessLogLine(line('66.249.66.1', '/batteries?page=2', 200, GOOGLEBOT_UA));
    expect(parsed).not.toBeNull();
    expect(parsed!.ip).toBe('66.249.66.1');
    expect(parsed!.method).toBe('GET');
    expect(parsed!.path).toBe('/batteries');
    expect(parsed!.statusCode).toBe(200);
    expect(parsed!.bytes).toBe(2326);
    expect(parsed!.userAgent).toBe(GOOGLEBOT_UA);
    expect(parsed!.hitAt.toISOString()).toBe('2025-10-10T13:55:36.000Z');
  });

  it('parses a Common Log Format line (no referrer/user-agent fields)', () => {
    const parsed = parseAccessLogLine('127.0.0.1 - frank [10/Oct/2025:13:55:36 -0700] "GET /a HTTP/1.0" 200 2326');
    expect(parsed).not.toBeNull();
    expect(parsed!.userAgent).toBeNull();
    expect(parsed!.hitAt.toISOString()).toBe('2025-10-10T20:55:36.000Z');
  });

  it('returns null — never a guess — for malformed lines', () => {
    for (const bad of [
      'this is not a log line',
      '',
      '66.249.66.1 - - [not-a-date] "GET / HTTP/1.1" 200 10 "-" "x"',
      '66.249.66.1 - - [10/Oct/2025:13:55:36 +0000] "GET / HTTP/1.1" 20 10 "-" "x"',
      '66.249.66.1 - - [10/Oct/2025:13:55:36 +0000] "GETTHISNOW" 200 10 "-" "x"',
    ]) {
      expect(parseAccessLogLine(bad)).toBeNull();
    }
  });

  it('rejects a bogus month name in the timestamp', () => {
    expect(parseLogTimestamp('10/Xyz/2025:13:55:36 +0000')).toBeNull();
  });
});

describe('parseAccessLog (pure, bounded)', () => {
  const log = [
    line('66.249.66.1', '/batteries', 200, GOOGLEBOT_UA),
    line('66.249.66.1', '/missing', 404, GOOGLEBOT_UA, '10/Oct/2025:14:00:00 +0000'),
    'garbage line that cannot be parsed',
    line('40.77.167.1', '/storage', 200, 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'),
    line('1.2.3.4', '/', 200, 'Mozilla/5.0 (Macintosh) Safari/605'),
    '',
  ].join('\n');

  it('counts read, parsed and rejected lines honestly', () => {
    const result = parseAccessLog(log);
    expect(result.linesRead).toBe(5);
    expect(result.linesParsed).toBe(4);
    expect(result.linesRejected).toBe(1);
    expect(result.rejections[0].lineNumber).toBe(3);
  });

  it('never silently drops a malformed line', () => {
    const result = parseAccessLog(log);
    expect(result.linesParsed + result.linesRejected).toBe(result.linesRead);
  });

  it('extracts only crawler hits and reports the real time window covered', () => {
    const result = parseAccessLog(log);
    expect(result.hits).toHaveLength(3);
    expect(result.hits.map((h) => h.crawler).sort()).toEqual(['Bingbot', 'Googlebot', 'Googlebot']);
    expect(result.windowStart!.toISOString()).toBe('2025-10-10T13:55:36.000Z');
    expect(result.windowEnd!.toISOString()).toBe('2025-10-10T14:00:00.000Z');
  });

  it('defaults every parsed hit to UNVERIFIED', () => {
    expect(parseAccessLog(log).hits.every((h) => h.verification === 'UNVERIFIED')).toBe(true);
  });

  it('is bounded by maxLines and reports truncation', () => {
    const many = Array.from({ length: 20 }, () => line('66.249.66.1', '/x', 200, GOOGLEBOT_UA)).join('\n');
    const result = parseAccessLog(many, { maxLines: 5 });
    expect(result.truncated).toBe(true);
    expect(result.linesParsed).toBe(5);
  });
});

describe('identifyCrawler', () => {
  it('recognises every supported crawler from its user agent', () => {
    const uas: Record<string, string> = {
      Googlebot: GOOGLEBOT_UA,
      Bingbot: 'compatible; bingbot/2.0',
      DuckDuckBot: 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
      Slurp: 'Mozilla/5.0 (compatible; Yahoo! Slurp)',
      AhrefsBot: 'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
      SemrushBot: 'Mozilla/5.0 (compatible; SemrushBot/7~bl)',
      GPTBot: 'Mozilla/5.0 (compatible; GPTBot/1.0)',
      ClaudeBot: 'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
      PerplexityBot: 'Mozilla/5.0 (compatible; PerplexityBot/1.0)',
      Applebot: 'Mozilla/5.0 (compatible; Applebot/0.1)',
    };
    for (const [crawler, ua] of Object.entries(uas)) expect(identifyCrawler(ua)).toBe(crawler);
    expect(KNOWN_CRAWLERS).toHaveLength(10);
  });

  it('returns null for an ordinary browser', () => {
    expect(identifyCrawler('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBeNull();
    expect(identifyCrawler(null)).toBeNull();
  });
});

describe('verification is separate from the user-agent claim', () => {
  it('VERIFIES only on reverse-DNS suffix plus forward confirmation', () => {
    expect(decideVerification({
      crawler: 'Googlebot', ip: '66.249.66.1',
      reverseHost: 'crawl-66-249-66-1.googlebot.com', forwardIps: ['66.249.66.1'],
    })).toBe('VERIFIED');
  });

  it('does NOT return VERIFIED for a forged Googlebot user-agent from an unrelated IP', async () => {
    const forged: CrawlerHitCandidate = {
      hitAt: new Date('2025-10-10T13:55:36Z'), path: '/batteries', crawler: 'Googlebot',
      ip: '203.0.113.9', statusCode: 200, bytes: 10, userAgent: GOOGLEBOT_UA, verification: 'UNVERIFIED',
    };

    // The IP reverses to something that is not a Google host at all.
    const dns: DnsResolver = {
      async reverse() { return ['host9.spam-vps.example.net']; },
      async resolve() { return ['203.0.113.9']; },
    };
    const [checked] = await verifyHits([forged], new ReverseDnsCrawlerVerifier(dns));
    expect(checked.verification).toBe('SPOOFED');
    expect(checked.verification).not.toBe('VERIFIED');

    // And a host that merely *claims* the suffix but does not forward-confirm.
    const liar: DnsResolver = {
      async reverse() { return ['fake.googlebot.com']; },
      async resolve() { return ['8.8.8.8']; },
    };
    const [checked2] = await verifyHits([forged], new ReverseDnsCrawlerVerifier(liar));
    expect(checked2.verification).toBe('SPOOFED');
  });

  it('records NOT_CHECKED — never VERIFIED — when DNS is unavailable', async () => {
    const broken: DnsResolver = {
      async reverse() { throw new Error('ENOTFOUND'); },
      async resolve() { throw new Error('ENOTFOUND'); },
    };
    expect(decideVerification({ crawler: 'Googlebot', ip: '1.1.1.1', reverseHost: null, forwardIps: null })).toBe('NOT_CHECKED');
    const [hit] = await verifyHits([{
      hitAt: new Date(), path: '/', crawler: 'Googlebot', ip: '1.1.1.1',
      statusCode: 200, bytes: 1, userAgent: GOOGLEBOT_UA, verification: 'UNVERIFIED',
    }], new ReverseDnsCrawlerVerifier(broken));
    expect(hit.verification).toBe('NOT_CHECKED');
  });

  it('leaves hits NOT_CHECKED when no verifier is configured', async () => {
    const [hit] = await verifyHits([{
      hitAt: new Date(), path: '/', crawler: 'Googlebot', ip: '66.249.66.1',
      statusCode: 200, bytes: 1, userAgent: GOOGLEBOT_UA, verification: 'UNVERIFIED',
    }], new NotConfiguredCrawlerVerifier());
    expect(hit.verification).toBe('NOT_CHECKED');
  });

  it('stops upgrading beyond the lookup budget, leaving the rest UNVERIFIED', async () => {
    const always: CrawlerVerifier = { async verify() { return 'VERIFIED'; } };
    const hits: CrawlerHitCandidate[] = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) => ({
      hitAt: new Date(), path: '/', crawler: 'Googlebot', ip,
      statusCode: 200, bytes: 1, userAgent: GOOGLEBOT_UA, verification: 'UNVERIFIED' as const,
    }));
    const out = await verifyHits(hits, always, 2);
    expect(out.map((h) => h.verification)).toEqual(['VERIFIED', 'VERIFIED', 'UNVERIFIED']);
  });
});

describe('reporting', () => {
  it('keeps the verified and unverified split visible in the summary', () => {
    const summary = summariseHits([
      { crawler: 'Googlebot', verification: 'VERIFIED', statusCode: 200 },
      { crawler: 'Googlebot', verification: 'UNVERIFIED', statusCode: 404 },
      { crawler: 'Bingbot', verification: 'SPOOFED', statusCode: 200 },
      { crawler: 'GPTBot', verification: 'NOT_CHECKED', statusCode: 500 },
    ]);
    expect(summary.totalHits).toBe(4);
    expect(summary).toMatchObject({ verified: 1, unverified: 1, spoofed: 1, notChecked: 1 });
    expect(summary.perCrawler[0]).toEqual({ crawler: 'Googlebot', hits: 2, verified: 1 });
    expect(summary.perStatusClass.map((s) => s.statusClass).sort()).toEqual(['2xx', '4xx', '5xx']);
  });

  it('states the real window covered, and says so when nothing parsed', () => {
    expect(describeCoverage('2025-10-10T13:55:36.000Z', '2025-10-11T00:00:00.000Z'))
      .toMatch(/Covers only the ingested log lines between/);
    expect(describeCoverage(null, null)).toMatch(/covers no time period at all/i);
  });
});

describe('validateIngestInput', () => {
  it('requires text, a source name and a supported format, and bounds the payload', () => {
    expect(validateIngestInput({ text: '', sourceName: 'nginx' })).toMatchObject({ ok: false, code: 'EMPTY_LOG' });
    expect(validateIngestInput({ text: 'x', sourceName: '' })).toMatchObject({ ok: false, code: 'SOURCE_REQUIRED' });
    expect(validateIngestInput({ text: 'x', sourceName: 'nginx', format: 'W3C' })).toMatchObject({ ok: false, code: 'BAD_FORMAT' });
    expect(validateIngestInput({ text: 'x'.repeat(MAX_LOG_BYTES + 1), sourceName: 'nginx' }))
      .toMatchObject({ ok: false, code: 'LOG_TOO_LARGE' });
    expect(validateIngestInput({ text: 'x', sourceName: 'nginx' })).toMatchObject({ ok: true, format: 'COMBINED' });
  });
});

describe('IngestServerLogUseCase', () => {
  const makeStore = () => {
    const state: { ingestions: any[]; hits: CrawlerHitCandidate[] } = { ingestions: [], hits: [] };
    return {
      state,
      async recordLogIngestion(input: any) { state.ingestions.push(input); return { id: 'ing-1' }; },
      async insertCrawlerHits(hits: CrawlerHitCandidate[]) { state.hits.push(...hits); return hits.length; },
    };
  };

  it('records the counts and the real window, and never marks hits VERIFIED without a verifier', async () => {
    const store = makeStore();
    const result = await new IngestServerLogUseCase(store, new NotConfiguredCrawlerVerifier()).execute({
      text: [
        line('66.249.66.1', '/batteries', 200, GOOGLEBOT_UA),
        'not a log line at all',
        line('203.0.113.9', '/batteries', 200, GOOGLEBOT_UA, '11/Oct/2025:09:00:00 +0000'),
      ].join('\n'),
      sourceName: 'nginx-access.log',
      format: 'COMBINED',
      actorId: 'admin-1',
    });

    expect(result.linesRead).toBe(3);
    expect(result.linesParsed).toBe(2);
    expect(result.linesRejected).toBe(1);
    expect(result.crawlerHits).toBe(2);
    expect(result.inserted).toBe(2);
    expect(result.summary.verified).toBe(0);
    expect(store.state.hits.every((h) => h.verification !== 'VERIFIED')).toBe(true);
    expect(store.state.ingestions[0]).toMatchObject({
      sourceName: 'nginx-access.log', format: 'COMBINED', linesRead: 3, linesRejected: 1, createdBy: 'admin-1',
    });
    expect(result.windowStart!.toISOString()).toBe('2025-10-10T13:55:36.000Z');
    expect(result.windowEnd!.toISOString()).toBe('2025-10-11T09:00:00.000Z');
    expect(result.coverage).toMatch(/Traffic outside this window was not observed/);
  });

  it('rejects an oversized payload before touching the store', async () => {
    const store = makeStore();
    await expect(new IngestServerLogUseCase(store, new NotConfiguredCrawlerVerifier()).execute({
      text: 'x'.repeat(MAX_LOG_BYTES + 1), sourceName: 'huge.log', actorId: 'admin-1',
    })).rejects.toThrow(/exceeds/i);
    expect(store.state.ingestions).toHaveLength(0);
  });
});

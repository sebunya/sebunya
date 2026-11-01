/**
 * Server-log SEO: crawl budget from real access logs (migration 0120).
 *
 * Two rules carry this module:
 *
 *  1. A user-agent string is a CLAIM, not proof. Anyone can send
 *     "Googlebot/2.1". So the crawler identity and its VERIFICATION are
 *     separate fields, and verification defaults to UNVERIFIED. Only a
 *     reverse-DNS-then-forward-confirm check (an injected port) may promote a
 *     hit to VERIFIED, and a mismatch is recorded as SPOOFED.
 *
 *  2. Malformed lines are counted as rejected, never guessed at and never
 *     silently dropped. The ingestion row records lines read / parsed /
 *     rejected and the real time window covered, so a report can state the
 *     period it actually covers instead of implying full coverage.
 *
 * Parsing is a pure function over text. Nothing from the log content is ever
 * executed or interpolated into SQL; payload size and row count are bounded.
 */

export const CRAWLER_VERIFICATIONS = ['VERIFIED', 'SPOOFED', 'UNVERIFIED', 'NOT_CHECKED'] as const;
export type CrawlerVerification = (typeof CRAWLER_VERIFICATIONS)[number];

export const LOG_FORMATS = ['COMBINED', 'COMMON'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Hard bounds. A pasted log is untrusted input of unbounded size. */
export const MAX_LOG_BYTES = 5_000_000;
export const MAX_LOG_LINES = 50_000;
export const MAX_HITS_PER_INGESTION = 20_000;

/**
 * Known crawlers, matched case-insensitively on the user-agent token. The
 * `verifiable` flag says whether a reverse-DNS check is meaningful for this
 * crawler; where it is not, the honest verification is NOT_CHECKED.
 */
export const CRAWLER_SIGNATURES: ReadonlyArray<{ crawler: string; token: string; hostSuffixes: readonly string[] }> = [
  { crawler: 'Googlebot', token: 'googlebot', hostSuffixes: ['.googlebot.com', '.google.com'] },
  { crawler: 'Bingbot', token: 'bingbot', hostSuffixes: ['.search.msn.com'] },
  { crawler: 'DuckDuckBot', token: 'duckduckbot', hostSuffixes: ['.duckduckgo.com'] },
  { crawler: 'Slurp', token: 'slurp', hostSuffixes: ['.crawl.yahoo.net'] },
  { crawler: 'AhrefsBot', token: 'ahrefsbot', hostSuffixes: ['.ahrefs.com'] },
  { crawler: 'SemrushBot', token: 'semrushbot', hostSuffixes: ['.semrush.com'] },
  { crawler: 'GPTBot', token: 'gptbot', hostSuffixes: ['.openai.com'] },
  { crawler: 'ClaudeBot', token: 'claudebot', hostSuffixes: ['.anthropic.com'] },
  { crawler: 'PerplexityBot', token: 'perplexitybot', hostSuffixes: ['.perplexity.ai'] },
  { crawler: 'Applebot', token: 'applebot', hostSuffixes: ['.applebot.apple.com', '.apple.com'] },
];

export const KNOWN_CRAWLERS: readonly string[] = CRAWLER_SIGNATURES.map((s) => s.crawler);

/** The crawler CLAIMED by this user agent, or null. Says nothing about truth. */
export function identifyCrawler(userAgent: string | null | undefined): string | null {
  const ua = String(userAgent ?? '').toLowerCase();
  if (!ua) return null;
  for (const sig of CRAWLER_SIGNATURES) {
    if (ua.includes(sig.token)) return sig.crawler;
  }
  return null;
}

export function hostSuffixesFor(crawler: string): readonly string[] {
  return CRAWLER_SIGNATURES.find((s) => s.crawler === crawler)?.hostSuffixes ?? [];
}

// ── Pure parsing ────────────────────────────────────────────────────────────

export interface ParsedLogLine {
  ip: string;
  hitAt: Date;
  method: string;
  path: string;
  protocol: string | null;
  statusCode: number | null;
  bytes: number | null;
  referrer: string | null;
  userAgent: string | null;
}

export interface RejectedLogLine {
  lineNumber: number;
  reason: string;
}

/**
 * Combined Log Format:
 *   IP - user [10/Oct/2000:13:55:36 -0700] "GET /a HTTP/1.0" 200 2326 "ref" "ua"
 * Common Log Format is the same without the two trailing quoted fields.
 */
const LINE_RE =
  /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\d+|-)(?:\s+"([^"]*)"\s+"([^"]*)")?\s*$/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** `10/Oct/2000:13:55:36 -0700` → Date, or null when it is not that shape. */
export function parseLogTimestamp(raw: string): Date | null {
  const m = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  const day = Number(m[1]);
  const year = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  let offsetMinutes = 0;
  if (m[7]) {
    const sign = m[7][0] === '-' ? -1 : 1;
    offsetMinutes = sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5)));
  }
  const utc = Date.UTC(year, month, day, hour, minute, second) - offsetMinutes * 60_000;
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pure. Returns null for anything that does not parse — never a guess. */
export function parseAccessLogLine(line: string): ParsedLogLine | null {
  const raw = String(line ?? '').trim();
  if (!raw) return null;
  const m = LINE_RE.exec(raw);
  if (!m) return null;

  const hitAt = parseLogTimestamp(m[4]);
  if (!hitAt) return null;

  const request = m[5].trim();
  const parts = request.split(/\s+/);
  if (parts.length < 2) return null;
  const method = parts[0];
  const target = parts[1];
  const protocol = parts[2] ?? null;
  if (!/^[A-Z]{3,10}$/.test(method)) return null;

  let path: string;
  try {
    path = target.startsWith('http://') || target.startsWith('https://')
      ? new URL(target).pathname
      : target.split('?')[0];
  } catch {
    path = target.split('?')[0];
  }
  if (!path.startsWith('/')) return null;

  const status = Number(m[6]);
  const bytesRaw = m[7];

  return {
    ip: m[1],
    hitAt,
    method,
    path: path.slice(0, 2000),
    protocol,
    statusCode: Number.isFinite(status) ? status : null,
    bytes: bytesRaw === '-' ? null : Number(bytesRaw),
    referrer: m[8] === undefined || m[8] === '-' ? null : m[8],
    userAgent: m[9] === undefined || m[9] === '-' ? null : m[9],
  };
}

export interface CrawlerHitCandidate {
  hitAt: Date;
  path: string;
  crawler: string;
  ip: string;
  statusCode: number | null;
  bytes: number | null;
  userAgent: string | null;
  verification: CrawlerVerification;
}

export interface ParsedLog {
  linesRead: number;
  linesParsed: number;
  linesRejected: number;
  rejections: RejectedLogLine[];
  hits: CrawlerHitCandidate[];
  windowStart: Date | null;
  windowEnd: Date | null;
  truncated: boolean;
}

/**
 * Parse a whole access log. Pure and bounded. Every hit comes out UNVERIFIED:
 * this function only reads the claim in the user agent.
 */
export function parseAccessLog(text: string, options: { maxLines?: number } = {}): ParsedLog {
  const maxLines = Math.min(Math.max(Number(options.maxLines) || MAX_LOG_LINES, 1), MAX_LOG_LINES);
  const source = String(text ?? '').slice(0, MAX_LOG_BYTES);
  const allLines = source.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const truncated = allLines.length > maxLines;
  const lines = allLines.slice(0, maxLines);

  let linesParsed = 0;
  let linesRejected = 0;
  const rejections: RejectedLogLine[] = [];
  const hits: CrawlerHitCandidate[] = [];
  let windowStart: Date | null = null;
  let windowEnd: Date | null = null;

  lines.forEach((line, i) => {
    const parsed = parseAccessLogLine(line);
    if (!parsed) {
      linesRejected += 1;
      // Reasons are kept short and truncated: log content is untrusted text.
      if (rejections.length < 50) {
        rejections.push({ lineNumber: i + 1, reason: `Not a Combined/Common log line: ${line.trim().slice(0, 120)}` });
      }
      return;
    }
    linesParsed += 1;
    if (!windowStart || parsed.hitAt < windowStart) windowStart = parsed.hitAt;
    if (!windowEnd || parsed.hitAt > windowEnd) windowEnd = parsed.hitAt;

    const crawler = identifyCrawler(parsed.userAgent);
    if (crawler && hits.length < MAX_HITS_PER_INGESTION) {
      hits.push({
        hitAt: parsed.hitAt,
        path: parsed.path,
        crawler,
        ip: parsed.ip,
        statusCode: parsed.statusCode,
        bytes: parsed.bytes,
        userAgent: parsed.userAgent ? parsed.userAgent.slice(0, 500) : null,
        // A claim only. Verification happens separately, via the port.
        verification: 'UNVERIFIED',
      });
    }
  });

  return {
    linesRead: allLines.length,
    linesParsed,
    linesRejected,
    rejections,
    hits,
    windowStart,
    windowEnd,
    truncated,
  };
}

// ── Verification port ───────────────────────────────────────────────────────

/**
 * Reverse DNS → forward confirm. Implementations resolve the IP to a hostname
 * and resolve that hostname back to a set of IPs; only when the hostname ends
 * in an official suffix AND the forward lookup contains the original IP is the
 * hit VERIFIED. Anything else is SPOOFED; an unavailable resolver is
 * NOT_CHECKED, which is never shown as confirmation.
 */
export interface CrawlerVerifier {
  verify(ip: string, crawler: string): Promise<CrawlerVerification>;
}

/** Pure decision used by every verifier implementation and by the tests. */
export function decideVerification(input: {
  crawler: string;
  ip: string;
  reverseHost: string | null;
  forwardIps: string[] | null;
}): CrawlerVerification {
  const suffixes = hostSuffixesFor(input.crawler);
  if (suffixes.length === 0) return 'NOT_CHECKED';
  if (input.reverseHost === null || input.forwardIps === null) return 'NOT_CHECKED';
  const host = input.reverseHost.toLowerCase().replace(/\.$/, '');
  const suffixOk = suffixes.some((s) => host.endsWith(s));
  if (!suffixOk) return 'SPOOFED';
  return input.forwardIps.includes(input.ip) ? 'VERIFIED' : 'SPOOFED';
}

/** DNS resolution port, so the verifier is testable without a network. */
export interface DnsResolver {
  reverse(ip: string): Promise<string[]>;
  resolve(hostname: string): Promise<string[]>;
}

export class ReverseDnsCrawlerVerifier implements CrawlerVerifier {
  constructor(private readonly dns: DnsResolver) {}

  async verify(ip: string, crawler: string): Promise<CrawlerVerification> {
    if (hostSuffixesFor(crawler).length === 0) return 'NOT_CHECKED';
    let reverseHost: string | null = null;
    let forwardIps: string[] | null = null;
    try {
      const hosts = await this.dns.reverse(ip);
      reverseHost = hosts?.[0] ?? null;
      if (reverseHost) forwardIps = await this.dns.resolve(reverseHost);
    } catch {
      // A failed lookup is not evidence of anything, in either direction.
      return 'NOT_CHECKED';
    }
    return decideVerification({ crawler, ip, reverseHost, forwardIps });
  }
}

/** No resolver configured: every hit stays UNVERIFIED and says so. */
export class NotConfiguredCrawlerVerifier implements CrawlerVerifier {
  async verify(_ip: string, _crawler: string): Promise<CrawlerVerification> {
    return 'NOT_CHECKED';
  }
}

/**
 * Verify a batch of candidates, caching per (ip, crawler) so one address is
 * resolved once. Bounded by maxLookups: beyond it, hits keep UNVERIFIED rather
 * than being upgraded on faith.
 */
export async function verifyHits(
  hits: CrawlerHitCandidate[],
  verifier: CrawlerVerifier,
  maxLookups = 200,
): Promise<CrawlerHitCandidate[]> {
  const cache = new Map<string, CrawlerVerification>();
  let lookups = 0;
  const out: CrawlerHitCandidate[] = [];
  for (const hit of hits) {
    const key = `${hit.ip}|${hit.crawler}`;
    let verification = cache.get(key);
    if (verification === undefined) {
      if (lookups >= maxLookups) {
        out.push({ ...hit, verification: 'UNVERIFIED' });
        continue;
      }
      lookups += 1;
      try {
        verification = await verifier.verify(hit.ip, hit.crawler);
      } catch {
        verification = 'NOT_CHECKED';
      }
      if (!(CRAWLER_VERIFICATIONS as readonly string[]).includes(verification)) verification = 'NOT_CHECKED';
      cache.set(key, verification);
    }
    out.push({ ...hit, verification });
  }
  return out;
}

// ── Reporting helpers (pure) ────────────────────────────────────────────────

export interface CrawlBudgetSummary {
  totalHits: number;
  verified: number;
  spoofed: number;
  unverified: number;
  notChecked: number;
  perCrawler: Array<{ crawler: string; hits: number; verified: number }>;
  perStatusClass: Array<{ statusClass: string; hits: number }>;
}

export function summariseHits(hits: Array<{ crawler: string; verification: string; statusCode: number | null }>): CrawlBudgetSummary {
  const perCrawler = new Map<string, { hits: number; verified: number }>();
  const perStatus = new Map<string, number>();
  let verified = 0, spoofed = 0, unverified = 0, notChecked = 0;

  for (const h of hits) {
    const entry = perCrawler.get(h.crawler) ?? { hits: 0, verified: 0 };
    entry.hits += 1;
    if (h.verification === 'VERIFIED') { entry.verified += 1; verified += 1; }
    else if (h.verification === 'SPOOFED') spoofed += 1;
    else if (h.verification === 'NOT_CHECKED') notChecked += 1;
    else unverified += 1;
    perCrawler.set(h.crawler, entry);

    const cls = typeof h.statusCode === 'number' && h.statusCode >= 100 ? `${Math.floor(h.statusCode / 100)}xx` : 'unknown';
    perStatus.set(cls, (perStatus.get(cls) ?? 0) + 1);
  }

  return {
    totalHits: hits.length,
    verified, spoofed, unverified, notChecked,
    perCrawler: Array.from(perCrawler, ([crawler, v]) => ({ crawler, hits: v.hits, verified: v.verified }))
      .sort((a, b) => b.hits - a.hits),
    perStatusClass: Array.from(perStatus, ([statusClass, hitCount]) => ({ statusClass, hits: hitCount }))
      .sort((a, b) => b.hits - a.hits),
  };
}

/** The sentence a report must lead with, so coverage is never overstated. */
export function describeCoverage(windowStart: Date | string | null, windowEnd: Date | string | null): string {
  if (!windowStart || !windowEnd) {
    return 'No parseable log lines, so this report covers no time period at all.';
  }
  const a = new Date(windowStart).toISOString();
  const b = new Date(windowEnd).toISOString();
  return `Covers only the ingested log lines between ${a} and ${b}. Traffic outside this window was not observed.`;
}

// ── The ingestion use case ──────────────────────────────────────────────────

export interface LogIngestionStore {
  recordLogIngestion(input: {
    sourceName: string;
    format: LogFormat;
    linesRead: number;
    linesParsed: number;
    linesRejected: number;
    crawlerHits: number;
    windowStart: Date | null;
    windowEnd: Date | null;
    createdBy: string;
  }): Promise<any>;
  insertCrawlerHits(hits: CrawlerHitCandidate[], sourceFile: string): Promise<number>;
}

export type IngestValidation =
  | { ok: true; text: string; sourceName: string; format: LogFormat }
  | { ok: false; code: string; message: string };

export function validateIngestInput(raw: any): IngestValidation {
  const text = typeof raw?.text === 'string' ? raw.text : '';
  if (!text.trim()) return { ok: false, code: 'EMPTY_LOG', message: 'Paste or upload access-log text to ingest.' };
  if (text.length > MAX_LOG_BYTES) {
    return { ok: false, code: 'LOG_TOO_LARGE', message: `Log payload exceeds the ${MAX_LOG_BYTES} byte limit. Split the file and ingest it in parts.` };
  }
  const sourceName = String(raw?.sourceName ?? '').trim().slice(0, 200);
  if (!sourceName) return { ok: false, code: 'SOURCE_REQUIRED', message: 'Name the log source so the ingestion record says where the data came from.' };
  const format = String(raw?.format ?? 'COMBINED').toUpperCase() as LogFormat;
  if (!(LOG_FORMATS as readonly string[]).includes(format)) {
    return { ok: false, code: 'BAD_FORMAT', message: `Unsupported log format. Supported: ${LOG_FORMATS.join(', ')}.` };
  }
  return { ok: true, text, sourceName, format };
}

export interface IngestResult {
  ingestionId: string | null;
  linesRead: number;
  linesParsed: number;
  linesRejected: number;
  crawlerHits: number;
  inserted: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  truncated: boolean;
  coverage: string;
  summary: CrawlBudgetSummary;
  rejections: RejectedLogLine[];
}

export class IngestServerLogUseCase {
  constructor(
    private readonly store: LogIngestionStore,
    private readonly verifier: CrawlerVerifier,
  ) {}

  async execute(input: { text: string; sourceName: string; format?: LogFormat; actorId: string }): Promise<IngestResult> {
    const validation = validateIngestInput(input);
    if (!validation.ok) throw Object.assign(new Error(validation.message), { code: validation.code });

    const parsed = parseAccessLog(validation.text);
    const verified = await verifyHits(parsed.hits, this.verifier);
    const inserted = verified.length > 0 ? await this.store.insertCrawlerHits(verified, validation.sourceName) : 0;

    const row = await this.store.recordLogIngestion({
      sourceName: validation.sourceName,
      format: validation.format,
      linesRead: parsed.linesRead,
      linesParsed: parsed.linesParsed,
      linesRejected: parsed.linesRejected,
      crawlerHits: verified.length,
      windowStart: parsed.windowStart,
      windowEnd: parsed.windowEnd,
      createdBy: input.actorId,
    });

    return {
      ingestionId: row?.id ?? null,
      linesRead: parsed.linesRead,
      linesParsed: parsed.linesParsed,
      linesRejected: parsed.linesRejected,
      crawlerHits: verified.length,
      inserted,
      windowStart: parsed.windowStart,
      windowEnd: parsed.windowEnd,
      truncated: parsed.truncated,
      coverage: describeCoverage(parsed.windowStart, parsed.windowEnd),
      summary: summariseHits(verified),
      rejections: parsed.rejections,
    };
  }
}

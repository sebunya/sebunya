import type { Context, Next } from 'hono';
import { logger } from '../../../infrastructure/logging/logger';
import { clientIp } from '../clientAddress';

// In-memory cache for telemetry event replay protection
const processedEventIds = new Set<string>();

// Periodic cache cleanup to prevent memory exhaustion
setInterval(() => {
  processedEventIds.clear();
}, 5 * 60_000);

/**
 * PHASE 13 — BOT DETECTION & FRAUD SUPPRESSION
 *
 * Signals evaluated (cheapest first):
 * 1. Cloudflare Bot Score forwarded by Caddy via X-CF-Bot-Score header
 * 2. User-Agent presence and pattern matching
 * 3. In-memory sliding-window velocity (>50 events/IP/60s)
 * 4. Timestamp sanity — rejects forged/replayed event_time values
 *
 * The parsed request body is stored in c.var for downstream handlers to avoid
 * double JSON parsing. Hono typed variables require declaring them via env types.
 */

// ── Sliding window velocity tracker ──────────────────────────────────────────
const ipWindows = new Map<string, number[]>();
const VELOCITY_WINDOW_MS  = 60_000;
const VELOCITY_MAX_EVENTS = 50;
const FUTURE_TOLERANCE_MS = 30_000;
const PAST_TOLERANCE_MS   = 7 * 86_400_000;

// Purge stale windows every 5 minutes — prevents unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - VELOCITY_WINDOW_MS;
  for (const [ip, ts] of ipWindows) {
    const fresh = ts.filter(t => t > cutoff);
    if (fresh.length === 0) ipWindows.delete(ip);
    else ipWindows.set(ip, fresh);
  }
}, 5 * 60_000);

// ── Pattern lists ─────────────────────────────────────────────────────────────
const BOT_UA_PATTERNS = [
  /^curl\//i, /^wget\//i, /^python-requests\//i, /^go-http-client\//i,
  /^axios\//i, /^node-fetch\//i, /bot/i, /crawler/i, /spider/i,
  /scrapy/i,  /phantomjs/i, /headless/i, /selenium/i, /playwright/i,
];
const ALLOWLIST_UA_PATTERNS = [/googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i];

// ── Helpers ───────────────────────────────────────────────────────────────────
export function isBotUserAgent(ua: string): boolean {
  if (!ua || ua.trim().length < 5) return true;
  if (ALLOWLIST_UA_PATTERNS.some(p => p.test(ua))) return false;
  return BOT_UA_PATTERNS.some(p => p.test(ua.toLowerCase()));
}

function checkVelocity(ip: string): boolean {
  const now    = Date.now();
  const cutoff = now - VELOCITY_WINDOW_MS;
  const ts     = (ipWindows.get(ip) ?? []).filter(t => t > cutoff);
  ts.push(now);
  ipWindows.set(ip, ts);
  return ts.length > VELOCITY_MAX_EVENTS;
}

function isTimestampOutOfBounds(eventTimeSec: number): boolean {
  const ms = eventTimeSec * 1000;
  const now = Date.now();
  return ms > now + FUTURE_TOLERANCE_MS || ms < now - PAST_TOLERANCE_MS;
}

// ── Middleware ────────────────────────────────────────────────────────────────
/**
 * Returns Promise<Response> — compatible with Hono middleware signature.
 * `next()` returns Promise<Response>, which satisfies the return type.
 */
export async function botDetectionMiddleware(c: Context, next: Next): Promise<Response | void> {
  const ip = clientIp(c);
  const ua = c.req.header('user-agent') ?? '';

  // 1. Cloudflare bot score (forwarded by Caddy)
  const cfBotScore = parseInt(c.req.header('x-cf-bot-score') ?? '100', 10);
  if (cfBotScore < 30) return c.newResponse(null, 403);

  // 2. User-agent check
  if (isBotUserAgent(ua)) return c.newResponse(null, 403);

  // 3. Velocity check
  if (checkVelocity(ip)) return c.newResponse(null, 429);

  // 4. Parse body once here to check timestamp (avoids double-parse in handler)
  let parsedBody: unknown;
  try {
    const text = await c.req.text();
    parsedBody = JSON.parse(text);
  } catch {
    return c.newResponse(null, 400);
  }

  // GTM Replay Protection Guard
  if (
    parsedBody !== null &&
    typeof parsedBody === 'object' &&
    'event_id' in parsedBody &&
    typeof (parsedBody as any).event_id === 'string'
  ) {
    const eid = (parsedBody as any).event_id;
    if (processedEventIds.has(eid)) {
      logger.warn({ eventId: eid }, '[BotDetection] Replay attack detected: duplicate event_id');
      return c.newResponse(JSON.stringify({ success: false, error: 'REPLAY_DETECTED' }), 409, {
        'Content-Type': 'application/json',
      });
    }
    processedEventIds.add(eid);
  }

  if (
    parsedBody !== null &&
    typeof parsedBody === 'object' &&
    'event_time' in parsedBody &&
    typeof (parsedBody as any).event_time === 'number' &&
    isTimestampOutOfBounds((parsedBody as any).event_time)
  ) {
    return c.newResponse(null, 400);
  }

  // Stash parsed body so handlers don't re-parse
  (c as any)._parsedBody = parsedBody;

  await next();
}

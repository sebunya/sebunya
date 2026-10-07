import type { APIRoute } from 'astro';
import { apiBase } from '../lib/api';
import { SITE_ORIGIN } from '../lib/sitemap';

/**
 * robots.txt — served from the PUBLISHED governance version when one exists,
 * and from this committed static content otherwise.
 *
 * The fallback is not a placeholder: it is the real, correct directive set the
 * storefront shipped with. It exists because robots.txt must never be empty,
 * truncated or accidentally permissive. An unreachable API, a slow API, or a
 * database with no published row all resolve to the same safe file rather than
 * to a 500 or a blank body — a broken robots.txt is read by crawlers as
 * "no restrictions", which would expose /admin and /checkout to indexing.
 *
 * The reverse failure is guarded too: a published row whose body is empty is
 * rejected in favour of the fallback.
 */

const FALLBACK_TIMEOUT_MS = 2500;

/**
 * AI crawlers are named, not left to the wildcard: an agent-aware robots.txt is
 * how answer engines and AI-readiness scanners read "welcome" rather than
 * "unaddressed". They share the ONE rule group below (RFC 9309: several
 * User-agent lines may head a group), so every private path stays disallowed
 * for them exactly as for everyone else — a separate group per bot would have
 * to repeat every Disallow and silently drift.
 *
 * Content-Signal (contentsignals.org): search, quoting in AI answers and
 * training are all permitted — the owner wants the shop known to assistants.
 */
export const AI_CRAWLERS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended', 'Amazonbot',
  'meta-externalagent', 'CCBot', 'DuckAssistBot', 'MistralAI-User',
];

function staticRobots(base: string): string {
  return (
    'User-agent: *\n' +
    AI_CRAWLERS.map((ua) => `User-agent: ${ua}\n`).join('') +
    'Content-Signal: search=yes, ai-input=yes, ai-train=yes\n' +
    'Allow: /\n' +
    'Disallow: /admin\n' +
    'Disallow: /admin/\n' +
    'Disallow: /checkout\n' +
    'Disallow: /cart\n' +
    'Disallow: /dealers/dashboard\n' +
    'Disallow: /account\n' +
    'Disallow: /orders\n' +
    'Disallow: /track-order\n' +
    'Disallow: /api/\n' +
    '\n' +
    `Sitemap: ${base}/sitemap.xml\n` +
    '\n' +
    `# For AI assistants: ${base}/llms.txt (full catalogue: ${base}/llms-full.txt)\n` +
    `# MCP server: ${base}/mcp   API catalog: ${base}/.well-known/api-catalog\n`
  );
}

async function publishedRobots(base: string): Promise<{ body: string; version: number | null } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase}/seo/robots-published?base=${encodeURIComponent(base)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    if (!json?.success || json?.data?.published !== true) return null;
    const body = typeof json.data.content === 'string' ? json.data.content : '';
    // An empty published body is treated as no published version at all.
    if (body.trim() === '') return null;
    return { body: body.endsWith('\n') ? body : `${body}\n`, version: json.data.version ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const GET: APIRoute = async ({ site }) => {
  // `site` is Astro's configured site URL, which this project does not set, so
  // this fell through to the localhost default and PRODUCTION served
  // "Sitemap: http://localhost:4321/sitemap.xml" to Google. The sitemap was
  // therefore never fetchable from the one file that advertises it. Falls back
  // to the same SITE_ORIGIN the sitemaps themselves are built from.
  const base = (site?.toString() ?? SITE_ORIGIN).replace(/\/$/, '');

  const published = await publishedRobots(base);
  const body = published ? published.body : staticRobots(base);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      // So an operator can tell at a glance which source answered.
      'X-Robots-Source': published ? `DATABASE_V${published.version ?? '?'}` : 'STATIC_FALLBACK',
    },
  });
};

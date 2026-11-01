/**
 * Markdown for agents, served by the origin.
 *
 * Cloudflare offers HTML→Markdown conversion at the edge, but only on paid
 * plans, and a converted page is only ever as good as the HTML it strips. We
 * generate the Markdown from the same data the page renders, so an agent gets
 * the facts — price, stock, verified specifications, the returns promise —
 * without the navigation, scripts and styling that dominate an HTML fetch.
 *
 * The response follows Cloudflare's documented shape so an agent needs no
 * per-site parsing: YAML frontmatter (title, description), the body, then the
 * page's JSON-LD in one fenced json block. We add the same token-count headers
 * (`x-markdown-tokens`, `x-original-tokens`) and set `Vary: Accept` so a cache
 * never hands Markdown to a browser. If Markdown for Agents is switched on
 * later, Cloudflare preserves an origin `content-signal` header, so the policy
 * stated here stays authoritative.
 */
export const MARKDOWN_MEDIA_TYPE = 'text/markdown';

/**
 * Does this client prefer Markdown? Only an explicit `text/markdown` in Accept
 * counts — a browser sending `*\/*` must keep getting HTML.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const wanted = accept.toLowerCase().split(',').map((part) => {
    const [type, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { type: type.trim(), q: q ? Number(q.slice(2)) : 1 };
  });
  const md = wanted.find((w) => w.type === 'text/markdown');
  if (!md || !(md.q > 0)) return false;
  const html = wanted.find((w) => w.type === 'text/html');
  // A browser that lists both prefers HTML unless markdown is ranked higher.
  return !html || md.q >= html.q;
}

/** Rough token estimate: the same ~4-characters-per-token rule agents use for budgeting. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const yamlValue = (v: string): string => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim()}"`;

export interface AgentDocument {
  title: string;
  description?: string | null;
  body: string;
  /** JSON-LD nodes the HTML page also publishes. */
  jsonLd?: unknown[];
}

export function renderAgentMarkdown(doc: AgentDocument): string {
  const front: string[] = [];
  if (doc.title) front.push(`title: ${yamlValue(doc.title)}`);
  if (doc.description) front.push(`description: ${yamlValue(doc.description)}`);
  const parts: string[] = [];
  if (front.length > 0) parts.push(`---\n${front.join('\n')}\n---\n`);
  parts.push(doc.body.trim());
  const nodes = (doc.jsonLd ?? []).filter(Boolean);
  if (nodes.length > 0) {
    parts.push(['```json', ...nodes.map((n) => JSON.stringify(n)), '```'].join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * Cloudflare also reports `x-original-tokens`, but it already has the HTML in
 * hand. We would have to render the page we were asked NOT to render, so the
 * saving goes unreported rather than being paid for twice.
 */
export function markdownResponse(markdown: string): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/markdown; charset=utf-8',
    // Caches must keep Markdown and HTML as separate variants.
    Vary: 'Accept',
    'Cache-Control': 'public, max-age=900',
    'x-markdown-tokens': String(estimateTokens(markdown)),
    // Citation is welcome; training is not. Mirrors the zone's content signals,
    // and Cloudflare treats an origin content-signal as authoritative.
    'content-signal': 'search=yes, ai-input=yes, ai-train=no',
  };
  return new Response(markdown, { headers });
}

/** A money figure the way the storefront prints it. */
export const ugx = (v: number): string => `UGX ${v.toLocaleString('en-UG')}`;

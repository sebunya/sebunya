import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../../lib/sitemap';

/**
 * /.well-known/api-catalog (RFC 9727) — where an automated client finds this
 * site's public APIs: the read-only catalogue API (described by /openapi.json)
 * and the MCP server at /mcp. A linkset (RFC 9264) in JSON.
 */
const linkset = {
  linkset: [
    {
      anchor: 'https://api.shopgoldplus.com/',
      'service-desc': [{ href: `${SITE_ORIGIN}/openapi.json`, type: 'application/openapi+json' }],
      'service-doc': [{ href: `${SITE_ORIGIN}/developers`, type: 'text/html' }],
    },
    {
      anchor: `${SITE_ORIGIN}/mcp`,
      'service-desc': [{ href: `${SITE_ORIGIN}/.well-known/mcp/server-card.json`, type: 'application/json' }],
      'service-doc': [{ href: `${SITE_ORIGIN}/developers`, type: 'text/html' }],
    },
  ],
};

const respond = (method: 'GET' | 'HEAD') =>
  new Response(method === 'HEAD' ? null : JSON.stringify(linkset, null, 2), {
    headers: {
      'Content-Type': 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      Link: `<${SITE_ORIGIN}/.well-known/api-catalog>; rel="api-catalog"`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });

export const GET: APIRoute = () => respond('GET');
export const HEAD: APIRoute = () => respond('HEAD');

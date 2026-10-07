import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../../../lib/sitemap';

/**
 * /.well-known/mcp/server-card.json (also served at /.well-known/mcp.json) —
 * how an MCP client discovers the shop's server before connecting: where it
 * is, which transport it speaks and which tools it offers. The tool list is
 * the one /mcp answers tools/list with; keep the two in step.
 */
export const serverCard = {
  name: 'goldplus-shop',
  title: 'GoldPlus shop (Kampala, Uganda)',
  description: 'Read-only tools for the GoldPlus electronics accessories shop: product search and details with UGX prices and stock, categories, the battery finder and shop details.',
  version: '1.0.0',
  websiteUrl: SITE_ORIGIN,
  documentationUrl: `${SITE_ORIGIN}/developers`,
  remotes: [{ type: 'streamable-http', url: `${SITE_ORIGIN}/mcp` }],
  authentication: { required: false },
  capabilities: { tools: { listChanged: false } },
  tools: ['search_products', 'get_product', 'list_categories', 'find_battery', 'store_info'],
};

export const GET: APIRoute = () =>
  new Response(JSON.stringify(serverCard, null, 2), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' },
  });

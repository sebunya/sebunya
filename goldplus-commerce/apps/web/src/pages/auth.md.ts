import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../lib/sitemap';

/**
 * /auth.md — what an AI agent needs to know about signing in here. The honest
 * answer for this shop: nothing an agent can use needs an account, and agents
 * may not register or sign in on a customer's behalf. Customer accounts, orders
 * and payment are for the person, on the website.
 */
const AUTH_MD = `# Authentication for AI agents — GoldPlus

## Short answer

You do not need to sign in. Everything an agent can use at GoldPlus is public and read-only:

- MCP server: ${SITE_ORIGIN}/mcp (no key, no OAuth)
- Public catalogue API: described at ${SITE_ORIGIN}/openapi.json (no key)
- Full catalogue as text: ${SITE_ORIGIN}/llms-full.txt

## Registering or signing in for a user

Not supported. Agents may not create GoldPlus accounts, sign in, place orders or pay on a person's behalf, and there is no agent OAuth flow or API key to request. Customer accounts (${SITE_ORIGIN}/register, ${SITE_ORIGIN}/login) are for people, who sign in and check out themselves on the website.

## What to do instead

Find the product with the MCP tools or the API, then give the person the product link. They review the price and buy on the site.

## Limits

About 60 MCP calls a minute per address. For more, contact us: ${SITE_ORIGIN}/support
`;

export const GET: APIRoute = () =>
  new Response(AUTH_MD, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' } });

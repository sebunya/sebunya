import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../lib/sitemap';
import { visitorKey } from '../lib/publicFormLimiter';
import { readBodyCapped } from '../lib/boundedBody';
import { WindowLimiter } from '../lib/windowLimiter';
import { INSTRUCTIONS, TOOLS, callTool, isToolName, toolText, type Json } from '../lib/agentTools';

/**
 * /mcp — a public, read-only Model Context Protocol server for the shop
 * (Streamable HTTP transport, stateless, JSON responses; no SSE stream).
 *
 * An assistant connected to it can search the catalogue, read a product, list
 * the categories, run the battery finder and read the shop's details: the same
 * public facts the storefront shows, from the same API, at the same prices.
 * Nothing here writes, places an order, reads a customer or sets a cookie;
 * buying stays on the website, where the customer sees and confirms the price.
 */

export const prerender = false;

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 64 * 1024;
const SERVER_INFO = { name: 'goldplus-shop', title: 'GoldPlus shop (Kampala, Uganda)', version: '1.0.0', websiteUrl: SITE_ORIGIN };

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Max-Age': '86400',
};

// A small per-address budget: the tools fan out to the commerce API, and a
// public endpoint must not become a way to hammer it.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const limiter = new WindowLimiter(MAX_PER_WINDOW, WINDOW_MS);

type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const rpcError = (id: unknown, code: number, message: string): Json => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: Json): Json => ({ jsonrpc: '2.0', id, result });

async function handle(msg: RpcRequest): Promise<Json | null> {
  const isNotification = msg.id === undefined;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isNotification ? null : rpcError(msg.id, -32600, 'Invalid Request');
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Json;
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return isNotification ? null : rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS as unknown as Json[] });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      if (!isToolName(name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json;
      try {
        return rpcResult(msg.id, await callTool(name, args));
      } catch {
        return rpcResult(msg.id, toolText({}, 'The tool failed unexpectedly. Please try again.', true));
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized and friends need no answer
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // The visitor's own address (X-Real-IP from the edge), not the proxy's: keyed on
  // the socket address every agent would share one budget behind Caddy.
  const key = visitorKey(request.headers, () => clientAddress);
  const tooMany = () => json(rpcError(null, -32000, 'Too many requests; slow down.'), 429, { 'Retry-After': '60' });
  if (!limiter.take(key)) return tooMany();
  // Bytes, not string length, and the read stops at the cap: an oversized body is never buffered whole.
  const read = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!read.ok) return json(rpcError(null, -32600, read.reason === 'TOO_LARGE' ? 'Request too large' : 'Could not read the request'), read.reason === 'TOO_LARGE' ? 413 : 400);
  const raw = read.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || parsed.length > 20) return json(rpcError(null, -32600, 'Invalid Request'), 400);
    // Every member of a batch is a call against the budget (the first was counted above).
    if (parsed.length > 1 && !limiter.take(key, parsed.length - 1)) return tooMany();
    const out = (await Promise.all(parsed.map((m) => (m && typeof m === 'object' ? handle(m as RpcRequest) : rpcError(null, -32600, 'Invalid Request'))))).filter((r): r is Json => r !== null);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  // A JSON-RPC message is an object; a bare string or number is not a notification.
  if (!parsed || typeof parsed !== 'object') return json(rpcError(null, -32600, 'Invalid Request'), 400);
  const res = await handle(parsed as RpcRequest);
  return res ? json(res) : new Response(null, { status: 202, headers: CORS });
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });

// This server keeps no session and pushes no events, so there is no stream to
// open (GET) or close (DELETE): the transport answers 405 for both.
const notAllowed: APIRoute = () =>
  new Response(JSON.stringify({ error: 'This MCP endpoint takes JSON-RPC over POST (Streamable HTTP, stateless).', docs: `${SITE_ORIGIN}/developers` }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS', ...CORS },
  });
export const GET = notAllowed;
export const DELETE = notAllowed;

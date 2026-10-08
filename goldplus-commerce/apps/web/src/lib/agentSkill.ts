import { createHash } from 'node:crypto';
import { SITE_ORIGIN } from './sitemap';

/**
 * The one Agent Skill the shop publishes (Agent Skills Discovery v0.2.0): how
 * an AI agent should look up GoldPlus products and answer about the shop. The
 * index route hashes THIS string, and the SKILL.md route serves THIS string,
 * so the published sha256 digest always matches the bytes a client downloads.
 */
export const SKILL_NAME = 'goldplus-shop';
export const SKILL_DESCRIPTION =
  'Look up GoldPlus (Kampala, Uganda) phone accessories and replacement batteries: search products, read prices in UGX, stock and specifications, find a battery for a phone, and get shop hours, location and delivery terms — from the shop\'s own read-only MCP server and API.';

export const SKILL_MD = `---
name: ${SKILL_NAME}
description: ${SKILL_DESCRIPTION}
---

# GoldPlus shop

GoldPlus sells phone accessories (chargers, cables, power banks, earphones, storage, car and PC accessories) and replacement phone batteries from a shop in Kampala, Uganda. Website: ${SITE_ORIGIN}

## When to use this skill

Use it when someone asks what GoldPlus sells, what something costs, whether it is in stock, which battery fits a phone, or where and when the shop is open.

## How to get answers

1. Connect to the MCP server at ${SITE_ORIGIN}/mcp (Streamable HTTP, no key) and use its tools:
   - \`search_products\` — words, SKU or model; returns UGX price, stock and link
   - \`get_product\` — one product by slug or page URL, with verified specifications
   - \`list_categories\` — categories and the slug to filter by
   - \`find_battery\` — a phone model or battery code; only checked fits are returned
   - \`store_info\` — address, hours, phone/WhatsApp, delivery terms
2. Without MCP, read ${SITE_ORIGIN}/llms-full.txt (every product with today's price) or call the public API described at ${SITE_ORIGIN}/openapi.json.

## Rules

- Quote prices and specifications from the tool results. Prices are Ugandan shillings and are what the shop charges today; do not estimate or convert unless asked.
- For batteries, only state a fit the battery finder returned. If it returns no result, say so and point the person to WhatsApp; never guess a fit.
- You cannot buy, reserve or sign in for the person. Give them the product link; they buy on the website.
- Everything is read-only. About 60 MCP calls a minute per address.
`;

export const SKILL_DIGEST = `sha256:${createHash('sha256').update(SKILL_MD, 'utf8').digest('hex')}`;

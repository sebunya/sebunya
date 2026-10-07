import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../lib/sitemap';

/**
 * /openapi.json — a description of the PUBLIC, read-only catalogue API the
 * storefront itself reads (api.shopgoldplus.com), so an agent can query it
 * directly. Only the endpoints and fields a visitor can already see are
 * documented; nothing here needs a key and nothing here writes.
 *
 * Prices are UGX whole shillings and are the regular price; while a campaign
 * runs the website (and /mcp) show the campaign price, which is what is charged.
 */
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'GoldPlus public catalogue API',
    version: '1.0.0',
    summary: 'Read-only product catalogue and battery finder for GoldPlus, Kampala, Uganda.',
    description:
      'Public, unauthenticated, read-only. Responses are wrapped as {"success": true, "data": …}. Prices are Ugandan shillings (UGX). ' +
      `For assistants, the MCP server at ${SITE_ORIGIN}/mcp offers the same data with campaign prices applied.`,
    contact: { name: 'GoldPlus', url: `${SITE_ORIGIN}/support` },
    termsOfService: `${SITE_ORIGIN}/terms`,
  },
  externalDocs: { description: 'Notes for developers and AI agents', url: `${SITE_ORIGIN}/developers` },
  servers: [{ url: 'https://api.shopgoldplus.com', description: 'Production' }],
  paths: {
    '/products': {
      get: {
        operationId: 'listProducts',
        summary: 'Search and list products',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string', maxLength: 120 }, description: 'Words, SKU or model number.' },
          { name: 'category', in: 'query', schema: { type: 'string', example: 'power-devices' }, description: 'Category slug.' },
          { name: 'inStock', in: 'query', schema: { type: 'boolean' }, description: 'Only products in stock.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 60 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        ],
        responses: {
          '200': {
            description: 'Products',
            content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } } } },
          },
        },
      },
    },
    '/products/{slug}': {
      get: {
        operationId: 'getProduct',
        summary: 'One product by slug',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string', example: 'goldplus-charger-gp-c11' } }],
        responses: {
          '200': { description: 'The product', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Product' } } } } } },
          '404': { description: 'No product has that slug' },
        },
      },
    },
    '/batteries/finder/search': {
      get: {
        operationId: 'findBattery',
        summary: 'Battery finder: phone model or battery code',
        description: 'Returns kind BATTERY, DEVICE, AMBIGUOUS_DEVICE, SUGGESTIONS or NO_RESULT. Only fits GoldPlus has checked are returned; nothing is guessed.',
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 120, example: 'Tecno Spark 7' } }],
        responses: { '200': { description: 'Finder result', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    },
  },
  components: {
    schemas: {
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          slug: { type: 'string', description: `Page: ${SITE_ORIGIN}/products/{slug}` },
          name: { type: 'string' },
          categoryName: { type: 'string' },
          shortDescription: { type: ['string', 'null'] },
          longDescription: { type: ['string', 'null'] },
          sku: { type: ['string', 'null'] },
          modelNumber: { type: ['string', 'null'] },
          retailPriceUgx: { type: ['integer', 'null'], description: 'Regular price, whole UGX.' },
          availability: {
            oneOf: [
              { type: 'object', properties: { kind: { const: 'in_stock' }, quantity: { type: 'integer' } } },
              { type: 'object', properties: { kind: { const: 'out_of_stock' } } },
              { type: 'object', properties: { kind: { const: 'pre_order' } } },
            ],
          },
          verifiedSpecs: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
          images: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, alt: { type: ['string', 'null'] } } } },
        },
      },
    },
  },
};

export const GET: APIRoute = () =>
  new Response(JSON.stringify(spec, null, 2), {
    headers: { 'Content-Type': 'application/openapi+json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' },
  });

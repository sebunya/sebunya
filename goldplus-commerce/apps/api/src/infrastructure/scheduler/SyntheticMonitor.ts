import { db } from '../db/client';
import { orders } from '../db/schema/commerce';
import { outboxEvents } from '../db/schema/system';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { logger } from '../logging/logger';
import { env } from '../../config/env';
import * as client from 'prom-client';
import { createHash } from 'node:crypto';

const CATALOGUE_MONITOR_LIMIT = 5;
const PUBLIC_CATALOGUE_PREDICATE_VERSION =
  'public-catalogue-v2:approval_status=approved;active=true;order=created_at desc,id asc;limit=5;price=retail_price_when_has_retail_price';

export type CatalogueParityReasonCode =
  | 'CATALOGUE_PARITY_OK'
  | 'CATALOGUE_DATABASE_TARGET_MISMATCH'
  | 'CATALOGUE_DATABASE_SCHEMA_MISMATCH'
  | 'CATALOGUE_HTTP_STATUS_INVALID'
  | 'CATALOGUE_CONTENT_TYPE_INVALID'
  | 'CATALOGUE_RESPONSE_MALFORMED'
  | 'CATALOGUE_COLLECTION_MISSING'
  | 'CATALOGUE_COLLECTION_MALFORMED'
  | 'CATALOGUE_DB_GT_ZERO_API_ZERO'
  | 'CATALOGUE_PAGE_COUNT_DIVERGENCE'
  | 'CATALOGUE_IDENTIFIER_DIVERGENCE'
  | 'CATALOGUE_PRICE_DIVERGENCE';

export interface CatalogueObservation {
  id: string;
  slug: string;
  canonicalPriceUgx: number | null;
}

export interface IndependentCatalogueTruth {
  databaseName: string;
  schemaName: string;
  searchPath: string;
  predicateVersion: string;
  totalEligible: number;
  expectedPageCount: number;
  page: CatalogueObservation[];
  identifierSetSha256: string;
  identifierPriceSha256: string;
}

export interface CatalogueParityResult {
  ok: boolean;
  reasonCode: CatalogueParityReasonCode;
  firstDivergentLayer: 'none' | 'database_target' | 'database_schema' | 'api_http' | 'api_schema' | 'api_collection';
  sqlCount: number;
  apiCount: number;
  sqlIdentifierSetSha256: string;
  apiIdentifierSetSha256: string;
  sqlIdentifierPriceSha256: string;
  apiIdentifierPriceSha256: string;
  databaseFingerprintSha256: string;
}

interface CatalogueHttpObservation {
  status: number;
  contentType: string | null;
  body: unknown;
}

export class CatalogueParityError extends Error {
  constructor(
    public readonly result: CatalogueParityResult,
  ) {
    super(`Catalogue parity failed: ${result.reasonCode}`);
    this.name = 'CatalogueParityError';
  }
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function hashCatalogueIdentifiers(rows: CatalogueObservation[]): string {
  return sha256(rows.map((row) => row.id).sort().join('\n'));
}

export function hashCatalogueIdentifiersAndPrices(rows: CatalogueObservation[]): string {
  return sha256(
    rows
      .map((row) => `${row.id}|${row.canonicalPriceUgx === null ? 'null' : row.canonicalPriceUgx}`)
      .sort()
      .join('\n'),
  );
}

function databaseNameFromUrl(value: string): string | null {
  try {
    const name = new URL(value).pathname.replace(/^\//, '').split('/')[0];
    return name ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

function resultRows<T>(result: unknown): T[] {
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

function parityResult(
  truth: IndependentCatalogueTruth,
  apiRows: CatalogueObservation[],
  reasonCode: CatalogueParityReasonCode,
  firstDivergentLayer: CatalogueParityResult['firstDivergentLayer'],
): CatalogueParityResult {
  return {
    ok: reasonCode === 'CATALOGUE_PARITY_OK',
    reasonCode,
    firstDivergentLayer,
    sqlCount: truth.expectedPageCount,
    apiCount: apiRows.length,
    sqlIdentifierSetSha256: truth.identifierSetSha256,
    apiIdentifierSetSha256: hashCatalogueIdentifiers(apiRows),
    sqlIdentifierPriceSha256: truth.identifierPriceSha256,
    apiIdentifierPriceSha256: hashCatalogueIdentifiersAndPrices(apiRows),
    databaseFingerprintSha256: sha256(
      `${truth.databaseName}|${truth.schemaName}|${truth.searchPath}|${truth.predicateVersion}`,
    ),
  };
}

export function evaluateCatalogueParity(
  truth: IndependentCatalogueTruth,
  http: CatalogueHttpObservation,
  expectedTarget: { databaseName?: string | null; schemaName?: string } = {},
): { result: CatalogueParityResult; products: Array<Record<string, unknown>> } {
  const noRows: CatalogueObservation[] = [];
  if (expectedTarget.databaseName && truth.databaseName !== expectedTarget.databaseName) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_DATABASE_TARGET_MISMATCH', 'database_target'),
      products: [],
    };
  }
  if (expectedTarget.schemaName && truth.schemaName !== expectedTarget.schemaName) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_DATABASE_SCHEMA_MISMATCH', 'database_schema'),
      products: [],
    };
  }
  if (http.status < 200 || http.status >= 300) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_HTTP_STATUS_INVALID', 'api_http'),
      products: [],
    };
  }
  if (!http.contentType?.toLowerCase().includes('application/json')) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_CONTENT_TYPE_INVALID', 'api_http'),
      products: [],
    };
  }
  if (!http.body || typeof http.body !== 'object' || Array.isArray(http.body)) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_RESPONSE_MALFORMED', 'api_schema'),
      products: [],
    };
  }

  const envelope = http.body as Record<string, unknown>;
  if (envelope.success !== true) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_RESPONSE_MALFORMED', 'api_schema'),
      products: [],
    };
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_COLLECTION_MISSING', 'api_schema'),
      products: [],
    };
  }
  if (!Array.isArray(envelope.data)) {
    return {
      result: parityResult(truth, noRows, 'CATALOGUE_COLLECTION_MALFORMED', 'api_schema'),
      products: [],
    };
  }

  const products = envelope.data as Array<Record<string, unknown>>;
  const apiRows: CatalogueObservation[] = [];
  for (const product of products) {
    if (
      !product ||
      typeof product !== 'object' ||
      typeof product.id !== 'string' ||
      product.id.length === 0 ||
      typeof product.slug !== 'string' ||
      product.slug.length === 0 ||
      !(
        product.retailPriceUgx === null ||
        (typeof product.retailPriceUgx === 'number' && Number.isFinite(product.retailPriceUgx))
      )
    ) {
      return {
        result: parityResult(truth, apiRows, 'CATALOGUE_COLLECTION_MALFORMED', 'api_collection'),
        products: [],
      };
    }
    apiRows.push({
      id: product.id,
      slug: product.slug,
      canonicalPriceUgx: product.retailPriceUgx as number | null,
    });
  }

  if (truth.totalEligible > 0 && apiRows.length === 0) {
    return {
      result: parityResult(truth, apiRows, 'CATALOGUE_DB_GT_ZERO_API_ZERO', 'api_collection'),
      products,
    };
  }
  if (apiRows.length !== truth.expectedPageCount) {
    return {
      result: parityResult(truth, apiRows, 'CATALOGUE_PAGE_COUNT_DIVERGENCE', 'api_collection'),
      products,
    };
  }
  if (hashCatalogueIdentifiers(apiRows) !== truth.identifierSetSha256) {
    return {
      result: parityResult(truth, apiRows, 'CATALOGUE_IDENTIFIER_DIVERGENCE', 'api_collection'),
      products,
    };
  }
  if (hashCatalogueIdentifiersAndPrices(apiRows) !== truth.identifierPriceSha256) {
    return {
      result: parityResult(truth, apiRows, 'CATALOGUE_PRICE_DIVERGENCE', 'api_collection'),
      products,
    };
  }

  return {
    result: parityResult(truth, apiRows, 'CATALOGUE_PARITY_OK', 'none'),
    products,
  };
}

export async function loadIndependentCatalogueTruth(
  limit = CATALOGUE_MONITOR_LIMIT,
): Promise<IndependentCatalogueTruth> {
  const targetResult = await db.execute(sql`
    select
      current_database()::text as "databaseName",
      current_schema()::text as "schemaName",
      current_setting('search_path')::text as "searchPath"
  `);
  const target = resultRows<{
    databaseName: string;
    schemaName: string;
    searchPath: string;
  }>(targetResult)[0];

  const countResult = await db.execute(sql`
    select count(*)::int as count
    from products p
    where p.approval_status = 'approved'
      and p.active = true
  `);
  const totalEligible = Number(resultRows<{ count: number | string }>(countResult)[0]?.count ?? 0);

  // This intentionally does not call the product repository or DTO mapper. It
  // mirrors the public route's tracked predicate and exact bounded request so
  // the monitor has an independent data-plane observation.
  const pageResult = await db.execute(sql`
    select
      p.id::text as id,
      p.slug::text as slug,
      case
        when p.has_retail_price then (
          select case when pp.retail_price > 0 then pp.retail_price else null end
          from product_prices pp
          where pp.product_id = p.id
          limit 1
        )
        else null
      end as "canonicalPriceUgx"
    from products p
    where p.approval_status = 'approved'
      and p.active = true
    -- The SAME total order the public route uses. Both sides used to take a
    -- LIMIT with no ORDER BY, so each got whatever physical order Postgres
    -- happened to return: they agreed by luck, and any row update could have
    -- made them disagree. With more eligible products than the page size, an
    -- unordered limit compares two DIFFERENT subsets and the hashes cannot
    -- match. Ordering both makes this check mean what it says.
    order by p.created_at desc, p.id asc
    limit ${limit}
  `);
  const page = resultRows<Record<string, unknown>>(pageResult).map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    canonicalPriceUgx:
      row.canonicalPriceUgx === null || row.canonicalPriceUgx === undefined
        ? null
        : Number(row.canonicalPriceUgx),
  }));

  return {
    databaseName: target.databaseName,
    schemaName: target.schemaName,
    searchPath: target.searchPath,
    predicateVersion: PUBLIC_CATALOGUE_PREDICATE_VERSION,
    totalEligible,
    expectedPageCount: page.length,
    page,
    identifierSetSha256: hashCatalogueIdentifiers(page),
    identifierPriceSha256: hashCatalogueIdentifiersAndPrices(page),
  };
}

export async function verifyCatalogueParity(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ truth: IndependentCatalogueTruth; result: CatalogueParityResult; products: Array<Record<string, unknown>> }> {
  const truth = await loadIndependentCatalogueTruth(CATALOGUE_MONITOR_LIMIT);
  const response = await fetchFn(`${baseUrl}/products?limit=${CATALOGUE_MONITOR_LIMIT}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const evaluated = evaluateCatalogueParity(
    truth,
    {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
    },
    {
      databaseName: databaseNameFromUrl(env.databaseUrl),
      schemaName: 'public',
    },
  );

  if (!evaluated.result.ok) {
    throw new CatalogueParityError(evaluated.result);
  }
  return { truth, ...evaluated };
}

// Prometheus Metrics for Synthetic Monitoring
const syntheticUptimeGauge = new client.Gauge({
  name: 'goldplus_synthetic_uptime',
  help: 'Uptime status of synthetic monitor checks (1 = Success, 0 = Failure)',
});

const syntheticDegradedGauge = new client.Gauge({
  name: 'goldplus_synthetic_degraded',
  help: 'Degraded state of synthetic monitor checks (1 = Degraded, 0 = Normal)',
});

const syntheticDuration = new client.Histogram({
  name: 'goldplus_synthetic_duration_seconds',
  help: 'Duration of the synthetic monitor checks in seconds',
  buckets: [1, 2.5, 5, 10, 15, 20, 30],
});

const syntheticFailures = new client.Counter({
  name: 'goldplus_synthetic_failures_total',
  help: 'Total number of synthetic monitor check failures',
  labelNames: ['failed_stage', 'failure_class'],
});

// Register metrics safely
const registerMetric = (m: client.Metric) => {
  try {
    client.register.registerMetric(m);
  } catch (err) {
    // Ignore already registered
  }
};

registerMetric(syntheticUptimeGauge);
registerMetric(syntheticDegradedGauge);
registerMetric(syntheticDuration);
registerMetric(syntheticFailures);

export class SyntheticMonitor {
  async execute(): Promise<{
    success: boolean;
    durationMs: number;
    stages: string[];
    reasonCode?: CatalogueParityReasonCode;
  }> {
    const start = Date.now();
    const stages: string[] = [];
    // THE monitor's own blind spot, fixed 2026-08-29.
    //
    // This probed env.publicApiBaseUrl — our PUBLIC hostname — from inside the
    // API container. Cloudflare answers a Node fetch to that host with a 403
    // challenge page, so every stage below failed on every run: the monitor
    // logged CRITICAL every five minutes on both replicas and told us nothing
    // about the shop, while a real outage would have looked identical.
    //
    // Same rule as the storefront stage just above, which already dials
    // http://web:4321: server-side traffic uses the internal address. The
    // monitor runs in the API process, so that is this process's own port.
    // SYNTHETIC_MONITOR_BASE_URL can override it for a one-off investigation.
    const baseUrl =
      process.env.SYNTHETIC_MONITOR_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    let isDegraded = false;

    // The mutating stages below place a REAL order, inject a REAL payment webhook and
    // generate REAL notification outbox rows. Against production that means a synthetic
    // paid order (and its emails/SMS) on every run, so they are OFF unless a dedicated
    // synthetic-safe environment explicitly opts in. When off, the read-only journey
    // (storefront, catalogue parity, PDP, recommendations) still runs and is the health
    // signal. This also stops the pre-credential cart-add call from emitting a false
    // CRITICAL every run.
    const writeStagesEnabled = process.env.SYNTHETIC_MONITOR_WRITE_STAGES_ENABLED === 'true';

    try {
      // Stage 0: Storefront Uptime & HTML Structure Check
      stages.push('storefront_html_check');
      const storefrontUrl = 'http://web:4321'; // Resolve web container internally inside Docker Compose network
      try {
        const storefrontRes = await fetch(storefrontUrl, {
          signal: AbortSignal.timeout(5000),
        });
        if (!storefrontRes.ok) {
          logger.warn({ status: storefrontRes.status }, '[SyntheticMonitor] Storefront internal page check failed');
        } else {
          const storefrontHtml = await storefrontRes.text();
          // Only a CONFIGURED container can go missing. Analytics is optional
          // and deliberately unprovisioned here, and warning every run about a
          // feature nobody has turned on is how a log stops being read — the
          // real warnings get buried in it. When an id is set, its absence
          // from the HTML is a genuine regression and still warns.
          const gtmConfigured = Boolean(process.env.PUBLIC_GTM_ID?.trim());
          if (gtmConfigured && !storefrontHtml.includes('googletagmanager.com') && !storefrontHtml.includes('gtm')) {
            logger.warn(
              { gtmId: 'configured' },
              '[SyntheticMonitor] Storefront loaded, but the configured Google Tag Manager container was missing in HTML',
            );
          }
        }
      } catch (e) {
        logger.warn({ err: e }, '[SyntheticMonitor] Web storefront node could not be reached internally');
        isDegraded = true;
      }

      // Stage 1: Load Products (simulate homepage/catalog view)
      stages.push('catalog_load');
      const catalogStart = Date.now();
      const catalogueParity = await verifyCatalogueParity(baseUrl);
      const productsList = catalogueParity.products as any[];
      logger.info(
        {
          reasonCode: catalogueParity.result.reasonCode,
          firstDivergentLayer: catalogueParity.result.firstDivergentLayer,
          databaseFingerprintSha256: catalogueParity.result.databaseFingerprintSha256,
          sqlCount: catalogueParity.result.sqlCount,
          apiCount: catalogueParity.result.apiCount,
          sqlIdentifierSetSha256: catalogueParity.result.sqlIdentifierSetSha256,
          apiIdentifierSetSha256: catalogueParity.result.apiIdentifierSetSha256,
          sqlIdentifierPriceSha256: catalogueParity.result.sqlIdentifierPriceSha256,
          apiIdentifierPriceSha256: catalogueParity.result.apiIdentifierPriceSha256,
        },
        '[SyntheticMonitor] Catalogue SQL/API parity verified',
      );
      const catalogDuration = Date.now() - catalogStart;
      if (catalogDuration > 1500) {
        isDegraded = true;
        logger.warn({ catalogDuration }, '[SyntheticMonitor] Catalog load exceeded P95 response window (1.5s)');
      }

      // Stage 1b: Fetch Recommendations Check
      stages.push('recommendation_fetch');
      const recStart = Date.now();
      const recRes = await fetch(`${baseUrl}/recommendations?placement=home_trending&limit=3`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!recRes.ok) {
        throw new Error(`Recommendation fetch failed with status: ${recRes.status}`);
      }
      const recData = await recRes.json() as any;
      if (!recData?.success || !Array.isArray(recData?.data?.items)) {
        throw new Error('Recommendation API returned invalid/malformed recommendations');
      }
      const recDuration = Date.now() - recStart;
      if (recDuration > 1500) {
        isDegraded = true;
        logger.warn({ recDuration }, '[SyntheticMonitor] Recommendation fetch exceeded P95 response window (1.5s)');
      }

      // Stage 2: Load Specific PDP
      stages.push('pdp_load');
      const testProduct = productsList[0];
      const pdpStart = Date.now();
      const pdpRes = await fetch(`${baseUrl}/products/${testProduct.slug}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!pdpRes.ok) {
        throw new Error(`PDP load failed for slug "${testProduct.slug}" with status: ${pdpRes.status}`);
      }
      const pdpDuration = Date.now() - pdpStart;
      if (pdpDuration > 1500) {
        isDegraded = true;
        logger.warn({ pdpDuration }, '[SyntheticMonitor] PDP load exceeded P95 response window (1.5s)');
      }

      // Read-only journey complete. The mutating stages that follow are gated: in any
      // environment that has not explicitly opted in, return success on the read path
      // rather than driving a synthetic purchase through production.
      if (!writeStagesEnabled) {
        const durationMs = Date.now() - start;
        syntheticDuration.observe(durationMs / 1000);
        syntheticUptimeGauge.set(1);
        syntheticDegradedGauge.set(isDegraded ? 1 : 0);
        logger.info(
          { durationMs, stages, isDegraded, writeStagesSkipped: true },
          '[SyntheticMonitor] Read-only commerce journey completed; mutating stages disabled in this environment',
        );
        return { success: true, durationMs, stages };
      }

      // Stage 2b: Add Item to Cart Simulation
      stages.push('add_to_cart');
      const cartId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      const cartStart = Date.now();
      const cartRes = await fetch(`${baseUrl}/commerce/cart/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cartId,
          item: {
            productId: testProduct.id,
            quantity: 1,
            price: Number(testProduct.price || 100),
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!cartRes.ok) {
        throw new Error(`Cart addition failed with status: ${cartRes.status}`);
      }
      const cartDuration = Date.now() - cartStart;
      if (cartDuration > 1500) {
        isDegraded = true;
        logger.warn({ cartDuration }, '[SyntheticMonitor] Cart addition exceeded P95 response window (1.5s)');
      }

      // Stage 3: Initiate Checkout Simulation
      stages.push('checkout_initiate');
      const checkoutStart = Date.now();
      const checkoutBody = {
        customerEmail: 'synthetic-buyer@shopgoldplus.com',
        customerName: 'Synthetic Buyer Bot',
        customerPhone: '256700000000',
        shippingAddress: {
          district: 'Kampala',
          town: 'Central',
          addressLine: 'Plot 10 Kampala Road',
        },
        items: [
          {
            productId: testProduct.id,
            quantity: 1,
          },
        ],
      };

      const checkoutRes = await fetch(`${baseUrl}/commerce/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(checkoutBody),
        signal: AbortSignal.timeout(5000),
      });

      if (!checkoutRes.ok) {
        throw new Error(`Checkout API failed with status ${checkoutRes.status}`);
      }

      const checkoutData = await checkoutRes.json() as any;
      const orderId = checkoutData?.data?.orderId || checkoutData?.data?.order?.id;
      if (!orderId) {
        throw new Error('Checkout API response did not return an order ID');
      }
      const checkoutDuration = Date.now() - checkoutStart;
      if (checkoutDuration > 3000) {
        isDegraded = true;
        logger.warn({ checkoutDuration }, '[SyntheticMonitor] Checkout creation exceeded P95 response window (3s)');
      }

      // Stage 4: Simulate Payment Callback Ingestion
      stages.push('payment_webhook');
      const webhookPayload = {
        orderId,
        providerReference: `SYNTH-TX-${Date.now()}`,
        amount: Number(testProduct.price || 100),
        outcome: 'SUCCESS',
        idempotencyKey: `synth-idem-${orderId}`,
      };

      const webhookRes = await fetch(`${baseUrl}/webhooks/payment/mtn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': webhookPayload.idempotencyKey,
        },
        body: JSON.stringify(webhookPayload),
        signal: AbortSignal.timeout(5000),
      });

      if (!webhookRes.ok) {
        throw new Error(`Payment webhook injection failed with status ${webhookRes.status}`);
      }

      // Stage 4b: Replay Payment Webhook (Verify Idempotent Duplicate Request Behavior)
      stages.push('payment_webhook_replay');
      const replayRes = await fetch(`${baseUrl}/webhooks/payment/mtn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': webhookPayload.idempotencyKey,
        },
        body: JSON.stringify(webhookPayload),
        signal: AbortSignal.timeout(5000),
      });
      if (!replayRes.ok) {
        throw new Error(`Payment webhook replay (idempotency check) failed with status: ${replayRes.status}`);
      }

      // Stage 5: Verify Order Ingestion and Telemetry Durability
      stages.push('telemetry_verification');
      
      let verified = false;
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        
        const [orderRecord] = await db
          .select({ status: orders.paymentStatus })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);

        const telemetryRecord = await db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.idempotencyKey, `purchase:${webhookPayload.providerReference}`))
          .limit(1);

        if (orderRecord?.status === 'paid' && telemetryRecord.length > 0) {
          verified = true;
          break;
        }
      }

      if (!verified) {
        throw new Error('Synthetic purchase verification timed out: order status or telemetry outbox missing');
      }

      // Stage 5b: Verify Notification Outbox Generation
      stages.push('notification_outbox_check');
      const notifRecords = await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.relatedEntity, 'order'),
            eq(outboxEvents.relatedEntityId, orderId)
          )
        );
      
      if (notifRecords.length === 0) {
        throw new Error('Notification outbox records were not generated for checkout');
      }

      const durationMs = Date.now() - start;
      syntheticDuration.observe(durationMs / 1000);
      syntheticUptimeGauge.set(1);
      syntheticDegradedGauge.set(isDegraded ? 1 : 0);

      logger.info({ durationMs, stages, isDegraded }, '[SyntheticMonitor] Commerce journey completed successfully');
      
      return {
        success: true,
        durationMs,
        stages,
      };

    } catch (err: any) {
      const durationMs = Date.now() - start;
      const failedStage = stages[stages.length - 1] || 'unknown';
      const catalogueParityResult = err instanceof CatalogueParityError ? err.result : undefined;
      let failureClass = 'ASSERTION_FAILED';
      const msg = err.message || String(err);
      
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('ECONNREFUSED')) {
        failureClass = 'NETWORK_ERROR';
      } else if (msg.includes('db') || msg.includes('select') || msg.includes('insert') || msg.includes('drizzle') || msg.includes('postgres')) {
        failureClass = 'DATABASE_ERROR';
      } else if (msg.includes('redis') || msg.includes('ioredis') || msg.includes('Queue')) {
        failureClass = 'REDIS_ERROR';
      } else if (msg.includes('gtm') || msg.includes('sgtm')) {
        failureClass = 'GTM_ERROR';
      } else if (msg.includes('telemetry') || msg.includes('Telemetry')) {
        failureClass = 'TELEMETRY_ERROR';
      } else if (msg.includes('payment') || msg.includes('pesapal')) {
        failureClass = 'PAYMENT_ERROR';
      } else if (msg.includes('email') || msg.includes('sms') || msg.includes('zeptomail') || msg.includes('whatsapp')) {
        failureClass = 'EXTERNAL_API_ERROR';
      } else if (msg.includes('timeout') || msg.includes('timeout exceeded')) {
        failureClass = 'TIMEOUT';
      } else if (msg.includes('degraded') || msg.includes('budget exceeded') || isDegraded) {
        failureClass = 'DEGRADED_PERFORMANCE';
      }

      logger.error(
        {
          err,
          durationMs,
          failedStage,
          failureClass,
          reasonCode: catalogueParityResult?.reasonCode,
          firstDivergentLayer: catalogueParityResult?.firstDivergentLayer,
          databaseFingerprintSha256: catalogueParityResult?.databaseFingerprintSha256,
          sqlCount: catalogueParityResult?.sqlCount,
          apiCount: catalogueParityResult?.apiCount,
          sqlIdentifierSetSha256: catalogueParityResult?.sqlIdentifierSetSha256,
          apiIdentifierSetSha256: catalogueParityResult?.apiIdentifierSetSha256,
          sqlIdentifierPriceSha256: catalogueParityResult?.sqlIdentifierPriceSha256,
          apiIdentifierPriceSha256: catalogueParityResult?.apiIdentifierPriceSha256,
        },
        '[SyntheticMonitor] CRITICAL: Synthetic commerce check failed!',
      );
      
      syntheticUptimeGauge.set(0);
      syntheticFailures.inc({ failed_stage: failedStage, failure_class: failureClass });

      return {
        success: false,
        durationMs,
        stages,
        reasonCode: catalogueParityResult?.reasonCode,
      };
    }
  }
}

import { Registry } from '../Registry';
import { db } from '../db/client';
import { orders } from '../db/schema/commerce';
import { outboxEvents } from '../db/schema/system';
import { eq, and } from 'drizzle-orm';
import { logger } from '../logging/logger';
import { env } from '../../config/env';
import * as client from 'prom-client';

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
  async execute(): Promise<{ success: boolean; durationMs: number; stages: string[] }> {
    const start = Date.now();
    const stages: string[] = [];
    const baseUrl = env.publicApiBaseUrl || 'http://localhost:3000';
    let isDegraded = false;

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
          if (!storefrontHtml.includes('googletagmanager.com') && !storefrontHtml.includes('gtm')) {
            logger.warn('[SyntheticMonitor] Storefront loaded, but Google Tag Manager container was missing in HTML');
          }
        }
      } catch (e) {
        logger.warn({ err: e }, '[SyntheticMonitor] Web storefront node could not be reached internally');
        isDegraded = true;
      }

      // Stage 1: Load Products (simulate homepage/catalog view)
      stages.push('catalog_load');
      const catalogStart = Date.now();
      const catalogRes = await fetch(`${baseUrl}/products?limit=5`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!catalogRes.ok) {
        throw new Error(`Catalog load failed with status: ${catalogRes.status}`);
      }
      const catalogData = await catalogRes.json() as any;
      const productsList = catalogData?.data?.items || [];
      if (productsList.length === 0) {
        throw new Error('Catalog returned zero products');
      }
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

      logger.error({ err, durationMs, failedStage, failureClass }, '[SyntheticMonitor] CRITICAL: Synthetic commerce check failed!');
      
      syntheticUptimeGauge.set(0);
      syntheticFailures.inc({ failed_stage: failedStage, failure_class: failureClass });

      return {
        success: false,
        durationMs,
        stages,
      };
    }
  }
}

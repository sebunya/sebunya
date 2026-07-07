import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { PERMISSIONS } from '@goldplus/shared';
import { db } from '../../../../infrastructure/db/client';
import { telemetryDeadLetterQueue } from '../../../../infrastructure/db/schema/telemetry';
import { consentRecords, consentCurrentState } from '../../../../infrastructure/db/schema/consent';
import { attributionTouchpoints } from '../../../../infrastructure/db/schema/measurement';
import { outboxEvents } from '../../../../infrastructure/db/schema/system';
import { attributionService } from '../../../../application/use-cases/measurement/AttributionService';
import { consentService } from '../../../../application/use-cases/measurement/ConsentService';
import { conversionRouter } from '../../../../infrastructure/measurement/ConversionRouter';
import { eq, desc, lte, gte, and, count, sql } from 'drizzle-orm';
import { logger } from '../../../../infrastructure/logging/logger';

const routes = new Hono();

// All admin measurement routes require auth
routes.use('*', authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/overview — high-level dashboard metrics
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/overview', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const [matchQuality, dlqCount, consentCount] = await Promise.all([
      attributionService.getMatchQualitySummary(7),
      db.select({ count: count() }).from(telemetryDeadLetterQueue)
        .where(eq(telemetryDeadLetterQueue.isResolved, false)),
      db.select({ count: count() }).from(consentCurrentState),
    ]);

    // Consent breakdown
    const consentBreakdown = await db.select({
      analyticsGranted:       consentCurrentState.analyticsGranted,
      advertisingGranted:     consentCurrentState.advertisingGranted,
      personalizationGranted: consentCurrentState.personalizationGranted,
    }).from(consentCurrentState);

    const totalConsent = consentBreakdown.length;
    const analyticsGranted = consentBreakdown.filter(r => r.analyticsGranted).length;
    const advertisingGranted = consentBreakdown.filter(r => r.advertisingGranted).length;
    const personalizationGranted = consentBreakdown.filter(r => r.personalizationGranted).length;

    // Outbox measurement queue health
    const [pendingOutbox] = await db.select({ count: count() }).from(outboxEvents)
      .where(and(
        eq(outboxEvents.eventType, 'TELEMETRY_DISPATCH'),
        eq(outboxEvents.isProcessed, false),
      ));

    return c.json({
      success: true,
      data: {
        matchQuality,
        dlq: {
          unresolvedCount: dlqCount[0]?.count ?? 0,
        },
        consent: {
          totalIdentities:        totalConsent,
          analyticsGrantedPct:    totalConsent > 0 ? Math.round((analyticsGranted / totalConsent) * 100) : 0,
          advertisingGrantedPct:  totalConsent > 0 ? Math.round((advertisingGranted / totalConsent) * 100) : 0,
          personalizationGrantedPct: totalConsent > 0 ? Math.round((personalizationGranted / totalConsent) * 100) : 0,
        },
        outbox: {
          pendingTelemetryEvents: pendingOutbox?.count ?? 0,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, '[AdminMeasurement] Overview failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/dlq — list unresolved DLQ entries
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/dlq', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const rows = await db
      .select()
      .from(telemetryDeadLetterQueue)
      .where(eq(telemetryDeadLetterQueue.isResolved, false))
      .orderBy(desc(telemetryDeadLetterQueue.failedAt))
      .limit(100);

    return c.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, '[AdminMeasurement] DLQ list failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/measurement/dlq/:id/replay — replay a DLQ entry
// ─────────────────────────────────────────────────────────────────────────────

routes.post('/dlq/:id/replay', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ success: false, error: 'MISSING_ID' }, 400);

  try {
    const [dlqEntry] = await db
      .select()
      .from(telemetryDeadLetterQueue)
      .where(eq(telemetryDeadLetterQueue.id, id))
      .limit(1);

    if (!dlqEntry) {
      return c.json({ success: false, error: 'NOT_FOUND' }, 404);
    }

    if (dlqEntry.isResolved) {
      return c.json({ success: false, error: 'ALREADY_RESOLVED' }, 400);
    }

    // Re-enqueue the payload into the outbox
    await db.insert(outboxEvents).values({
      eventType:      'TELEMETRY_DISPATCH',
      payload:        dlqEntry.payload as any,
      idempotencyKey: `dlq-replay:${dlqEntry.eventId}:${Date.now()}`,
      status:         'pending',
      dryRunOnly:     false,
    });

    // Mark DLQ entry resolved
    await db.update(telemetryDeadLetterQueue)
      .set({ isResolved: true, resolvedAt: new Date(), resolvedNote: 'Manual replay via admin' })
      .where(eq(telemetryDeadLetterQueue.id, id));

    logger.info({ dlqId: id, eventId: dlqEntry.eventId }, '[AdminMeasurement] DLQ entry replayed');
    return c.json({ success: true, message: 'DLQ entry re-enqueued for dispatch' });
  } catch (err) {
    logger.error({ err, dlqId: id }, '[AdminMeasurement] DLQ replay failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/consent-audit — paginated consent audit trail
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/consent-audit', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const limitParam = parseInt(c.req.query('limit') || '50', 10);
    const limit = Math.min(Math.max(limitParam, 1), 200);

    const rows = await db
      .select()
      .from(consentRecords)
      .orderBy(desc(consentRecords.createdAt))
      .limit(limit);

    return c.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, '[AdminMeasurement] Consent audit list failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/match-quality — match quality summary
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/match-quality', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const days = parseInt(c.req.query('days') || '7', 10);

  try {
    const summary = await attributionService.getMatchQualitySummary(days);
    return c.json({ success: true, data: summary });
  } catch (err) {
    logger.error({ err }, '[AdminMeasurement] Match quality summary failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/measurement/attribution/:orderId — attribution for specific order
// ─────────────────────────────────────────────────────────────────────────────

routes.get('/attribution/:orderId', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const orderId = c.req.param('orderId');
  if (!orderId) return c.json({ success: false, error: 'MISSING_ORDER_ID' }, 400);

  try {
    const report = await attributionService.getAttributionReport(orderId);
    if (!report) {
      return c.json({ success: false, error: 'NOT_FOUND' }, 404);
    }
    return c.json({ success: true, data: report });
  } catch (err) {
    logger.error({ err, orderId }, '[AdminMeasurement] Attribution report failed');
    return c.json({ success: false, error: 'INTERNAL_ERROR' }, 500);
  }
});

export default routes;

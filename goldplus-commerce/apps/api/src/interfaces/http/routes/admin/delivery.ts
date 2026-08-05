import { Hono } from 'hono';
import { PERMISSIONS, ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import {
  DELIVERY_CONFIG_REGISTRY,
  LAUNCH_KEYS,
  validateConfigValue,
} from '../../../../domain/delivery/DeliveryConfigRegistry';
import { missingLaunchKeys } from '../../../../domain/delivery/DeliveryModel';

/**
 * Delivery admin (brief v7, stages A–B).
 *
 * The Control Centre proper is stage E. What lives here now is the part that
 * cannot wait: the rider-cost entry path, without which the calibration in
 * PART 4 never starts, and a read of the launch-value state so the team can
 * see exactly what is blocking activation.
 *
 * Guard strings come from the PERMISSIONS vocabulary. Reading the setup state
 * is a report; entering a cost figure that will feed pricing is a mutation.
 */
// audit-exempt: the one write here (actual-cost) is audited inside
// RecordActualRiderCostUseCase, which records the before and after values —
// auditing again at the route would double-log and would put the audit in the
// wrong layer. The other POST validates a value without saving anything.
const routes = new Hono();
routes.use('*', authMiddleware);

/**
 * What is stopping the module quoting. Six unset values is a message on a
 * dashboard, not a blocker for a whole build — this is that message.
 */
routes.get('/setup', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const [origins] = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`select count(*) filter (where active)::int as active, count(*)::int as total from delivery_origin`,
  )) as unknown as Array<{ active: number; total: number }>;
  const [corridors] = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`
      select count(*)::int as areas,
             count(*) filter (where access_mode = 'water')::int as water,
             count(*) filter (where not serviceable)::int as unserviceable
      from delivery_corridor`,
  )) as unknown as Array<{ areas: number; water: number; unserviceable: number }>;

  // The launch values live in the config tables; none are set yet, so this
  // reports every one as missing rather than inventing a value to show.
  const live = await registry.deliveryConfigReader.currentValues().catch(() => ({} as Record<string, string>));
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(live)) {
    const n = Number(v);
    if (Number.isFinite(n)) numeric[k] = n;
  }
  const missing = missingLaunchKeys(numeric);

  return c.json({
    success: true,
    data: {
      quotingEnabled: missing.length === 0 && origins.active > 0,
      blockedBy: missing.length > 0 ? 'CONFIG_INCOMPLETE' : origins.active === 0 ? 'NO_ACTIVE_ORIGIN' : null,
      launchValues: LAUNCH_KEYS.map((key) => {
        const entry = DELIVERY_CONFIG_REGISTRY.find((e) => e.key === key)!;
        return {
          key,
          label: entry.label,
          unit: entry.unit,
          help: entry.help,
          value: live[key] ?? null,
          set: !missing.includes(key),
        };
      }),
      origins,
      corridors,
    },
  });
});

/**
 * Record what a delivery actually cost.
 *
 * ORDERS_MANAGE rather than a reporting right: this figure feeds the margin
 * report and every future recalibration, so it is a mutation of pricing input,
 * not an observation.
 */
routes.post('/orders/:orderId/actual-cost', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = Number(body?.actualRiderCostUgx);
  const result = await Registry.getInstance().recordActualRiderCostUseCase.execute({
    orderId: String(c.req.param('orderId') ?? ''),
    actualRiderCostUgx: Number.isFinite(raw) ? raw : Number.NaN,
    actorId: (c.get('user') as { id: string }).id,
    note: typeof body?.note === 'string' ? body.note.slice(0, 500) : null,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: result.row });
});

/** The queue: delivered orders nobody has costed yet. */
routes.get('/awaiting-cost', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const rows = await Registry.getInstance().listDeliveriesAwaitingCostUseCase.execute(100);
  return c.json({ success: true, data: rows });
});

/** The registry itself, so the Control Centre UI can generate from it. */
routes.get('/config-registry', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  return c.json({
    success: true,
    data: DELIVERY_CONFIG_REGISTRY.filter((e) => e.tier !== 3).map((e) => ({
      key: e.key,
      tier: e.tier,
      type: e.type,
      unit: e.unit,
      mandatory: e.mandatory,
      defaultValue: e.defaultValue,
      min: e.min ?? null,
      max: e.max ?? null,
      label: e.label,
      help: e.help,
    })),
  });
});

/** Validate a value without saving it, so the UI can refuse before publish. */
routes.post('/config-validate', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const key = String(body?.key ?? '');
  const value = String(body?.value ?? '');
  const result = validateConfigValue(key, value);
  return c.json({ success: true, data: result });
});

export default routes;

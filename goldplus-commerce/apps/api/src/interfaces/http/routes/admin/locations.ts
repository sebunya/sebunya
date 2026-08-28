import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Admin Locations section (brief PART J.1), guarded per the approved stage-1
 * permission table — existing vocabulary only, mutating views take mutating
 * permissions:
 *   unresolved searches   read reports.read   promote  settings.manage
 *   address review queue  read orders.read    resolve  orders.manage
 *   landmark manager      read reports.read   mutate   settings.manage
 *   pickup point manager  read reports.read   mutate   settings.manage
 *   zone configuration    read pricing.read   save     pricing.manage
 *   known data defects    read reports.read   (read-only by design)
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const actor = (c: { get(k: string): unknown }) => (c.get('user') as { id: string }).id;

// ── Unresolved searches ──────────────────────────────────────────────────
routes.get('/misses', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const data = await Registry.getInstance().listSearchMissesUseCase.execute(Number(c.req.query('limit') ?? 100));
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/misses/promote', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.query || !body?.areaSlug) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'query and areaSlug are required.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const actorId = actor(c);
  const result = await registry.promoteSearchMissToAliasUseCase.execute({
    query: String(body.query),
    areaSlug: String(body.areaSlug),
    confidence: ['exact', 'strong', 'approximate'].includes(body.confidence) ? body.confidence : 'strong',
    actorId,
    note: body.note ? String(body.note) : null,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId,
    action: 'LOCATION_ALIAS_PROMOTED',
    entity: 'ug_area_alias',
    entityId: String(body.areaSlug),
    newState: { query: body.query, areaSlug: body.areaSlug, confidence: body.confidence ?? 'strong', created: result.created, resolvedMisses: result.resolvedMisses },
  });
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

// ── Address review queue ─────────────────────────────────────────────────
routes.get('/review-queue', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const data = await Registry.getInstance().listAddressReviewQueueUseCase.execute(actor(c), Number(c.req.query('limit') ?? 100));
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/review-queue/:addressId/resolve', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.areaSlug) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'areaSlug is required.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const actorId = actor(c);
  const result = await registry.resolveAddressUseCase.execute({
    addressId: String(c.req.param('addressId')),
    areaSlug: String(body.areaSlug),
    actorId,
    note: body.note ? String(body.note) : null,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  // Ops can promote the raw text into an alias in the same action (PART J.1).
  if (body.alsoCreateAlias && body.aliasQuery) {
    await registry.promoteSearchMissToAliasUseCase.execute({
      query: String(body.aliasQuery),
      areaSlug: String(body.areaSlug),
      confidence: 'approximate',
      actorId,
      note: 'created from address resolution',
    });
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId,
    action: 'LOCATION_ADDRESS_RESOLVED',
    entity: 'address',
    entityId: String(c.req.param('addressId')),
    newState: { areaSlug: body.areaSlug },
  });
  return c.json({ success: true, data: { resolved: true } } satisfies ApiResponse<{ resolved: boolean }>);
});

// ── Landmark manager ─────────────────────────────────────────────────────
routes.get('/landmarks', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const data = await Registry.getInstance().manageLandmarksUseCase.list(c.req.query('areaSlug') ?? null);
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.put('/landmarks', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.areaSlug || !body?.name || !body?.landmarkType) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'areaSlug, name and landmarkType are required.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const result = await registry.manageLandmarksUseCase.upsert({
    areaSlug: String(body.areaSlug),
    name: String(body.name),
    landmarkType: String(body.landmarkType),
    verified: body.verified === undefined ? undefined : Boolean(body.verified),
    gpsLat: typeof body.gpsLat === 'number' ? body.gpsLat : undefined,
    gpsLng: typeof body.gpsLng === 'number' ? body.gpsLng : undefined,
  });
  if ('error' in result) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: result.error } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actor(c),
    action: 'LOCATION_LANDMARK_UPSERTED',
    entity: 'ug_landmark',
    entityId: result.id,
    newState: { areaSlug: result.areaSlug, name: result.name, verified: result.verified },
  });
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

routes.post('/landmarks/:id/verify', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // Explicit boolean: anything that was not literally false used to read as true.
  if (typeof body?.verified !== 'boolean') {
    return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'verified must be true or false.' } } satisfies ApiResponse<never>, 400);
  }
  const verified: boolean = body.verified;
  const ok = await Registry.getInstance().manageLandmarksUseCase.verify(String(c.req.param('id')), verified);
  if (!ok) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Landmark not found.' } } satisfies ApiResponse<never>, 404);
  // Verification is the trust signal riders and address resolution rely on, and
  // this is its only writer. Every sibling mutation in this file audits.
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId: actor(c),
    action: 'LOCATION_LANDMARK_VERIFIED',
    entity: 'ug_landmark',
    entityId: String(c.req.param('id')),
    newState: { verified },
  });
  return c.json({ success: true, data: { verified } } satisfies ApiResponse<{ verified: boolean }>);
});

routes.post('/landmarks/merge', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.keepId || !body?.mergeId) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'keepId and mergeId are required.' } } satisfies ApiResponse<never>, 400);
  }
  const ok = await Registry.getInstance().manageLandmarksUseCase.merge(String(body.keepId), String(body.mergeId));
  if (!ok) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'One of the landmarks was not found.' } } satisfies ApiResponse<never>, 404);
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId: actor(c),
    action: 'LOCATION_LANDMARKS_MERGED',
    entity: 'ug_landmark',
    entityId: String(body.keepId),
    newState: { mergedFrom: body.mergeId },
  });
  return c.json({ success: true, data: { merged: true } } satisfies ApiResponse<{ merged: boolean }>);
});

// ── Pickup point manager ─────────────────────────────────────────────────
routes.get('/pickup-points', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const data = await Registry.getInstance().managePickupPointsUseCase.list();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.put('/pickup-points', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name || !body?.operator) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'name and operator are required.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const result = await registry.managePickupPointsUseCase.upsert({
    id: body.id ? String(body.id) : undefined,
    name: String(body.name),
    operator: String(body.operator),
    areaSlug: body.areaSlug ? String(body.areaSlug) : null,
    physicalAddress: body.physicalAddress ? String(body.physicalAddress) : null,
    landmarkText: body.landmarkText ? String(body.landmarkText) : null,
    phone: body.phone ? String(body.phone) : null,
    openingHours: body.openingHours ?? null,
    servesDistricts: Array.isArray(body.servesDistricts) ? body.servesDistricts.map(String) : null,
    notes: body.notes ? String(body.notes) : null,
  });
  if ('error' in result) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: result.error } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actor(c),
    action: 'LOCATION_PICKUP_POINT_UPSERTED',
    entity: 'ug_pickup_point',
    entityId: result.id,
    newState: { name: result.name, operator: result.operator, active: result.active },
  });
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

routes.post('/pickup-points/:id/active', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const active = Boolean(body?.active);
  const ok = await Registry.getInstance().managePickupPointsUseCase.setActive(String(c.req.param('id')), active);
  if (!ok) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Pickup point not found.' } } satisfies ApiResponse<never>, 404);
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId: actor(c),
    action: 'LOCATION_PICKUP_POINT_TOGGLED',
    entity: 'ug_pickup_point',
    entityId: String(c.req.param('id')),
    newState: { active },
  });
  return c.json({ success: true, data: { active } } satisfies ApiResponse<{ active: boolean }>);
});

// ── Zone configuration (policy — fees stay with delivery_zones/decision #7) ─
routes.get('/zones', requirePermissions([PERMISSIONS.PRICING_READ]), async (c) => {
  const data = await Registry.getInstance().getZonePoliciesUseCase.execute();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.put('/zones/:zoneCode', requirePermissions([PERMISSIONS.PRICING_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const actorId = actor(c);
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const result = await registry.saveZonePolicyUseCase.execute({
    zoneCode: String(c.req.param('zoneCode')),
    zoneName: String(body.zoneName ?? c.req.param('zoneCode')),
    slaHoursMin: num(body.slaHoursMin),
    slaHoursMax: num(body.slaHoursMax),
    fallbackFeeUgx: num(body.fallbackFeeUgx),
    freeDeliveryThresholdUgx: num(body.freeDeliveryThresholdUgx),
    codAllowed: body.codAllowed === null || body.codAllowed === undefined ? null : Boolean(body.codAllowed),
    codMaxOrderValueUgx: num(body.codMaxOrderValueUgx),
    prepayRequiredAboveUgx: num(body.prepayRequiredAboveUgx),
    carrier: body.carrier ? String(body.carrier) : null,
    active: Boolean(body.active),
    updatedBy: actorId,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message, details: result.missing } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId,
    action: 'LOCATION_ZONE_POLICY_SAVED',
    entity: 'delivery_zone_policy',
    entityId: result.policy.zoneCode,
    newState: result.policy,
  });
  return c.json({ success: true, data: result.policy } satisfies ApiResponse<typeof result.policy>);
});

// ── Known data defects (read-only by design) ─────────────────────────────
routes.get('/data-exceptions', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const data = await Registry.getInstance().listDataExceptionsUseCase.execute();
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

export default routes;

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

// Audit entity ids are uuids; the loyalty config is a singleton, so it gets a
// fixed, well-known uuid rather than a free-text marker.
const LOYALTY_CONFIG_AUDIT_ID = '00000000-0000-4000-8000-00000000106a';

/**
 * Slice 8: loyalty programme administration. Config edits are preparation
 * only — customer-facing activation additionally requires the
 * LOYALTY_PROGRAMME_ENABLED environment flag, which stays off.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/config', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const config = await registry.getLoyaltyConfigUseCase.execute();
  const envFlag = process.env.LOYALTY_PROGRAMME_ENABLED === 'true';
  return c.json({ success: true, data: { ...config, envFlag, active: envFlag && config.enabled } });
});

routes.get('/operations', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  const data = await Registry.getInstance().getLoyaltyOperationsUseCase.execute({
    limit: Number.isInteger(limit) ? limit : 50,
  });
  return c.json({ success: true, data });
});

routes.post('/accounts/:id/expire', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const accountId = String(c.req.param('id') ?? '');
  const entries = await registry.expireLoyaltyPointsUseCase.execute({ accountId });
  for (const entry of entries) {
    await new CreateAuditLogUseCase(registry.auditRepo).execute({
      actorId: (c.get('user') as any).id,
      action: 'LOYALTY_POINTS_EXPIRED',
      entity: 'loyalty_ledger_entry',
      entityId: entry.id,
      newState: { accountId: entry.accountId, points: entry.points, sourceEntryId: entry.reversedEntryId },
    });
  }
  return c.json({ success: true, data: { expiredCount: entries.length, entries } });
});

routes.put('/config', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const result = await registry.saveLoyaltyConfigUseCase.execute(body);
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_CONFIG_SAVED',
    entity: 'loyalty_config',
    entityId: LOYALTY_CONFIG_AUDIT_ID,
    newState: { ...result.value },
  });
  return c.json({ success: true, data: result.value });
});

routes.post('/entries/:id/reverse', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const registry = Registry.getInstance();
  const result = await registry.reverseLoyaltyEntryUseCase.execute({
    entryId: String(c.req.param('id') ?? ''),
    reason: String(body?.reason ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_ENTRY_REVERSED',
    entity: 'loyalty_ledger_entry',
    entityId: result.value.id,
    newState: { reversedEntryId: result.value.reversedEntryId, points: result.value.points },
  });
  return c.json({ success: true, data: result.value });
});

// ---- Gamification scaffold (§32 tail) -----------------------------------
// Definitions + DRY evaluation over real commerce data. Awards are refused with
// LOYALTY_DORMANT while loyalty_config.enabled is false — the award ledger stays
// empty until activation, matching the loyalty core's own rule.

routes.get('/gamification', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const data = await registry.gamificationRepo.listMissions();
  const loyaltyEnabled = await registry.gamificationRepo.loyaltyEnabled();
  return c.json({ success: true, data: { ...data, loyaltyEnabled, awardsBlockedReason: loyaltyEnabled ? null : 'LOYALTY_DORMANT' } });
});

routes.post('/gamification/missions', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
  const key = clean(body?.key, 60).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const title = clean(body?.title, 200);
  const kind = clean(body?.kind, 30);
  const threshold = Number(body?.threshold);
  const rewardPoints = Number(body?.rewardPoints) || 0;
  if (!key || !title || !['PURCHASE_COUNT','REVIEW_COUNT','STREAK_DAYS','REFERRAL_COUNT'].includes(kind) || !Number.isInteger(threshold) || threshold < 1) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'key, title, valid kind and integer threshold >= 1 are required.' } }, 400);
  }
  const registry = Registry.getInstance();
  const row = await registry.gamificationRepo.createMission({ key, title, description: clean(body?.description, 500) || null, kind, threshold, rewardPoints, createdBy: (c.get('user') as any).id });
  if (!row) return c.json({ success: false, error: { code: 'DUPLICATE', message: 'A mission with this key already exists.' } }, 409);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: 'GAMIFICATION_MISSION_CREATED', entity: 'gamification_mission', entityId: row.id, newState: { key, kind, threshold, rewardPoints } });
  return c.json({ success: true, data: row });
});

routes.post('/gamification/badges', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
  const key = clean(body?.key, 60).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const title = clean(body?.title, 200);
  if (!key || !title) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'key and title are required.' } }, 400);
  const registry = Registry.getInstance();
  const row = await registry.gamificationRepo.createBadge({ key, title, description: clean(body?.description, 500) || null, missionId: typeof body?.missionId === 'string' && body.missionId ? body.missionId : null });
  if (!row) return c.json({ success: false, error: { code: 'DUPLICATE', message: 'A badge with this key already exists.' } }, 409);
  const { CreateAuditLogUseCase } = await import('../../../../application/use-cases/audit/CreateAuditLogUseCase');
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: 'GAMIFICATION_BADGE_CREATED', entity: 'gamification_badge', entityId: row.id, newState: { key, missionId: row.missionId } });
  return c.json({ success: true, data: row });
});

routes.post('/gamification/missions/:id/dry-evaluate', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const mission = await registry.gamificationRepo.findMission(c.req.param('id') ?? '');
  if (!mission) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Mission not found.' } }, 404);
  const result = await registry.gamificationRepo.dryEvaluate(mission);
  const loyaltyEnabled = await registry.gamificationRepo.loyaltyEnabled();
  return c.json({ success: true, data: { mission: { id: mission.id, key: mission.key, kind: mission.kind, threshold: mission.threshold }, ...result, awardsBlockedReason: loyaltyEnabled ? null : 'LOYALTY_DORMANT', awarded: 0 } });
});

export default routes;


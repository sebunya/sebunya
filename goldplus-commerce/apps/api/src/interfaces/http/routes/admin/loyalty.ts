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
  if (!key || !title || !['PURCHASE_COUNT','REVIEW_COUNT','STREAK_DAYS','REFERRAL_COUNT','VERIFICATION_COUNT','STREAK_ORDERS'].includes(kind) || !Number.isInteger(threshold) || threshold < 1) {
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


// ── Loyalty completion admin (brief PARTs D.4/K/L/N/O, stages 5–14) ────────
// Every liability mutation stays on a MUTATING permission with audit.

routes.post('/adjust', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.userId || body?.points === undefined || !body?.reason || !body?.idempotencyKey) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'userId, points, reason and idempotencyKey are required.' } } satisfies ApiResponse<never>, 400);
  }
  const result = await Registry.getInstance().manualAdjustLoyaltyUseCase.execute({
    userId: String(body.userId),
    points: Number(body.points),
    reason: String(body.reason),
    actorId: (c.get('user') as any).id as string,
    idempotencyKey: String(body.idempotencyKey),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: { entryId: result.entryId } });
});

routes.put('/programme-config', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const values = {
    pointValueUgx: num(body.pointValueUgx),
    redemptionMinPoints: num(body.redemptionMinPoints),
    redemptionMaxShareBps: num(body.redemptionMaxShareBps),
    budgetCapPoints: num(body.budgetCapPoints),
    killSwitch: Boolean(body.killSwitch),
    guestBackfillLookbackDays: num(body.guestBackfillLookbackDays),
    guestBackfillCapPoints: num(body.guestBackfillCapPoints),
    // 0087 gamification values — null switches that earn source off.
    referralReferrerPoints: num(body.referralReferrerPoints),
    referralRefereePoints: num(body.referralRefereePoints),
    birthdayPoints: num(body.birthdayPoints),
    streakTargetOrders: num(body.streakTargetOrders),
    streakWindowDays: num(body.streakWindowDays),
    streakRewardPoints: num(body.streakRewardPoints),
    // 0088: the master switch for chance mechanics. Independent of any
    // individual campaign's active flag — either one off means no draws.
    chanceEnabled: Boolean(body.chanceEnabled),
  };
  for (const [k, v] of Object.entries(values)) {
    if (v !== null && typeof v === 'number' && (!Number.isInteger(v) || v < 0 || (k === 'redemptionMaxShareBps' && v > 10_000))) {
      return c.json({ success: false, error: { code: 'INVALID_VALUE', message: `"${k}" is out of range.` } } satisfies ApiResponse<never>, 400);
    }
  }
  const registry = Registry.getInstance();
  await registry.loyaltyProgrammeConfigWriter.save(values);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_PROGRAMME_CONFIG_SAVED',
    entity: 'loyalty_config',
    entityId: 'config',
    newState: values,
  });
  return c.json({ success: true, data: values });
});

// 0088: reward-draw oversight. Campaigns, live prize table with published
// odds, outstanding-card liability and spend against the budget cap.
routes.get('/draws', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const campaigns = await registry.loyaltyDrawRepo.listCampaignsWithStats();
  const config = await registry.loyaltyCompletionRepo.getProgrammeConfig();
  const { publishedOdds, maxPrizePoints, availablePrizes } = await import('../../../../domain/loyalty/RewardDraw');
  return c.json({
    success: true,
    data: {
      chanceEnabled: config.chanceEnabled,
      programmeEnabled: config.enabled && !config.killSwitch,
      campaigns: campaigns.map((camp) => ({
        id: camp.id,
        code: camp.code,
        name: camp.name,
        active: camp.active,
        triggerEvent: (camp as unknown as { triggerEvent?: string }).triggerEvent ?? null,
        budgetCapPoints: camp.budgetCapPoints,
        pointsAwarded: camp.pointsAwarded,
        outstandingTokens: camp.outstandingTokens,
        // Worst-case liability if every outstanding card wins the top prize.
        outstandingLiabilityPoints: maxPrizePoints(availablePrizes(camp.prizes)) * camp.outstandingTokens,
        odds: publishedOdds(camp.prizes),
      })),
    },
  });
});

// 0090: the recorded legal basis for running draws. Reading it is how anyone
// checks whether the mechanic is permitted; writing it is how Rob records a
// licence or counsel's opinion. Draws refuse to run while the basis is 'none'.
routes.get('/draws/compliance', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const record = await registry.loyaltyDrawRepo.getComplianceRecord();
  const state = await registry.loyaltyDrawRepo.getCompliance();
  const { canRunDraw } = await import('../../../../domain/loyalty/RewardDraw');
  const permitted = canRunDraw(state, new Date());
  return c.json({
    success: true,
    data: {
      ...record,
      permittedToRun: permitted.ok,
      blockedReason: permitted.ok ? null : permitted.reason,
    },
  });
});

routes.put('/draws/compliance', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const basis = String(body?.basis ?? '');
  if (!['none', 'licensed', 'counsel_advised_exempt'].includes(basis)) {
    return c.json({ success: false, error: { code: 'BAD_BASIS', message: 'basis must be none, licensed or counsel_advised_exempt.' } } satisfies ApiResponse<never>, 400);
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const licenceReference = str(body?.licenceReference, 120);
  const licenceExpiresAt = isoDate(body?.licenceExpiresAt);
  const counselReference = str(body?.counselReference, 300);
  const counselOpinionDate = isoDate(body?.counselOpinionDate);
  const minAge = Number.isInteger(Number(body?.minAge)) ? Number(body.minAge) : 25;
  // The same conditions the database CHECKs enforce, refused here with a
  // message that says which field is missing rather than a constraint error.
  if (basis === 'licensed' && (!licenceReference || !licenceExpiresAt)) {
    return c.json({ success: false, error: { code: 'LICENCE_INCOMPLETE', message: 'A licensed basis requires licenceReference and licenceExpiresAt (YYYY-MM-DD).' } } satisfies ApiResponse<never>, 400);
  }
  if (basis === 'counsel_advised_exempt' && (!counselReference || !counselOpinionDate)) {
    return c.json({ success: false, error: { code: 'OPINION_INCOMPLETE', message: 'An exemption basis requires counselReference and counselOpinionDate (YYYY-MM-DD).' } } satisfies ApiResponse<never>, 400);
  }
  if (minAge < 18 || minAge > 30) {
    return c.json({ success: false, error: { code: 'BAD_MIN_AGE', message: 'minAge must be between 18 and 30.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as any).id;
  const previous = await registry.loyaltyDrawRepo.getComplianceRecord();
  const saved = await registry.loyaltyDrawRepo.saveCompliance({
    basis,
    licenceReference,
    licenceIssuer: str(body?.licenceIssuer, 160),
    licenceExpiresAt,
    counselReference,
    counselOpinionDate,
    minAge,
    notes: str(body?.notes, 1000),
    acknowledgedBy: actorId,
  });
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId,
    action: 'LOYALTY_DRAW_COMPLIANCE_RECORDED',
    entity: 'loyalty_draw_compliance',
    entityId: saved?.id ?? 'compliance',
    previousState: { basis: previous?.basis ?? 'none' },
    newState: { basis, licenceReference, licenceExpiresAt, counselReference, counselOpinionDate, minAge },
  });
  return c.json({ success: true, data: saved });
});

// Every play, for the Board or an auditor.
routes.get('/draws/regulatory-export.csv', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const rows = await Registry.getInstance().loyaltyDrawRepo.regulatoryExport();
  const headers = ['created_at', 'result_id', 'campaign_code', 'prize_label', 'weight', 'points_awarded', 'user_id', 'token_id', 'source_type', 'source_id', 'card_granted_at', 'ledger_entry_id'];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="goldplus-draw-regulatory-export.csv"');
  return c.body(csv);
});

// Activation is explicit and audited, and still requires chance_enabled on the
// programme config — two independent switches, either of which stops the draw.
// 0090 adds a third precondition: a recorded compliance basis.
routes.post('/draws/:id/activation', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const active = Boolean(body?.active);
  const registry = Registry.getInstance();
  if (active) {
    const state = await registry.loyaltyDrawRepo.getCompliance();
    const { canRunDraw } = await import('../../../../domain/loyalty/RewardDraw');
    const permitted = canRunDraw(state, new Date());
    if (!permitted.ok) {
      return c.json({
        success: false,
        error: {
          code: permitted.reason,
          message:
            permitted.reason === 'COMPLIANCE_BASIS_MISSING'
              ? 'Record a compliance basis first (PUT /admin/loyalty/draws/compliance) — either an LGRB licence or a written opinion from counsel.'
              : 'The recorded licence has expired. Update it before activating.',
        },
      } satisfies ApiResponse<never>, 409);
    }
  }
  const campaign = await registry.loyaltyDrawRepo.setCampaignActive(c.req.param('id') ?? '', active, (c.get('user') as any).id);
  if (!campaign) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found.' } } satisfies ApiResponse<never>, 404);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: active ? 'LOYALTY_DRAW_ACTIVATED' : 'LOYALTY_DRAW_PAUSED',
    entity: 'loyalty_draw_campaign',
    entityId: campaign.id,
    newState: { code: campaign.code, active },
  });
  return c.json({ success: true, data: { id: campaign.id, code: campaign.code, active: campaign.active } });
});

// 0089: the draw budget is a configuration value, not a code change. Stated
// in POINTS because that is what the engine enforces; the response echoes the
// UGX equivalent at the current point value so the two never drift silently.
routes.put('/draws/:id/budget', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const budgetCapPoints = Number(body?.budgetCapPoints);
  if (!Number.isInteger(budgetCapPoints) || budgetCapPoints <= 0 || budgetCapPoints > 100_000_000) {
    return c.json({ success: false, error: { code: 'INVALID_VALUE', message: 'budgetCapPoints must be a positive whole number.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const campaigns = await registry.loyaltyDrawRepo.listCampaignsWithStats();
  const campaign = campaigns.find((camp) => camp.id === c.req.param('id'));
  if (!campaign) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found.' } } satisfies ApiResponse<never>, 404);
  // Refusing to set a cap below what has already been paid out keeps the
  // spent/cap relationship meaningful rather than instantly "over budget".
  if (budgetCapPoints < campaign.pointsAwarded) {
    return c.json({
      success: false,
      error: { code: 'BELOW_SPENT', message: `This campaign has already awarded ${campaign.pointsAwarded} points; the cap cannot be lower.` },
    } satisfies ApiResponse<never>, 400);
  }
  await registry.loyaltyDrawRepo.setCampaignBudget(campaign.id, budgetCapPoints, (c.get('user') as any).id);
  const config = await registry.loyaltyCompletionRepo.getProgrammeConfig();
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_DRAW_BUDGET_CHANGED',
    entity: 'loyalty_draw_campaign',
    entityId: campaign.id,
    previousState: { budgetCapPoints: campaign.budgetCapPoints },
    newState: { budgetCapPoints },
  });
  return c.json({
    success: true,
    data: {
      id: campaign.id,
      budgetCapPoints,
      budgetCapUgx: config.pointValueUgx === null ? null : budgetCapPoints * config.pointValueUgx,
    },
  });
});

// 0087: referral oversight — the ring/self-referral fraud surface.
routes.get('/referrals', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const rows = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`
      select r.id, r.code, r.status, r.rejection_reason, r.created_at, r.updated_at,
             ref.email as referrer_email, ree.email as referee_email
      from loyalty_referrals r
      left join users ref on ref.id = r.referrer_user_id
      left join users ree on ree.id = r.referee_user_id
      order by r.created_at desc limit 200`,
  )) as unknown as unknown[];
  return c.json({ success: true, data: rows });
});

routes.get('/fraud-signals', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const rows = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`select * from loyalty_fraud_signals order by created_at desc limit 100`,
  )) as unknown as unknown[];
  return c.json({ success: true, data: rows });
});

routes.get('/liability', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const [totals, config] = await Promise.all([
    registry.loyaltyCompletionRepo.ledgerTotals(),
    registry.loyaltyCompletionRepo.getProgrammeConfig(),
  ]);
  const snapshots = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`select * from loyalty_liability_snapshots order by snapshot_date desc limit 30`,
  )) as unknown as unknown[];
  return c.json({
    success: true,
    data: {
      totals,
      liabilityUgx: config.pointValueUgx !== null ? totals.outstanding * config.pointValueUgx : null,
      pointValueUgx: config.pointValueUgx,
      budgetCapPoints: config.budgetCapPoints,
      killSwitch: config.killSwitch,
      snapshots,
    },
  });
});

// Finance export (PART O): CSV of the daily snapshots.
routes.get('/finance-export.csv', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const rows = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`select snapshot_date, points_outstanding, points_issued, points_redeemed, points_expired, points_clawed_back, pending_points, point_value_ugx, liability_ugx, breakage_estimate_bps, redemption_rate_bps from loyalty_liability_snapshots order by snapshot_date`,
  )) as unknown as Array<Record<string, unknown>>;
  const header = 'snapshot_date,points_outstanding,points_issued,points_redeemed,points_expired,points_clawed_back,pending_points,point_value_ugx,liability_ugx,breakage_estimate_bps,redemption_rate_bps';
  const lines = rows.map((r) => header.split(',').map((k) => r[k] ?? '').join(','));
  return c.text([header, ...lines].join('\n'), 200, { 'Content-Type': 'text/csv' });
});

routes.post('/accounts/merge', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.mergedAccountId || !body?.survivorAccountId || !body?.note) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'mergedAccountId, survivorAccountId and note are required.' } } satisfies ApiResponse<never>, 400);
  }
  const result = await Registry.getInstance().mergeLoyaltyAccountsUseCase.execute({
    mergedAccountId: String(body.mergedAccountId),
    survivorAccountId: String(body.survivorAccountId),
    actorId: (c.get('user') as any).id as string,
    note: String(body.note),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: { merged: true } });
});

routes.post('/accounts/:id/dealer-flag', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const isDealer = Boolean(body?.isDealer);
  const { db } = await import('../../../../infrastructure/db/client');
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`update loyalty_accounts set is_dealer = ${isDealer} where id = ${String(c.req.param('id'))}`);
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_DEALER_FLAGGED',
    entity: 'loyalty_account',
    entityId: String(c.req.param('id')),
    newState: { isDealer },
  });
  return c.json({ success: true, data: { isDealer } });
});

routes.get('/tiers', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const data = await (Registry.getInstance().loyaltyTierRepo as any).listTiers();
  return c.json({ success: true, data });
});

routes.put('/tiers/:code', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } } satisfies ApiResponse<never>, 400);
  const result = await (Registry.getInstance().loyaltyTierRepo as any).saveTier({
    code: String(c.req.param('code')),
    name: body.name ? String(body.name) : undefined,
    thresholdLifetimePoints: body.thresholdLifetimePoints === null || body.thresholdLifetimePoints === undefined || body.thresholdLifetimePoints === '' ? null : Number(body.thresholdLifetimePoints),
    benefits: body.benefits ?? null,
    active: Boolean(body.active),
    updatedBy: (c.get('user') as any).id as string,
  });
  if (!result.ok) return c.json({ success: false, error: { code: 'ACTIVATION_BLOCKED', message: result.message } } satisfies ApiResponse<never>, 400);
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'LOYALTY_TIER_SAVED',
    entity: 'loyalty_tier',
    entityId: String(c.req.param('code')),
    newState: result.tier,
  });
  return c.json({ success: true, data: result.tier });
});

routes.post('/tiers/evaluate', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const result = await Registry.getInstance().evaluateTiersUseCase.execute();
  return c.json({ success: true, data: result });
});

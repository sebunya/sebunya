import { Hono } from 'hono';
import { customerSessionMiddleware } from '../middleware/customerSession';
import { Registry } from '../../../infrastructure/Registry';
import { ListMyOrdersUseCase, GetMyOrderUseCase } from '../../../application/use-cases/orders/CustomerOrderUseCases';
import {
  ListMyAddressesUseCase,
  AddAddressUseCase,
  UpdateAddressUseCase,
  SetDefaultAddressUseCase,
  DeleteAddressUseCase,
} from '../../../application/use-cases/addresses/AddressUseCases';
import { ApiResponse, MeDto, OrderSummaryDto, OrderDetailDto, AddressDto } from '@goldplus/shared';
import { clientIp } from '../clientAddress';

const routes = new Hono<{ Variables: { userId: string; userEmail: string } }>();
routes.use('*', customerSessionMiddleware);

// Slice 8: loyalty history — truthful: programmeActive stays false until the
// operator-approved activation; entries exist only from real orders/adjustments.
routes.get('/loyalty', async (c) => {
  const userId = c.get('userId') as string;
  const registry = Registry.getInstance();
  const [data, pendingOrders, config] = await Promise.all([
    registry.getLoyaltyHistoryUseCase.execute({ userId }),
    registry.loyaltyCompletionRepo.pendingEarnOrders(userId),
    registry.loyaltyRepo.getConfig(),
  ]);
  // PART F: pending vs available shown separately. Pending is a projection
  // over paid-but-undelivered orders — the ledger records only vested facts.
  const pendingPoints = pendingOrders.reduce(
    (sum, o) => sum + Math.floor(o.totalUgx / 1000) * config.earnRatePer1000Ugx,
    0,
  );
  return c.json({ success: true, data: { ...data, pendingPoints, pendingOrders: pendingOrders.length } });
});

// The account hub's single read: everything the landing page shows, one call.
// Composed from the same use cases the dedicated endpoints use, so the hub can
// never drift from what the detail pages report.
routes.get('/overview', async (c) => {
  const userId = c.get('userId') as string;
  const registry = Registry.getInstance();
  const [user, loyalty, rewards, orderList, addressList] = await Promise.all([
    registry.userRepo.findById(userId),
    registry.getLoyaltyHistoryUseCase.execute({ userId }),
    registry.gamificationRepo.customerSnapshot(userId),
    new ListMyOrdersUseCase(registry.orderRepo).execute(userId),
    new ListMyAddressesUseCase(registry.addressRepo).execute(userId),
  ]);
  if (!user) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    return c.json(res, 404);
  }
  const now = Date.now();
  const soonestExpiry = loyalty.entries
    .filter((e) => e.type === 'earn' && e.expiresAt && new Date(e.expiresAt).getTime() > now)
    .map((e) => new Date(e.expiresAt as unknown as string).getTime())
    .sort((a, b) => a - b)[0];
  return c.json({
    success: true,
    data: {
      profile: { id: user.id, email: user.email, phone: user.phone, createdAt: user.createdAt.toISOString() },
      loyalty: {
        programmeActive: loyalty.programmeActive,
        balance: loyalty.balance,
        entryCount: loyalty.entries.length,
        soonestExpiry: soonestExpiry ? new Date(soonestExpiry).toISOString() : null,
      },
      rewards: {
        badgeCount: rewards.badges.length,
        missionCount: rewards.missions.length,
        missionsCompleted: rewards.missions.filter((m) => m.completed).length,
      },
      recentOrders: orderList.slice(0, 3),
      orderCount: orderList.length,
      defaultAddress: addressList.find((a) => a.isDefault) ?? null,
      addressCount: addressList.length,
    },
  });
});

// Missions and badges as THIS customer sees them: earned badges plus honest
// per-mission progress (only where the data attributes to their account).
routes.get('/gamification', async (c) => {
  const userId = c.get('userId') as string;
  const registry = Registry.getInstance();
  const [snapshot, programmeActive] = await Promise.all([
    registry.gamificationRepo.customerSnapshot(userId),
    registry.gamificationRepo.loyaltyEnabled(),
  ]);
  return c.json({ success: true, data: { programmeActive, ...snapshot } });
});

routes.get('/me', async (c) => {
  const userId = c.get('userId') as string;
  const user = await Registry.getInstance().userRepo.findById(userId);
  if (!user) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
    return c.json(res, 404);
  }
  const me: MeDto = {
    id: user.id,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt.toISOString(),
  };
  // 0087: the two profile facts the earn sources depend on, so the account
  // surface can show "verify your phone / add your birthday" only when true.
  const identity = await Registry.getInstance().loyaltyIdentityRepo.identityFacts(userId).catch(() => null);
  const res: ApiResponse<MeDto & { phoneVerified?: boolean; dateOfBirthSet?: boolean }> = {
    success: true,
    data: { ...me, phoneVerified: Boolean(identity?.phoneVerifiedAt), dateOfBirthSet: Boolean(identity?.dateOfBirth) },
  };
  return c.json(res);
});

routes.get('/orders', async (c) => {
  const userId = c.get('userId') as string;
  const uc = new ListMyOrdersUseCase(Registry.getInstance().orderRepo);
  const data = await uc.execute(userId);
  const res: ApiResponse<OrderSummaryDto[]> = { success: true, data };
  return c.json(res);
});

routes.get('/orders/:id', async (c) => {
  const userId = c.get('userId') as string;
  const uc = new GetMyOrderUseCase(Registry.getInstance().orderRepo);
  const result = await uc.execute(c.req.param('id'), userId);
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Order not found.' } };
    return c.json(res, 404);
  }
  const res: ApiResponse<OrderDetailDto> = { success: true, data: result.order };
  return c.json(res);
});

routes.get('/addresses', async (c) => {
  const userId = c.get('userId') as string;
  const uc = new ListMyAddressesUseCase(Registry.getInstance().addressRepo);
  const data = await uc.execute(userId);
  const res: ApiResponse<AddressDto[]> = { success: true, data };
  return c.json(res);
});

routes.post('/addresses', async (c) => {
  const userId = c.get('userId') as string;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }
  const registry = Registry.getInstance();
  const uc = new AddAddressUseCase(registry.addressRepo, registry.addressAuditRepo);
  const result = await uc.execute({
    userId,
    label: String(body.label ?? ''),
    recipientName: String(body.recipientName ?? ''),
    phone: String(body.phone ?? ''),
    district: String(body.district ?? ''),
    areaDetails: String(body.areaDetails ?? ''),
    makeDefault: Boolean(body.makeDefault),
    // Location-module structured fields (all optional; brief PART G)
    areaSlug: body.areaSlug ? String(body.areaSlug) : undefined,
    landmarkText: body.landmarkText !== undefined ? String(body.landmarkText ?? '') : undefined,
    additionalDirections: body.additionalDirections ? String(body.additionalDirections) : undefined,
    phoneSecondary: body.phoneSecondary ? String(body.phoneSecondary) : undefined,
    gpsLat: typeof body.gpsLat === 'number' ? body.gpsLat : undefined,
    gpsLng: typeof body.gpsLng === 'number' ? body.gpsLng : undefined,
    gpsAccuracyM: typeof body.gpsAccuracyM === 'number' ? body.gpsAccuracyM : undefined,
    gpsSource: body.gpsSource === 'device' || body.gpsSource === 'pasted_link' ? body.gpsSource : undefined,
    rawAddressText: body.rawAddressText ? String(body.rawAddressText) : undefined,
    deliveryMethod: body.deliveryMethod === 'pickup_point' ? 'pickup_point' : undefined,
    pickupPointId: body.pickupPointId ? String(body.pickupPointId) : undefined,
    snapshotAreaLabel: body.snapshotAreaLabel ? String(body.snapshotAreaLabel) : undefined,
    snapshotDistrict: body.snapshotDistrict ? String(body.snapshotDistrict) : undefined,
    snapshotPostcode: body.snapshotPostcode ? String(body.snapshotPostcode) : undefined,
    snapshotDataVersion: typeof body.snapshotDataVersion === 'number' ? body.snapshotDataVersion : undefined,
  });
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }
  const res: ApiResponse<AddressDto> = { success: true, data: result.address, meta: result.phoneWarning ? { phoneWarning: result.phoneWarning } : undefined };
  return c.json(res, 201);
});

// Location module stage 4 (authorised scope): post-placement address edits are
// exactly what generates disputes — full before/after audit in the use case.
routes.put('/addresses/:id', async (c) => {
  const userId = c.get('userId') as string;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }
  const registry = Registry.getInstance();
  const uc = new UpdateAddressUseCase(registry.addressRepo, registry.addressAuditRepo);
  const patch: Record<string, unknown> = {};
  for (const k of ['label','recipientName','phone','district','areaDetails','areaSlug','landmarkText','additionalDirections','phoneSecondary','rawAddressText','pickupPointId','snapshotAreaLabel','snapshotDistrict','snapshotPostcode'] as const) {
    if (body[k] !== undefined) patch[k] = body[k] === null ? null : String(body[k]);
  }
  for (const k of ['gpsLat','gpsLng','gpsAccuracyM','snapshotDataVersion'] as const) {
    if (typeof body[k] === 'number') patch[k] = body[k];
  }
  if (body.gpsSource === 'device' || body.gpsSource === 'pasted_link') patch.gpsSource = body.gpsSource;
  if (body.deliveryMethod === 'door' || body.deliveryMethod === 'pickup_point') patch.deliveryMethod = body.deliveryMethod;
  const result = await uc.execute(userId, c.req.param('id'), patch);
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, result.code === 'NOT_FOUND' ? 404 : 400);
  }
  const res: ApiResponse<AddressDto> = { success: true, data: result.address, meta: result.phoneWarning ? { phoneWarning: result.phoneWarning } : undefined };
  return c.json(res);
});

routes.post('/addresses/:id/default', async (c) => {
  const userId = c.get('userId') as string;
  const registry = Registry.getInstance();
  const uc = new SetDefaultAddressUseCase(registry.addressRepo, registry.addressAuditRepo);
  const address = await uc.execute(userId, c.req.param('id'));
  if (!address) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Address not found.' } };
    return c.json(res, 404);
  }
  const res: ApiResponse<AddressDto> = { success: true, data: address };
  return c.json(res);
});

routes.delete('/addresses/:id', async (c) => {
  const userId = c.get('userId') as string;
  const registry = Registry.getInstance();
  const uc = new DeleteAddressUseCase(registry.addressRepo, registry.addressAuditRepo);
  const removed = await uc.execute(userId, c.req.param('id'));
  if (!removed) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Address not found.' } };
    return c.json(res, 404);
  }
  return c.json({ success: true, data: { deleted: true } });
});

// ── Phone verification (loyalty brief PART I: the identity spine) ─────────
routes.post('/phone/request-verification', async (c) => {
  const userId = c.get('userId') as string;
  const body = await c.req.json().catch(() => null);
  const result = await Registry.getInstance().requestPhoneVerificationUseCase.execute({
    userId,
    phone: String(body?.phone ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } as const, 400);
  }
  return c.json({ success: true, data: { sent: true } });
});

routes.post('/phone/verify', async (c) => {
  const userId = c.get('userId') as string;
  const body = await c.req.json().catch(() => null);
  const registry = Registry.getInstance();
  const result = await registry.verifyPhoneUseCase.execute({
    userId,
    code: String(body?.code ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } as const, 400);
  }
  // Gamification (0087): a verified phone earns once (rule-gated) and awards
  // the Verified Buyer badge. Never fails the verification itself.
  const phoneEarn = await registry.earnForPhoneVerificationUseCase.execute({ userId }).catch(() => null);
  return c.json({
    success: true,
    data: {
      verified: true,
      backfilledPoints: result.backfilledPoints,
      loyaltyPoints: phoneEarn && 'points' in phoneEarn ? phoneEarn.points : 0,
    },
  });
});

// ── Reward draw (0088): the customer's cards and the published odds ─────────
// Playing is free and requires a card that was granted for an already
// delivered order, so there is no purchase-to-play path to rate limit; the
// card itself is the quota, and it is single-use at the database.
routes.get('/draw', async (c) => {
  const userId = c.get('userId') as string;
  const state = await Registry.getInstance().getDrawStateUseCase.execute({ userId });
  return c.json({ success: true, data: state });
});

routes.post('/draw/play', async (c) => {
  const userId = c.get('userId') as string;
  const body = await c.req.json().catch(() => null);
  const tokenId = String(body?.tokenId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(tokenId)) {
    return c.json({ success: false, error: { code: 'BAD_TOKEN', message: 'A valid card id is required.' } } as const, 400);
  }
  const result = await Registry.getInstance().playDrawTokenUseCase.execute({ userId, tokenId });
  if (!result.ok) {
    const status = result.code === 'TOKEN_NOT_FOUND' ? 404 : 400;
    return c.json({ success: false, error: { code: result.code, message: result.message } } as const, status);
  }
  return c.json({ success: true, data: { label: result.label, points: result.points, replay: result.replay } });
});

// ── Gamification (0087): referral code + share stats ────────────────────────
routes.get('/referral', async (c) => {
  const userId = c.get('userId') as string;
  const registry = Registry.getInstance();
  const config = await registry.loyaltyCompletionRepo.getProgrammeConfig();
  if (!config.enabled || config.referralReferrerPoints === null) {
    return c.json({ success: true, data: { active: false } });
  }
  const [code, referrals] = await Promise.all([
    registry.loyaltyReferralRepo.getOrCreateCode(userId),
    registry.loyaltyReferralRepo.listForReferrer(userId),
  ]);
  return c.json({
    success: true,
    data: {
      active: true,
      code,
      referrerPoints: config.referralReferrerPoints,
      refereePoints: config.referralRefereePoints,
      referred: referrals.length,
      awarded: referrals.filter((r) => r.status === 'awarded').length,
      pending: referrals.filter((r) => r.status === 'pending').length,
    },
  });
});

// ── Gamification (0087): birthday opt-in. Set-once (correction goes through
// support so the earn source cannot be gamed by cycling dates). ─────────────
routes.put('/date-of-birth', async (c) => {
  const userId = c.get('userId') as string;
  const body = await c.req.json().catch(() => null);
  const raw = String(body?.dateOfBirth ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return c.json({ success: false, error: { code: 'BAD_DATE', message: 'dateOfBirth must be YYYY-MM-DD.' } } as const, 400);
  }
  const dob = new Date(raw + 'T00:00:00Z');
  const age = (Date.now() - dob.getTime()) / (365.25 * 86_400_000);
  if (Number.isNaN(dob.getTime()) || age < 13 || age > 120) {
    return c.json({ success: false, error: { code: 'BAD_DATE', message: 'That date of birth is not plausible.' } } as const, 400);
  }
  const registry = Registry.getInstance();
  const result = await registry.loyaltyIdentityRepo.setDateOfBirthOnce(userId, raw);
  if (!result.ok) {
    return c.json({ success: false, error: { code: 'ALREADY_SET', message: 'Date of birth is already set — contact support to correct it.' } } as const, 409);
  }
  return c.json({ success: true, data: { dateOfBirth: raw } });
});

routes.get('/preferences', async (c) => {
  const userId = c.get('userId') as string;
  const uc = Registry.getInstance().getCustomerPreferenceCentreUseCase;
  const data = await uc.execute(userId);
  const res: ApiResponse<any> = { success: true, data };
  return c.json(res);
});

routes.put('/preferences', async (c) => {
  const userId = c.get('userId') as string;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }
  
  const uc = Registry.getInstance().updateCustomerPreferenceCentreUseCase;
  const data = await uc.execute({
    userId,
    ...body,
    ipAddress: clientIp(c),
    userAgent: c.req.header('user-agent') || 'unknown'
  });
  const res: ApiResponse<any> = { success: true, data };
  return c.json(res);
});

routes.get('/preferences/audit', async (c) => {
  const userId = c.get('userId') as string;
  const uc = Registry.getInstance().getPreferenceAuditTrailUseCase;
  const data = await uc.execute(userId);
  const res: ApiResponse<any> = { success: true, data };
  return c.json(res);
});

export default routes;

import { Hono } from 'hono';
import { z } from 'zod';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';import { isShopCollectionOperator } from '../../../domain/locations/CollectionPoints';


/**
 * Public location endpoints (location-module brief PART F/G/H).
 * Rate-limited under the dedicated `location-search` abuse-control family
 * (300/min TRUSTED — autocomplete cadence; never the global 1000/min).
 *
 * Optional customer identity: a Bearer token when present personalises ranking
 * (saved/ordered areas) — its absence never fails the request. This is a READ
 * surface; no PII is returned beyond the caller's own context.
 */
const routes = new Hono();

const searchEventSchema = z
  .object({
    rawQuery: z.string().min(1).max(120),
    resolvedAreaSlug: z.string().max(160).nullish(),
    resolvedVia: z.enum(['alias', 'group', 'landmark', 'manual_entry', 'pickup_point', 'abandoned']),
    sessionId: z.string().max(80).nullish(),
  })
  .strict();

async function optionalCustomerId(c: { req: { header(name: string): string | undefined } }): Promise<string | null> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const verified = await Registry.getInstance()
    .tokenSigner.verify(header.slice(7).trim())
    .catch(() => null);
  return verified?.subject ?? null;
}

routes.get('/search', async (c) => {
  const q = String(c.req.query('q') ?? '').trim();
  if (q.length < 2) {
    return c.json({ success: true, data: { hits: [], zeroResult: false } } satisfies ApiResponse<{ hits: unknown[]; zeroResult: boolean }>);
  }
  const registry = Registry.getInstance();
  const customerId = await optionalCustomerId(c);
  const context = customerId
    ? await registry.customerLocationContextReader.forCustomer(customerId)
    : undefined;
  const result = await registry.searchLocationsUseCase.execute({
    query: q,
    sessionId: c.req.query('session') ?? null,
    customerId,
    deviceHint: c.req.header('user-agent')?.slice(0, 120) ?? null,
    context,
  });
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

/**
 * A pin → the nearest areas, for the customer to choose from (2026-10-16). Never one silent answer: on
 * production points a single nearest-area guess was wrong for about one pin in five at 1 km from an area's
 * centre. The pin is read, never stored here, and never echoed back; only area labels are returned.
 */
routes.get('/near', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -2.5 || lat > 5.5 || lng < 28 || lng > 36.5) {
    return c.json({ success: false, error: { code: 'OUTSIDE_UGANDA', message: 'That point is not in Uganda.' } } satisfies ApiResponse<never>, 400);
  }
  const areas = await Registry.getInstance()
    .deliveryAreaResolver.nearestAreas({ lat, lng })
    .catch(() => []);
  return c.json({ success: true, data: { areas } } satisfies ApiResponse<{ areas: typeof areas }>);
});

/**
 * Deep place search (2026-10-16): buildings, malls, plots our gazetteer does not hold, via Google Places (New).
 * Called by the picker only when our own search cannot answer; the use case enforces the monthly budget,
 * the per-session cap, the cache and "Not configured". The query text goes to Google; nothing personal does.
 */
const deepSearchSchema = z.object({ q: z.string().min(1).max(100), session: z.string().regex(/^[A-Za-z0-9-]{16,64}$/) }).strict();
const deepPlaceSchema = z.object({ placeId: z.string().min(10).max(300), session: z.string().regex(/^[A-Za-z0-9-]{16,64}$/) }).strict();

/** Whether the deep layer exists at all, so the picker does not offer it on a site without a key. Free. */
routes.get('/deep-status', (c) =>
  c.json({ success: true, data: { configured: Registry.getInstance().deepPlaceSearchUseCase.configured() } }),
);

routes.post('/deep-search', async (c) => {
  const parsed = deepSearchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  }
  const result = await Registry.getInstance().deepPlaceSearchUseCase.suggest({ query: parsed.data.q, sessionToken: parsed.data.session });
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

/** A chosen place → its point and the nearest of OUR areas to tap (pricing stays ours). Ends the billing session. */
routes.post('/deep-place', async (c) => {
  const parsed = deepPlaceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid body.' } } satisfies ApiResponse<never>, 400);
  }
  const registry = Registry.getInstance();
  const found = await registry.deepPlaceSearchUseCase.locate({ placeId: parsed.data.placeId, sessionToken: parsed.data.session });
  if (found.status !== 'ok') {
    return c.json({ success: true, data: { status: found.status, point: null, areas: [] } });
  }
  const areas = await registry.deliveryAreaResolver.nearestAreas(found.point).catch(() => []);
  return c.json({ success: true, data: { status: 'ok', point: found.point, areas } });
});

routes.post('/search-events', async (c) => {
  const parsed = searchEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid body.' } } satisfies ApiResponse<never>,
      400,
    );
  }
  const customerId = await optionalCustomerId(c);
  await Registry.getInstance().recordLocationSearchEventUseCase.execute({
    rawQuery: parsed.data.rawQuery,
    resolvedAreaSlug: parsed.data.resolvedAreaSlug ?? null,
    resolvedVia: parsed.data.resolvedVia,
    sessionId: parsed.data.sessionId ?? null,
    customerId,
  });
  return c.json({ success: true, data: { recorded: true } } satisfies ApiResponse<{ recorded: boolean }>);
});

routes.get('/pickup-points', async (c) => {
  // Active pickup points only — upcountry delivery runs on bus parcel offices
  // and agents (brief PART B reality 2). No PII: operator-published data only.
  const all = await Registry.getInstance().managePickupPointsUseCase.list();
  const data = all
    .filter((p) => p.active && isShopCollectionOperator(p.operator))
    .map((p) => ({
      id: p.id,
      name: p.name,
      operator: p.operator,
      areaSlug: p.areaSlug,
      physicalAddress: p.physicalAddress,
      landmarkText: p.landmarkText,
      phone: p.phone,
      openingHours: p.openingHours,
      servesDistricts: p.servesDistricts,
    }));
  return c.json({ success: true, data } satisfies ApiResponse<typeof data>);
});

routes.post('/resolve-link', async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = typeof body?.url === 'string' ? body.url.slice(0, 500) : '';
  if (!raw) {
    return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'url is required.' } } satisfies ApiResponse<never>, 400);
  }
  const pin = await Registry.getInstance().resolveMapLinkUseCase.execute(raw);
  if (!pin) {
    return c.json({ success: true, data: { pin: null } } satisfies ApiResponse<{ pin: null }>);
  }
  return c.json({ success: true, data: { pin } } satisfies ApiResponse<{ pin: typeof pin }>);
});

export default routes;

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { BatteryOperationError } from '../../../application/use-cases/batteries/BatteryOperationError';

/**
 * Public battery finder. Every read here is derived from published, evidenced
 * compatibility; nothing unverified is presented as confirmed, and no cost,
 * supplier or internal note ever appears. Short public cache so an admin edit
 * reaches customers within a minute.
 */
const routes = new Hono();

type Ctx = Context;
const param = (c: Ctx, name: string): string => c.req.param(name) ?? '';
const ok = <T>(c: Ctx, data: T, maxAge = 60) => {
  if (maxAge > 0) c.header('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=120`);
  return c.json({ success: true, data } satisfies ApiResponse<T>);
};
const bad = (c: Ctx, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status as 400);
const uc = () => Registry.getInstance().batteryFinderUseCases;
const session = (c: Ctx) => c.req.header('x-gp-finder-session') ?? null;

async function run<T>(c: Ctx, fn: () => Promise<T>, maxAge = 60) {
  try {
    return ok(c, await fn(), maxAge);
  } catch (error) {
    if (error instanceof BatteryOperationError) return bad(c, error.code, error.message, error.status);
    throw error;
  }
}

routes.get('/finder/config', (c) => run(c, async () => ({ config: await uc().config(), indexable: await uc().indexable() })));
routes.get('/finder/brands', (c) => run(c, () => uc().brands()));
routes.get('/finder/brands/:slug', (c) => run(c, () => uc().brand(param(c, 'slug'))));
routes.get('/finder/devices/:slug', (c) => run(c, () => uc().device(param(c, 'slug'), session(c)), 30));
routes.get('/finder/search', (c) => {
  const q = (c.req.query('q') ?? '').slice(0, 120);
  return run(c, () => uc().search(q, session(c)), 0);
});
routes.get('/finder/check', (c) => {
  const device = c.req.query('device') ?? '';
  const ids = (c.req.query('productIds') ?? '').split(',').map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 100);
  if (!device) return bad(c, 'BAD_INPUT', 'device is required.');
  return run(c, () => uc().check(device, ids), 30);
});
routes.get('/products/:slug', (c) => run(c, async () => {
  const found = await uc().battery(param(c, 'slug'));
  // Public route: a battery that is not published does not exist here. The
  // use case answers for drafts too (the admin preview needs it), and this
  // route used to pass that straight through, exposing DRAFT, REVIEW and READY
  // batteries by slug with their code, price and every claimed device.
  if (!found || !found.isPublished) throw new BatteryOperationError('NOT_FOUND', 'Battery not found.', 404);
  return found;
}, 30));

const eventBody = z.object({
  eventType: z.enum(['RESULT_VIEWED', 'PRODUCT_VIEWED', 'ADDED_TO_CART']),
  mode: z.enum(['FIND_BY_PHONE', 'SEARCH_CODE', 'PRODUCT_PAGE', 'CART']),
  deviceSlug: z.string().max(160).nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  query: z.string().max(120).nullable().optional(),
  outcome: z.string().max(40).nullable().optional(),
});
routes.post('/finder/events', async (c) => {
  const parsed = eventBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', 'Invalid event.');
  await uc().recordEvent({ ...parsed.data, sessionId: session(c) }).catch(() => undefined);
  return c.json({ success: true, data: { recorded: true } } satisfies ApiResponse<{ recorded: boolean }>, 202);
});

const requestBody = z.object({
  queryText: z.string().max(200).nullable().optional(),
  brandText: z.string().max(80).nullable().optional(),
  deviceText: z.string().max(120).nullable().optional(),
  modelNumberText: z.string().max(80).nullable().optional(),
  batteryCodeText: z.string().max(120).nullable().optional(),
  contactName: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(32).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  source: z.enum(['FINDER_NO_RESULT', 'PRODUCT_PAGE']).optional(),
  // Honeypot: real forms leave it empty.
  website: z.string().max(0).optional(),
});
routes.post('/finder/requests', async (c) => {
  const parsed = requestBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', 'Tell us the phone model or the battery code.');
  const d = parsed.data;
  return run(c, () => uc().submitRequest({
    queryText: d.queryText ?? null, brandText: d.brandText ?? null, deviceText: d.deviceText ?? null, modelNumberText: d.modelNumberText ?? null,
    batteryCodeText: d.batteryCodeText ?? null, contactName: d.contactName ?? null, contactPhone: d.contactPhone ?? null, notes: d.notes ?? null,
    source: d.source ?? 'FINDER_NO_RESULT', sessionId: session(c),
  }), 0);
});

export default routes;

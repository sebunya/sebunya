import { Hono } from 'hono';
import { z } from 'zod';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

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

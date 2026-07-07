import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

/**
 * First-party tracking endpoints.
 *
 * The visitor id is an opaque UUID we mint ourselves and store in a
 * first-party cookie (`gp_vid`) — no third-party cookies or external
 * trackers are involved. Callers may also pass visitorId explicitly
 * (e.g. server-to-server).
 */
const routes = new Hono();

const VISITOR_COOKIE = 'gp_vid';
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function resolveVisitorId(c: Parameters<typeof getCookie>[0], explicit?: unknown): { visitorId: string; isNew: boolean } {
  const fromBody = typeof explicit === 'string' ? explicit.trim() : '';
  if (fromBody) return { visitorId: fromBody.slice(0, 100), isNew: false };

  const fromCookie = (getCookie(c, VISITOR_COOKIE) || '').trim();
  if (fromCookie) return { visitorId: fromCookie.slice(0, 100), isNew: false };

  return { visitorId: crypto.randomUUID(), isNew: true };
}

function persistVisitorCookie(c: Parameters<typeof setCookie>[0], visitorId: string): void {
  setCookie(c, VISITOR_COOKIE, visitorId, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: VISITOR_COOKIE_MAX_AGE,
  });
}

routes.post('/track', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const { visitorId, isNew } = resolveVisitorId(c, body.visitorId);
  if (isNew) persistVisitorCookie(c, visitorId);

  const result = await Registry.getInstance().recordActivityEventUseCase.execute({
    visitorId,
    sessionId: body.sessionId ?? null,
    userId: body.userId ?? null,
    eventType: String(body.eventType ?? ''),
    path: body.path ?? null,
    entity: body.entity ?? null,
    entityId: body.entityId ?? null,
    properties: body.properties ?? null,
  });

  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }

  const res: ApiResponse<{ eventId: string; visitorId: string }> = {
    success: true,
    data: { eventId: result.event.id, visitorId },
  };
  return c.json(res, 201);
});

routes.get('/experiments/:key/assignment', async (c) => {
  const { visitorId, isNew } = resolveVisitorId(c, c.req.query('visitorId'));
  if (isNew) persistVisitorCookie(c, visitorId);

  const result = await Registry.getInstance().getExperimentAssignmentUseCase.execute({
    experimentKey: c.req.param('key'),
    visitorId,
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'NOT_RUNNING' ? 409 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const res: ApiResponse<{ experimentKey: string; variantKey: string; variantName: string; visitorId: string }> = {
    success: true,
    data: {
      experimentKey: result.experimentKey,
      variantKey: result.variantKey,
      variantName: result.variantName,
      visitorId,
    },
  };
  return c.json(res);
});

export default routes;

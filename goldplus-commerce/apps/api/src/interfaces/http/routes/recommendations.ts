import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { customerSessionMiddleware } from '../middleware/customerSession';
import type { ApiResponse, GetRecommendationsInput } from '@goldplus/shared';
import { isRecommendationPlacement, RecommendationEventValidationError } from '../../../application/recommendations/RecommendationValidation';

const routes = new Hono();
const registry = Registry.getInstance();

routes.post('/events', async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'BAD_JSON', message: 'Invalid JSON body.' },
      };
      return c.json(res, 400);
    }

    // R2: the same-origin relay forwards the HttpOnly visit token as a
    // header. When present and well-formed, the event is stamped with the
    // server-side profile and the legacy client anonymous id is stitched to
    // it in identity_links. Profile failure never loses the event.
    const rawVisit = c.req.header('x-gp-visit');
    let origin: { producer: string; profileId?: string } = { producer: 'public-api' };
    if (rawVisit) {
      try {
        const profile = await registry.resolveExperienceProfileUseCase.execute(rawVisit);
        if (profile) {
          origin = { producer: 'web-relay', profileId: profile.id };
          const anonymousId = typeof (body as { anonymousId?: unknown }).anonymousId === 'string'
            ? (body as { anonymousId: string }).anonymousId
            : null;
          if (anonymousId) {
            registry.experienceProfileRepo
              .observeAnonymousId(profile.id, anonymousId)
              .catch((e) => console.error('IDENTITY_STITCH_FAILED', e instanceof Error ? e.message : String(e)));
          }
        }
      } catch {
        // Profile resolution is continuity, not correctness — the event still lands.
      }
    }

    await registry.trackRecommendationEventUseCase.execute(body, origin);

    const res: ApiResponse<{ success: true }> = {
      success: true,
      data: { success: true },
    };
    return c.json(res, 200);
  } catch (error) {
    // Only a typed validation failure echoes its message — those strings are
    // written for the caller. Anything else (DB down, bug) is a generic 500:
    // infrastructure detail never leaves the process (ERRLEAK-1).
    if (error instanceof RecommendationEventValidationError) {
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'INVALID_RECOMMENDATION_EVENT', message: error.message },
      };
      return c.json(res, 400);
    }
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'RECOMMENDATION_EVENT_WRITE_FAILED', message: 'The event could not be recorded.' },
    };
    return c.json(res, 500);
  }
});

routes.get('/', async (c) => {
  try {
    const q = c.req.query();

    if (!isRecommendationPlacement(q.placement)) {
      const res: ApiResponse<never> = {
        success: false,
        error: {
          code: 'INVALID_RECOMMENDATION_PLACEMENT',
          message: 'Placement query must be a valid recommendation placement string.',
        },
      };
      return c.json(res, 400);
    }

    // R1: bounded inputs. `limit` used to accept NaN and any magnitude
    // (feeding limit*10 over-fetch multipliers); cartProductIds was unbounded.
    const parsedLimit = q.limit ? Number(q.limit) : undefined;
    const limit =
      parsedLimit !== undefined && Number.isInteger(parsedLimit)
        ? Math.min(24, Math.max(1, parsedLimit))
        : undefined;

    const input: GetRecommendationsInput = {
      placement: q.placement,
      productId: q.productId,
      categoryId: q.categoryId,
      categorySlug: q.categorySlug,
      anonymousId: q.anonymousId,
      cartProductIds: q.cartProductIds ? q.cartProductIds.split(',').filter(Boolean).slice(0, 50) : undefined,
      limit,
    };

    // R2: SSR forwards the visit token so the profile's continuity clock
    // ticks on every server-rendered rail. Resolution failure never affects
    // the response.
    const rawVisitToken = c.req.header('x-gp-visit');
    if (rawVisitToken) {
      registry.resolveExperienceProfileUseCase.execute(rawVisitToken).catch(() => undefined);
    }

    const data = await registry.getRecommendationsUseCase.execute(input);

    const res: ApiResponse<typeof data> = {
      success: true,
      data,
    };
    return c.json(res);
  } catch (error) {
    const res: ApiResponse<never> = {
      success: false,
      error: {
        code: 'RECOMMENDATION_GENERATION_FAILED',
        // R1: internal error text is never echoed to the public (ERRLEAK-1).
        message: 'An unexpected server error occurred generating recommendations.',
      },
    };
    return c.json(res, 500);
  }
});

routes.get('/recently-viewed', async (c) => {
  try {
    const q = c.req.query();

    const data = await registry.getRecentlyViewedUseCase.execute({
      anonymousId: q.anonymousId,
      limit: q.limit ? Number(q.limit) : undefined,
    });

    const res: ApiResponse<typeof data> = {
      success: true,
      data,
    };
    return c.json(res);
  } catch {
    // Suppress recently-viewed logic errors to fail closed/empty elegantly
    const res: ApiResponse<any> = {
      success: true,
      data: {
        placement: 'recently_viewed',
        items: [],
        generatedAt: new Date().toISOString(),
        strategy: 'rule_based_v1',
      },
    };
    return c.json(res);
  }
});

/**
 * Login merge (R2): after a successful sign-in the web server calls this with
 * the customer's bearer token and the browser's HttpOnly visit token. The
 * merge is transactional and idempotent; a profile already owned by a
 * DIFFERENT verified customer is preserved, never overwritten — the response
 * says which happened. Never called by browser JavaScript.
 */
routes.post('/profile/link', customerSessionMiddleware, async (c) => {
  const rawToken = c.req.header('x-gp-visit');
  if (!rawToken) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'VISIT_TOKEN_REQUIRED', message: 'The visit token header is required.' },
    };
    return c.json(res, 400);
  }

  const result = await registry.linkExperienceProfileUseCase.execute({
    rawToken,
    customerId: c.get('userId'),
  });

  if (result.status === 'invalid_token') {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'VISIT_TOKEN_INVALID', message: 'The visit token is malformed.' },
    };
    return c.json(res, 400);
  }

  const res: ApiResponse<{ status: string }> = { success: true, data: { status: result.status } };
  return c.json(res);
});

export default routes;

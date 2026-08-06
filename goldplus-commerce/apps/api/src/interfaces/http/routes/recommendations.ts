import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
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

    await registry.trackRecommendationEventUseCase.execute(body);

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

export default routes;

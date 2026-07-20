import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { GetProductBySlugUseCase } from '../../../application/use-cases/products/GetProductBySlugUseCase';
import { ListPublicProductsUseCase } from '../../../application/use-cases/products/ListPublicProductsUseCase';
import { ApiResponse, ProductPublicDto } from '@goldplus/shared';

const routes = new Hono<{ Variables: { requestId: string } }>();

routes.get('/', async (c) => {
  const registry = Registry.getInstance();
  const useCase = new ListPublicProductsUseCase(registry.productRepo);

  const q = c.req.query('q');
  const cat = c.req.query('category');
  const inStock = c.req.query('inStock') === 'true';
  const limitParam = c.req.query('limit');
  const idsParam = c.req.query('ids');

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const ids = idsParam ? idsParam.split(',').map((i) => i.trim()).filter(Boolean) : undefined;

  const dtos = await useCase.execute({
    limit: Number.isFinite(limit) ? (limit as number) : undefined,
    search: q,
    category: cat,
    inStock,
    ids,
  });

  const res: ApiResponse<ProductPublicDto[]> = {
    success: true,
    data: dtos,
    meta: { requestId: c.get('requestId') as string | undefined },
  };
  return c.json(res);
});

// Slice 4: public autocomplete. Static path registered before /:slug.
routes.get('/suggest', async (c) => {
  const registry = Registry.getInstance();
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '8', 10);
  const data = await registry.suggestProductsUseCase.execute({
    query: c.req.query('q') ?? '',
    limit: Number.isFinite(limitRaw) ? limitRaw : 8,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

// Slice 4: anonymous search telemetry (query + result count only, no identifiers).
routes.post('/search-events', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.query !== 'string') {
    const res: ApiResponse<never> = { success: false, error: { code: 'INVALID_EVENT', message: 'query (string) is required.' } };
    return c.json(res, 400);
  }
  const registry = Registry.getInstance();
  const data = await registry.recordSearchEventUseCase.execute({
    query: body.query,
    resultCount: typeof body.resultCount === 'number' ? body.resultCount : 0,
    rankedProductIds: body.rankedProductIds,
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

// Aggregate-only search behavior. No visitor/session/cart/order identifier is accepted.
routes.post('/search-interactions', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'INVALID_EVENT', message: 'JSON body is required.' } };
    return c.json(res, 400);
  }
  const data = await Registry.getInstance().recordSearchInteractionUseCase.execute({
    query: typeof body.query === 'string' ? body.query : '',
    productId: typeof body.productId === 'string' ? body.productId : '',
    rank: typeof body.rank === 'number' ? body.rank : 0,
    type: typeof body.type === 'string' ? body.type : '',
  });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

// Slice 5: declared compatibility guidance for a PDP (admin-verified only).
routes.get('/:slug/compatibility', async (c) => {
  const registry = Registry.getInstance();
  const data = await registry.getProductCompatibilityUseCase.execute({ slug: c.req.param('slug') });
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.get('/:slug', async (c) => {
  const registry = Registry.getInstance();
  const useCase = new GetProductBySlugUseCase(registry.productRepo);
  const result = await useCase.execute(c.req.param('slug'));

  if (!result.ok) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' },
      meta: { requestId: c.get('requestId') as string | undefined },
    };
    return c.json(res, 404);
  }

  const res: ApiResponse<ProductPublicDto> = {
    success: true,
    data: result.dto,
    meta: { requestId: c.get('requestId') as string | undefined },
  };
  return c.json(res);
});

export default routes;

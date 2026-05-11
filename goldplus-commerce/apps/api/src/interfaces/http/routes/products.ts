import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { GetProductBySlugUseCase } from '../../../application/use-cases/products/GetProductBySlugUseCase';
import { ListPublicProductsUseCase } from '../../../application/use-cases/products/ListPublicProductsUseCase';
import { ApiResponse, ProductPublicDto } from '@goldplus/shared';

const routes = new Hono<{ Variables: { requestId: string } }>();

routes.get('/', async (c) => {
  const registry = Registry.getInstance();
  const useCase = new ListPublicProductsUseCase(registry.productRepo);

  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const dtos = await useCase.execute({ limit: Number.isFinite(limit) ? (limit as number) : undefined });

  const res: ApiResponse<ProductPublicDto[]> = {
    success: true,
    data: dtos,
    meta: { requestId: c.get('requestId') as string | undefined },
  };
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

import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

const routes = new Hono();
const registry = Registry.getInstance();

routes.get('/', async (c) => {
  try {
    const list = await registry.getProductListUseCase.execute();
    return c.json({ success: true, data: list });
  } catch (err: any) {
    if (err.message.includes('DATABASE_URL')) {
      return c.json({ success: false, error: { code: 'DB_NOT_CONFIGURED', message: 'Database connection is not configured.' } }, 503);
    }
    throw err;
  }
});

routes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const product = await registry.productRepo.findBySlug(slug);

  if (!product) {
    return c.json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } }, 404);
  }

  const res: ApiResponse<any> = {
    success: true,
    data: product,
  };
  return c.json(res);
});

export default routes;

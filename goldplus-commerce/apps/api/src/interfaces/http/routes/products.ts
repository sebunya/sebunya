import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { ApiResponse } from '@goldplus/shared';

const routes = new Hono();
const registry = Registry.getInstance();

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

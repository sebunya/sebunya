import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { AdminUserDto } from '../../../../application/use-cases/admin/ListAdminUsersUseCase';

const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.AUTH_MANAGE]), async (c) => {
  const useCase = Registry.getInstance().listAdminUsersUseCase;
  const data = await useCase.execute();

  const res: ApiResponse<AdminUserDto[]> = { success: true, data };
  return c.json(res);
});

export default routes;

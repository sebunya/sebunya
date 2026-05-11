import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { AdminRoleDto } from '../../../../application/use-cases/admin/ListAdminRolesUseCase';

const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.ROLES_MANAGE]), async (c) => {
  const useCase = Registry.getInstance().listAdminRolesUseCase;
  const data = await useCase.execute();

  const res: ApiResponse<AdminRoleDto[]> = { success: true, data };
  return c.json(res);
});

export default routes;

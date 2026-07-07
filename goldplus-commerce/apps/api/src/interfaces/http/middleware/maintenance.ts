import { Context, Next } from 'hono';
import { deploymentService } from '../../../infrastructure/deployment/DeploymentService';
import { ApiResponse } from '@goldplus/shared';
import { logger } from '../../../infrastructure/logging/logger';

export async function maintenanceMode(c: Context, next: Next) {
  if (deploymentService.getMaintenanceMode()) {
    const method = c.req.method.toUpperCase();
    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    
    // Exempt health, metrics, and admin deployment routes from freeze
    const isExemptedRoute = 
      c.req.path.startsWith('/health') || 
      c.req.path.startsWith('/metrics') || 
      c.req.path.includes('/admin/deployment') ||
      c.req.path.includes('/admin/queues'); // allow admin queue operations (e.g. replays)

    if (isWriteOperation && !isExemptedRoute) {
      logger.warn(
        { method, path: c.req.path, requestId: c.get('requestId') },
        '[MaintenanceMode] Blocked write operation during deployment freeze'
      );
      
      const res: ApiResponse<never> = {
        success: false,
        error: {
          code: 'SYSTEM_UNDER_MAINTENANCE',
          message: 'The system is temporarily undergoing maintenance. Write operations are frozen.',
        },
        meta: {
          requestId: c.get('requestId') as string,
        }
      };
      
      return c.json(res, 503);
    }
  }
  
  await next();
}

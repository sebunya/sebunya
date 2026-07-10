import { describe, it, expect } from 'vitest';
import { DefaultControlledActivationAccessPolicy } from '../../../src/infrastructure/activation/DefaultControlledActivationAccessPolicy.js';

describe('DefaultControlledActivationAccessPolicy', () => {
  const mockRoleRepo: any = {
    findPermissionsForUser: async (userId: string) => {
      if (userId === 'admin-id') return ['settings.manage', 'reports.read'];
      if (userId === 'basic-id') return ['reports.read'];
      return [];
    }
  };

  const policy = new DefaultControlledActivationAccessPolicy(mockRoleRepo);

  it('allows access if user has both required permissions', async () => {
    const result = await policy.canCreateActivationRequest('admin-id');
    expect(result).toBe(true);
  });

  it('denies access if user lacks permissions', async () => {
    const result = await policy.canCreateActivationRequest('basic-id');
    expect(result).toBe(false);
  });
});

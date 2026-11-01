import { describe, expect, it } from 'vitest';
import { BusinessInfoService } from '../../apps/api/src/application/business/BusinessInfoService';
import { DEFAULT_BUSINESS_INFO } from '@goldplus/shared';

function service() {
  let saved: any = null;
  const repo = { getConfig: async () => null, updateConfig: async (c: any) => { saved = c; return { version: 1 }; } };
  return { svc: new BusinessInfoService(repo as never), saved: () => saved };
}

describe('business info: a blank field is not zero', () => {
  it('a null or empty cutoff keeps the default instead of becoming midnight', async () => {
    for (const blank of [null, '', '  ']) {
      const { svc, saved } = service();
      await svc.updateConfig({ sameDayCutoffHour: blank as never }, 'admin');
      expect(saved().sameDayCutoffHour).toBe(DEFAULT_BUSINESS_INFO.sameDayCutoffHour);
    }
    const { svc, saved } = service();
    await svc.updateConfig({ sameDayCutoffHour: '0' as never }, 'admin');
    expect(saved().sameDayCutoffHour).toBe(0); // an explicit 0 is still honoured
  });

  it('blank closed-day entries are dropped, not read as Sunday', async () => {
    const { svc, saved } = service();
    await svc.updateConfig({ closedDays: [null, '', 6] as never }, 'admin');
    expect(saved().closedDays).toEqual([6]);
  });
});

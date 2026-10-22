import { Hono } from 'hono';
import { Registry } from '../../../infrastructure/Registry';
import { normaliseReferralCode, referralShareChannel } from '../../../domain/loyalty/Referral';
import { ApiResponse } from '@goldplus/shared';

/**
 * Invite links (2026-10-22). Public and read-mostly: the storefront's /r/<code> page asks who invited the friend and
 * records that the link was opened. Nothing here pays anything or reveals more than a short name ("Rob S.").
 */
const routes = new Hono();

routes.get('/invite/:code', async (c) => {
  const code = normaliseReferralCode(c.req.param('code'));
  const registry = Registry.getInstance();
  const config = await registry.loyaltyCompletionRepo.getProgrammeConfig();
  const live = config.enabled && !config.killSwitch && config.referralReferrerPoints !== null;
  const inviter = code && live ? await registry.loyaltyReferralRepo.inviterFor(code) : null;
  if (!code || !inviter) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'This invite link is not active.' } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data: { code, inviter: inviter.name, refereePoints: config.referralRefereePoints } });
});

routes.post('/visit', async (c) => {
  const body = await c.req.json().catch(() => null);
  const code = normaliseReferralCode(body?.code);
  const visitorKey = typeof body?.visitorKey === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(body.visitorKey) ? body.visitorKey : null;
  if (!code || !visitorKey) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'code and visitorKey are required.' } } satisfies ApiResponse<never>, 400);
  await Registry.getInstance().loyaltyReferralRepo.recordVisit(code, visitorKey, referralShareChannel(body?.via));
  return c.json({ success: true, data: { recorded: true } });
});

export default routes;

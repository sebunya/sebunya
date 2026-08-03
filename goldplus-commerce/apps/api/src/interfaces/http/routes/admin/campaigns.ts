import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import {
  CAMPAIGN_CHANNELS,
  canTransitionCampaign,
  validateUtm,
} from '../../../../application/use-cases/campaigns/CampaignScaffold';

/**
 * Campaign scaffold admin surface (Wave 2F, NO-SEND). Definitions, UTM links and a
 * count-only audience preview. No provider adapter is reachable from here; sending
 * states are refused by the governance helper with an honest message.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: any, data: T) => c.json({ success: true, data } satisfies ApiResponse<T>);
const bad = (c: any, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status);
const actor = (c: any): string => (c.get('user') as { id: string }).id;

routes.get('/', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  return ok(c, { campaigns: await Registry.getInstance().campaignRepo.list(), sendCapability: 'NOT_BUILT_BY_DESIGN' });
});

routes.get('/audience-preview', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const preview = await Registry.getInstance().campaignRepo.abandonedCartAudiencePreview();
  return ok(c, {
    kind: 'ABANDONED_CARTS',
    ...preview,
    consentNote:
      'Counts only. Consent, suppression, frequency and recency gates are evaluated at the send wave — no message can be sent from this scaffold.',
  });
});

routes.get('/:id/utm-links', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  return ok(c, { links: await Registry.getInstance().campaignRepo.listUtmLinks(c.req.param('id') ?? '') });
});

routes.post('/', requirePermissions([PERMISSIONS.CAMPAIGNS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 255) : '';
  const objective = typeof body?.objective === 'string' ? body.objective.trim().slice(0, 50) : '';
  const channel = typeof body?.channel === 'string' ? body.channel.trim() : '';
  const targetUrl = typeof body?.targetUrl === 'string' && body.targetUrl.trim() ? body.targetUrl.trim().slice(0, 500) : null;
  if (!name || !objective) return bad(c, 'BAD_INPUT', 'name and objective are required.');
  if (!CAMPAIGN_CHANNELS.includes(channel as never)) {
    return bad(c, 'BAD_INPUT', `channel must be one of: ${CAMPAIGN_CHANNELS.join(', ')}`);
  }
  if (targetUrl && !/^https:\/\/(www\.)?shopgoldplus\.com(\/|$)/.test(targetUrl)) {
    return bad(c, 'BAD_INPUT', 'targetUrl must be an https://shopgoldplus.com URL.');
  }
  const registry = Registry.getInstance();
  const row = await registry.campaignRepo.create({ name, objective, channel, targetUrl });
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actor(c), action: 'CAMPAIGN_CREATED', entity: 'campaign', entityId: row.id,
    newState: { name, objective, channel, targetUrl, status: row.status },
  });
  return ok(c, row);
});

routes.post('/:id/status', requirePermissions([PERMISSIONS.CAMPAIGNS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  const to = typeof body?.status === 'string' ? body.status.trim() : '';
  const registry = Registry.getInstance();
  const current = await registry.campaignRepo.findById(id);
  if (!current) return bad(c, 'NOT_FOUND', 'Campaign not found.', 404);
  const decision = canTransitionCampaign(current.status, to);
  if (!decision.allowed) return bad(c, decision.code, decision.message, 409);
  const row = await registry.campaignRepo.setStatus(id, to);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actor(c), action: 'CAMPAIGN_STATUS_CHANGED', entity: 'campaign', entityId: id,
    previousState: { status: current.status }, newState: { status: to },
  });
  return ok(c, row);
});

routes.post('/:id/utm-links', requirePermissions([PERMISSIONS.CAMPAIGNS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  const utm = validateUtm(body ?? {});
  if (!utm.ok) return bad(c, 'BAD_INPUT', utm.message);
  const registry = Registry.getInstance();
  const campaign = await registry.campaignRepo.findById(id);
  if (!campaign) return bad(c, 'NOT_FOUND', 'Campaign not found.', 404);
  const content = typeof body?.content === 'string' && body.content.trim() ? body.content.trim().slice(0, 100) : null;
  const term = typeof body?.term === 'string' && body.term.trim() ? body.term.trim().slice(0, 100) : null;
  const row = await registry.campaignRepo.addUtmLink(id, { ...utm, content, term });
  if (!row) return bad(c, 'DUPLICATE', 'An identical UTM link already exists for this campaign.', 409);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: actor(c), action: 'CAMPAIGN_UTM_LINK_ADDED', entity: 'campaign', entityId: id,
    newState: { source: utm.source, medium: utm.medium, campaignName: utm.campaignName, shortUrl: row.shortUrl },
  });
  return ok(c, row);
});

export default routes;

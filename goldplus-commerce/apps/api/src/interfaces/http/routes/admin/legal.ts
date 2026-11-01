import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { LegalOutcome, LegalVersionRecord } from '../../../../application/use-cases/legal/LegalCmsUseCase';

/**
 * Admin surface for the legal-policy CMS (Wave 2C). Governance (maker/checker,
 * immutability, scheduling) is enforced in the use case; this layer adds
 * permissions, audit and transport. approve carries its own permission so the
 * two-person rule can also be split across roles.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: any, data: T) => c.json({ success: true, data } satisfies ApiResponse<T>);
const bad = (c: any, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status);
const actor = (c: any): string => (c.get('user') as { id: string }).id;

const respond = async (c: any, outcome: LegalOutcome<LegalVersionRecord>, auditAction?: string) => {
  if (!outcome.ok) return bad(c, outcome.code, outcome.message, outcome.status as any);
  if (auditAction) {
    await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
      actorId: actor(c),
      action: auditAction,
      entity: 'legal_policy_version',
      entityId: outcome.value.id,
      newState: { policyKey: outcome.value.policyKey, version: outcome.value.version, status: outcome.value.status },
    });
  }
  return ok(c, outcome.value);
};

routes.get('/', requirePermissions([PERMISSIONS.LEGAL_READ]), async (c) => {
  const policies = await Registry.getInstance().legalCmsUseCase.list();
  return ok(c, {
    policies: policies.map((p) => ({
      key: p.key,
      title: p.title,
      currentVersion: p.versions.find((v) => v.id === p.currentVersionId) ?? null,
      versions: p.versions.map(({ bodyMarkdown: _body, ...rest }) => rest),
    })),
  });
});

routes.get('/versions/:id', requirePermissions([PERMISSIONS.LEGAL_READ]), async (c) => {
  const version = await Registry.getInstance().legalCmsRepo.findVersion(c.req.param('id') ?? '');
  if (!version) return bad(c, 'NOT_FOUND', 'Version not found.', 404);
  return ok(c, version);
});

routes.post('/:key/drafts', requirePermissions([PERMISSIONS.LEGAL_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return bad(c, 'BAD_INPUT', 'Expected a JSON body.');
  const outcome = await Registry.getInstance().legalCmsUseCase.createDraft({
    policyKey: c.req.param('key') ?? '',
    title: String(body.title ?? ''),
    bodyMarkdown: String(body.bodyMarkdown ?? ''),
    changeNote: body.changeNote ?? null,
    seoTitle: body.seoTitle ?? null,
    seoDescription: body.seoDescription ?? null,
    actorId: actor(c),
  });
  return respond(c, outcome, 'LEGAL_DRAFT_CREATED');
});

routes.post('/versions/:id/update', requirePermissions([PERMISSIONS.LEGAL_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return bad(c, 'BAD_INPUT', 'Expected a JSON body.');
  const patch: Record<string, string | null> = {};
  for (const key of ['title', 'bodyMarkdown', 'changeNote', 'seoTitle', 'seoDescription'] as const) {
    if (typeof body[key] === 'string') patch[key] = body[key];
  }
  const outcome = await Registry.getInstance().legalCmsUseCase.updateDraft(c.req.param('id') ?? '', patch);
  return respond(c, outcome, 'LEGAL_DRAFT_UPDATED');
});

routes.post('/versions/:id/submit-review', requirePermissions([PERMISSIONS.LEGAL_MANAGE]), async (c) => {
  const outcome = await Registry.getInstance().legalCmsUseCase.submitForReview(c.req.param('id') ?? '');
  return respond(c, outcome, 'LEGAL_SUBMITTED_FOR_REVIEW');
});

routes.post('/versions/:id/approve', requirePermissions([PERMISSIONS.LEGAL_APPROVE]), async (c) => {
  const outcome = await Registry.getInstance().legalCmsUseCase.approve(c.req.param('id') ?? '', actor(c));
  return respond(c, outcome, 'LEGAL_VERSION_APPROVED');
});

routes.post('/versions/:id/publish', requirePermissions([PERMISSIONS.LEGAL_APPROVE]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let effectiveAt: Date | null = null;
  if (body?.effectiveAt) {
    const d = new Date(body.effectiveAt);
    if (Number.isNaN(d.getTime())) return bad(c, 'BAD_INPUT', 'effectiveAt is not a valid date.');
    effectiveAt = d;
  }
  const outcome = await Registry.getInstance().legalCmsUseCase.publish(c.req.param('id') ?? '', effectiveAt);
  return respond(c, outcome, 'LEGAL_VERSION_PUBLISHED');
});

routes.post('/versions/:id/archive', requirePermissions([PERMISSIONS.LEGAL_MANAGE]), async (c) => {
  const outcome = await Registry.getInstance().legalCmsUseCase.archive(c.req.param('id') ?? '');
  return respond(c, outcome, 'LEGAL_VERSION_ARCHIVED');
});

routes.post('/:key/rollback', requirePermissions([PERMISSIONS.LEGAL_APPROVE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const versionId = typeof body?.versionId === 'string' ? body.versionId : '';
  if (!versionId) return bad(c, 'BAD_INPUT', 'versionId is required.');
  const outcome = await Registry.getInstance().legalCmsUseCase.rollback(c.req.param('key') ?? '', versionId);
  return respond(c, outcome, 'LEGAL_VERSION_ROLLED_BACK');
});

export default routes;

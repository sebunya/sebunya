import { Hono, type Context } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import {
  ROBOTS_STATUSES,
  validateRobotsDraft,
  validateRobotsContent,
  gateRobotsContent,
  checkApprover,
  canTransition,
  diffRobots,
  fallbackRobotsTxt,
} from '../../../../application/use-cases/seo-growth/RobotsGovernanceUseCases';

/**
 * robots.txt governance admin API (migration 0120).
 *
 * Every handler here requires a session. The PUBLIC read the storefront uses
 * to build robots.txt lives at GET /seo/robots-published on the public router:
 * robots.txt is public by definition, so serving it must never depend on an
 * admin token — and a public route has no business inside an /admin surface.
 *
 * Mutations require SEO_ROBOTS_MANAGE; Mutations require SEO_ROBOTS_MANAGE;
 * approval additionally requires SEO_APPROVE_HIGH_RISK and refuses the author.
 */

const routes = new Hono();

const ok = (c: Context, data: unknown, status = 200) => c.json({ success: true, data }, status as 200);
const bad = (c: Context, code: string, message: string, status = 400, extra?: Record<string, unknown>) =>
  c.json({ success: false, error: { code, message, ...(extra ?? {}) } }, status as 400);
const json = async (c: Context): Promise<any | null> => c.req.json().catch(() => null);
const actorId = (c: Context): string => (c.get('user') as any).id as string;
const repo = () => Registry.getInstance().seoTechnicalRepo;

/** Platform audit trail — every robots.txt mutation is recorded. */
const audit = async (c: Context, action: string, detail: Record<string, unknown>): Promise<void> => {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: actorId(c),
    action,
    entity: 'seo_robots_version',
    entityId: String(detail.id ?? ''),
    newState: detail,
  });
};

routes.use('*', authMiddleware);

// ── Vocabulary ──────────────────────────────────────────────────────────────

routes.get('/vocabulary', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) =>
  ok(c, {
    statuses: ROBOTS_STATUSES,
    transitions: Object.fromEntries(
      ROBOTS_STATUSES.map((from) => [from, ROBOTS_STATUSES.filter((to) => canTransition(from, to))]),
    ),
  }));

// ── Reads ───────────────────────────────────────────────────────────────────

routes.get('/', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const [versions, live] = await Promise.all([
    repo().listRobotsVersions(Number(c.req.query('limit') ?? 50)),
    repo().getPublishedRobots(),
  ]);
  return ok(c, {
    items: versions,
    published: live,
    // No published row is a real, reportable state — not an error and not a
    // reason to imply the static file does not exist.
    publishedState: live ? 'PUBLISHED' : 'NONE_PUBLISHED',
    findingsForPublished: live ? validateRobotsContent(live.content) : [],
  });
});

/** A unified line diff between any two versions. */
routes.get('/diff/compare', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const fromId = c.req.query('from') ?? '';
  const toId = c.req.query('to') ?? '';
  if (!fromId || !toId) return bad(c, 'BAD_INPUT', 'Both "from" and "to" version ids are required.');
  const [from, to] = await Promise.all([repo().getRobotsVersion(fromId), repo().getRobotsVersion(toId)]);
  if (!from || !to) return bad(c, 'NOT_FOUND', 'One or both versions were not found.', 404);
  return ok(c, {
    from: { id: from.id, version: from.version, status: from.status },
    to: { id: to.id, version: to.version, status: to.status },
    diff: diffRobots(from.content, to.content),
  });
});

routes.get('/:id', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const row = await repo().getRobotsVersion(c.req.param('id') ?? '');
  if (!row) return bad(c, 'NOT_FOUND', 'robots.txt version not found.', 404);
  return ok(c, { version: row, findings: validateRobotsContent(row.content) });
});

// ── Validation (dry run, no write) ──────────────────────────────────────────

routes.post('/validate', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const gate = gateRobotsContent(body.content, body.acknowledgeRisk);
  return ok(c, {
    accepted: gate.ok,
    code: gate.ok ? null : gate.code,
    message: gate.ok ? null : gate.message,
    findings: gate.findings,
  });
});

// ── Mutations ───────────────────────────────────────────────────────────────

routes.post('/', requirePermissions([PERMISSIONS.SEO_ROBOTS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const validation = validateRobotsDraft(body);
  if (!validation.ok) {
    return bad(
      c,
      validation.code,
      validation.message,
      validation.code === 'ROBOTS_RISK_NOT_ACKNOWLEDGED' ? 422 : 400,
      { findings: validation.findings ?? [] },
    );
  }
  const row = await repo().createRobotsDraft({
    content: validation.input.content,
    note: validation.input.note ?? null,
    restoredFromId: validation.input.restoredFromId ?? null,
    createdBy: actorId(c),
  });
  await audit(c, 'SEO_ROBOTS_DRAFT_CREATED', {
    id: row?.id,
    version: row?.version,
    restoredFromId: validation.input.restoredFromId ?? null,
    acknowledgedRisks: validation.input.acknowledged.map((f) => f.code),
  });
  return ok(c, { version: row, findings: validation.input.findings }, 201);
});

/**
 * Rollback = a NEW draft carrying a prior version's content. History is never
 * mutated and the prior version is never resurrected in place.
 */
routes.post('/:id/rollback', requirePermissions([PERMISSIONS.SEO_ROBOTS_MANAGE]), async (c) => {
  const sourceId = c.req.param('id') ?? '';
  const source = await repo().getRobotsVersion(sourceId);
  if (!source) return bad(c, 'NOT_FOUND', 'robots.txt version not found.', 404);
  const body = (await json(c)) ?? {};
  const gate = gateRobotsContent(source.content, body.acknowledgeRisk);
  if (!gate.ok) return bad(c, gate.code, gate.message, 422, { findings: gate.findings });

  const row = await repo().createRobotsDraft({
    content: String(source.content ?? ''),
    note:
      typeof body.note === 'string' && body.note.trim() !== ''
        ? body.note.trim()
        : `Rollback to version ${source.version}.`,
    restoredFromId: sourceId,
    createdBy: actorId(c),
  });
  await audit(c, 'SEO_ROBOTS_ROLLBACK_DRAFTED', {
    id: row?.id, version: row?.version, restoredFromId: sourceId, restoredFromVersion: source.version,
  });
  return ok(c, { version: row, findings: gate.findings }, 201);
});

routes.post('/:id/submit', requirePermissions([PERMISSIONS.SEO_ROBOTS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const existing = await repo().getRobotsVersion(id);
  if (!existing) return bad(c, 'NOT_FOUND', 'robots.txt version not found.', 404);
  if (!canTransition(existing.status, 'PENDING_APPROVAL')) {
    return bad(c, 'ILLEGAL_TRANSITION', `A ${existing.status} version cannot be submitted for approval.`, 422);
  }
  const body = (await json(c)) ?? {};
  const gate = gateRobotsContent(existing.content, body.acknowledgeRisk);
  if (!gate.ok) return bad(c, gate.code, gate.message, 422, { findings: gate.findings });

  const row = await repo().submitRobotsVersion(id, typeof body.note === 'string' ? body.note.trim() : null);
  if (!row) return bad(c, 'ILLEGAL_TRANSITION', 'The version was no longer a DRAFT.', 409);
  await audit(c, 'SEO_ROBOTS_SUBMITTED_FOR_APPROVAL', {
    id, version: row.version, acknowledgedRisks: gate.acknowledged.map((f) => f.code),
  });
  return ok(c, { version: row, findings: gate.findings });
});

/** Approval: high-risk permission AND a different person from the author. */
routes.post(
  '/:id/approve',
  requirePermissions([PERMISSIONS.SEO_ROBOTS_MANAGE, PERMISSIONS.SEO_APPROVE_HIGH_RISK]),
  async (c) => {
    const id = c.req.param('id') ?? '';
    const existing = await repo().getRobotsVersion(id);
    if (!existing) return bad(c, 'NOT_FOUND', 'robots.txt version not found.', 404);
    if (!canTransition(existing.status, 'APPROVED')) {
      return bad(c, 'ILLEGAL_TRANSITION', `A ${existing.status} version cannot be approved.`, 422);
    }
    const separation = checkApprover(existing.created_by, actorId(c));
    if (!separation.ok) return bad(c, separation.code, separation.message, 403);

    const body = (await json(c)) ?? {};
    const gate = gateRobotsContent(existing.content, body.acknowledgeRisk);
    if (!gate.ok) return bad(c, gate.code, gate.message, 422, { findings: gate.findings });

    const row = await repo().approveRobotsVersion(id, actorId(c));
    if (!row) return bad(c, 'ILLEGAL_TRANSITION', 'The version was no longer awaiting approval.', 409);
    await audit(c, 'SEO_ROBOTS_APPROVED', {
      id, version: row.version, authorId: existing.created_by,
      acknowledgedRisks: gate.acknowledged.map((f) => f.code),
    });
    return ok(c, { version: row, findings: gate.findings });
  },
);

routes.post('/:id/reject', requirePermissions([PERMISSIONS.SEO_ROBOTS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = (await json(c)) ?? {};
  const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
  if (!note) return bad(c, 'REASON_REQUIRED', 'A rejection must say why. Record the reason in "note".', 422);
  const row = await repo().rejectRobotsVersion(id, actorId(c), note);
  if (!row) return bad(c, 'ILLEGAL_TRANSITION', 'This version cannot be rejected in its current state.', 409);
  await audit(c, 'SEO_ROBOTS_REJECTED', { id, version: row.version, note });
  return ok(c, { version: row });
});

/**
 * Publish. Supersedes the incumbent atomically so the partial unique index
 * never sees two PUBLISHED rows.
 */
routes.post(
  '/:id/publish',
  requirePermissions([PERMISSIONS.SEO_ROBOTS_MANAGE, PERMISSIONS.SEO_APPROVE_HIGH_RISK]),
  async (c) => {
    const id = c.req.param('id') ?? '';
    const existing = await repo().getRobotsVersion(id);
    if (!existing) return bad(c, 'NOT_FOUND', 'robots.txt version not found.', 404);
    if (!canTransition(existing.status, 'PUBLISHED')) {
      return bad(c, 'ILLEGAL_TRANSITION', `A ${existing.status} version cannot be published. Approve it first.`, 422);
    }
    const body = (await json(c)) ?? {};
    const gate = gateRobotsContent(existing.content, body.acknowledgeRisk);
    if (!gate.ok) return bad(c, gate.code, gate.message, 422, { findings: gate.findings });

    const result = await repo().publishRobotsVersion(id);
    if (!result.published) return bad(c, 'ILLEGAL_TRANSITION', 'The version was no longer APPROVED.', 409);
    await audit(c, 'SEO_ROBOTS_PUBLISHED', {
      id,
      version: result.published.version,
      supersededVersionId: result.superseded?.id ?? null,
      supersededVersion: result.superseded?.version ?? null,
      acknowledgedRisks: gate.acknowledged.map((f) => f.code),
    });
    return ok(c, { version: result.published, superseded: result.superseded, findings: gate.findings });
  },
);

export default routes;

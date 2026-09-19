import { Hono, type Context } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';
import type { Actor, Result } from '../../../../application/use-cases/ai-visibility/AiVisibilitySetupUseCases';

/**
 * AI Search Visibility API (0131), mounted at /admin/ai-visibility.
 *
 * Thin: every handler parses input, calls one use case and maps its Result.
 * All business rules (budget, approvals, four eyes, evidence) live in the use
 * cases, so the web UI, scripts and agents get identical behaviour. Every
 * mutation is audited inside its use case (createAuditLogUseCase).
 *
 * Machine actors: a caller may send `X-Actor-Kind: AGENT` (or SCHEDULER,
 * API_KEY). The header can only LOWER privileges — agent runs always wait for
 * a person and agents can never approve — it never raises them.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const P = PERMISSIONS;
const VIEW = requirePermissions([P.AI_VISIBILITY_VIEW]);
const MANAGE = requirePermissions([P.AI_VISIBILITY_MANAGE]);
const RUN = requirePermissions([P.AI_VISIBILITY_RUN]);
const APPROVE = requirePermissions([P.AI_VISIBILITY_APPROVE]);
const CREDENTIALS = requirePermissions([P.AI_VISIBILITY_CREDENTIALS]);

const svc = () => Registry.getInstance().aiVisibility;
const MACHINE = new Set(['AGENT', 'SCHEDULER', 'API_KEY', 'WEBHOOK', 'SYSTEM']);
const actor = (c: Context): Actor => {
  const id = (c.get('user') as { id?: string } | undefined)?.id ?? null;
  const declared = String(c.req.header('x-actor-kind') ?? '').toUpperCase();
  return { id, kind: MACHINE.has(declared) ? (declared as Actor['kind']) : 'USER' };
};
const body = async (c: Context): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
};
const STATUS: Record<string, number> = { NOT_FOUND: 404, BAD_INPUT: 400, CONFLICT: 409, NOT_CONFIGURED: 409, FORBIDDEN: 403, BUDGET: 402, UPSTREAM: 502 };
const send = <T>(c: Context, r: Result<T>, okStatus = 200) =>
  r.ok ? c.json({ success: true, data: r.value }, okStatus as never) : c.json({ success: false, error: { code: r.code, message: r.message } }, (STATUS[r.code] ?? 400) as never);
const data = (c: Context, v: unknown) => c.json({ success: true, data: v });
const prm = (c: Context, k: string): string => c.req.param(k) ?? '';
const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
const bool = (v: string | undefined) => (v === 'true' ? true : v === 'false' ? false : undefined);

/** Resolves :project (id or slug) once; 404 when absent. */
const project = async (c: Context) => svc().setup.getProject(c.req.param('project') ?? '');

// ── Projects ──────────────────────────────────────────────────────────────────
routes.get('/projects', VIEW, async (c) => data(c, await svc().setup.listProjects()));
routes.post('/projects', MANAGE, async (c) => send(c, await svc().setup.createProject(actor(c), await body(c)), 201));
routes.get('/projects/:project', VIEW, async (c) => send(c, await project(c)));
routes.patch('/projects/:project', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.updateProject(actor(c), p.value.id, await body(c)));
});

routes.post('/projects/:project/reclassify', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.reclassify(actor(c), p.value.id));
});

// ── Competitors ───────────────────────────────────────────────────────────────
routes.get('/projects/:project/competitors', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return data(c, await svc().setup.competitors(p.value.id));
});
routes.post('/projects/:project/competitors/:competitorId/pin', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.pinCompetitor(actor(c), p.value.id, prm(c, 'competitorId'), true));
});
routes.delete('/projects/:project/competitors/:competitorId/pin', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.pinCompetitor(actor(c), p.value.id, prm(c, 'competitorId'), false));
});

// ── Queries ───────────────────────────────────────────────────────────────────
routes.get('/projects/:project/queries', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return data(c, await svc().setup.listQueries(p.value.id, { active: bool(c.req.query('active')), search: c.req.query('search') || undefined, limit: int(c.req.query('limit'), 200), offset: int(c.req.query('offset'), 0) }));
});
routes.post('/projects/:project/queries', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.createQuery(actor(c), p.value.id, await body(c)), 201);
});
routes.patch('/projects/:project/queries/:queryId', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.updateQuery(actor(c), p.value.id, prm(c, 'queryId'), await body(c)));
});

// ── Providers (keys are write-only: never returned, only a mask) ──────────────
routes.get('/projects/:project/providers', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return data(c, await svc().setup.providerConfigs(p.value.id));
});
routes.patch('/projects/:project/providers/:provider', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.updateProvider(actor(c), p.value.id, prm(c, 'provider').toUpperCase(), await body(c)));
});
routes.put('/projects/:project/providers/:provider/credential', CREDENTIALS, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const b = await body(c);
  if (typeof b.apiKey !== 'string' || b.apiKey.length > 500) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'apiKey is required.' } }, 400);
  return send(c, await svc().setup.setCredential(actor(c), p.value.id, prm(c, 'provider').toUpperCase(), b.apiKey));
});
routes.delete('/projects/:project/providers/:provider/credential', CREDENTIALS, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.setCredential(actor(c), p.value.id, prm(c, 'provider').toUpperCase(), null));
});
routes.post('/projects/:project/providers/:provider/test', CREDENTIALS, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().setup.testProvider(actor(c), p.value.id, prm(c, 'provider').toUpperCase()));
});

// ── Runs ──────────────────────────────────────────────────────────────────────
routes.get('/projects/:project/runs', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const kind = c.req.query('kind');
  return data(c, await svc().runs.listRuns(p.value.id, int(c.req.query('limit'), 20), int(c.req.query('offset'), 0), kind === 'MONITOR' || kind === 'RESEARCH' || kind === 'VERIFICATION' ? kind : undefined));
});
routes.post('/projects/:project/runs', RUN, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const b = await body(c);
  const r = await svc().runs.start(actor(c), p.value.id, {
    kind: 'MONITOR',
    providers: Array.isArray(b.providers) ? b.providers.map(String) : undefined,
    queryIds: Array.isArray(b.queryIds) ? b.queryIds.map(String) : undefined,
    idempotencyKey: typeof b.idempotencyKey === 'string' ? b.idempotencyKey : undefined,
  });
  return send(c, r, r.ok && r.value.created ? 202 : 200);
});
routes.post('/projects/:project/research', RUN, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const b = await body(c);
  const r = await svc().runs.start(actor(c), p.value.id, {
    kind: 'RESEARCH',
    providers: Array.isArray(b.providers) ? b.providers.map(String) : undefined,
    adhocQueries: Array.isArray(b.questions) ? b.questions.map(String) : typeof b.questions === 'string' ? b.questions.split('\n') : [],
    idempotencyKey: typeof b.idempotencyKey === 'string' ? b.idempotencyKey : undefined,
  });
  return send(c, r, r.ok && r.value.created ? 202 : 200);
});
routes.get('/projects/:project/runs/:runId', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const run = await svc().runs.getRun(p.value.id, prm(c, 'runId'));
  return run ? data(c, run) : c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Run not found.' } }, 404);
});
routes.post('/projects/:project/runs/:runId/approve', APPROVE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().runs.approve(actor(c), p.value.id, prm(c, 'runId')));
});
routes.post('/projects/:project/runs/:runId/reject', APPROVE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().runs.reject(actor(c), p.value.id, prm(c, 'runId')));
});
routes.post('/projects/:project/runs/:runId/cancel', RUN, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().runs.cancel(actor(c), p.value.id, prm(c, 'runId')));
});

// ── Evidence & insight (read) ─────────────────────────────────────────────────
routes.get('/projects/:project/summary', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().insights.summary(p.value.id, Math.min(int(c.req.query('days'), 28), 365)));
});
routes.get('/projects/:project/report', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().insights.report(p.value.id, Math.min(int(c.req.query('days'), 28), 365)));
});
routes.post('/projects/:project/schedules/tick', APPROVE, async (c) => {
  // Manual trigger of the hourly schedule check (same use case as the cron).
  return data(c, await svc().runs.runSchedules());
});
routes.get('/projects/:project/gaps', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().insights.gaps(p.value.id));
});
routes.get('/projects/:project/landscape', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().insights.landscape(p.value.id));
});
routes.get('/projects/:project/answers', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const q = (k: string) => c.req.query(k) || undefined;
  return data(c, await svc().insights.listAnswers(p.value.id, {
    runId: q('runId'), queryId: q('queryId'), provider: q('provider'), runKind: q('runKind'), status: q('status'),
    mentioned: bool(q('mentioned')), cited: bool(q('cited')), fromIso: q('from'), toIso: q('to'),
    limit: int(q('limit'), 50), offset: int(q('offset'), 0),
  }));
});
routes.get('/projects/:project/answers/:answerId', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().insights.answer(p.value.id, prm(c, 'answerId')));
});
routes.get('/projects/:project/queries/:queryId/compare', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().insights.compare(p.value.id, prm(c, 'queryId')));
});

// ── Actions ───────────────────────────────────────────────────────────────────
routes.get('/projects/:project/actions', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return data(c, await svc().actions.list(p.value.id, c.req.query('status') || null, int(c.req.query('limit'), 50), int(c.req.query('offset'), 0)));
});
routes.post('/projects/:project/actions', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().actions.propose(actor(c), p.value.id, await body(c)), 201);
});
routes.get('/projects/:project/actions/:actionId', VIEW, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().actions.get(p.value.id, prm(c, 'actionId')));
});
routes.post('/projects/:project/actions/:actionId/submit', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().actions.submit(actor(c), p.value.id, prm(c, 'actionId')));
});
routes.post('/projects/:project/actions/:actionId/approve', APPROVE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const b = await body(c);
  return send(c, await svc().actions.approve(actor(c), p.value.id, prm(c, 'actionId'), b.note ? String(b.note) : null));
});
routes.post('/projects/:project/actions/:actionId/reject', APPROVE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const b = await body(c);
  return send(c, await svc().actions.reject(actor(c), p.value.id, prm(c, 'actionId'), b.note ? String(b.note) : null));
});
routes.post('/projects/:project/actions/:actionId/execute', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().actions.execute(actor(c), p.value.id, prm(c, 'actionId'), await body(c)));
});
routes.post('/projects/:project/actions/:actionId/verify', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  return send(c, await svc().actions.verify(actor(c), p.value.id, prm(c, 'actionId')));
});
routes.post('/projects/:project/actions/:actionId/cancel', MANAGE, async (c) => {
  const p = await project(c); if (!p.ok) return send(c, p);
  const b = await body(c);
  return send(c, await svc().actions.cancel(actor(c), p.value.id, prm(c, 'actionId'), b.note ? String(b.note) : null));
});

export default routes;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../infrastructure/Registry';
import { authMiddleware } from '../../interfaces/http/middleware/auth';
import { requirePermissions } from '../../interfaces/http/middleware/permissions';

const liveReview = new Hono<{
  Variables: { adminId?: string; user?: { id: string; email: string; permissions: string[] } };
}>();
const registry = Registry.getInstance();

// This router lives in presentation/ rather than interfaces/http/routes/admin/, so it
// missed the admin auth chain its siblings carry: every handler read an `adminId`
// nothing ever set, and the whole surface returned 401 to legitimate administrators —
// a fail-closed dead module. Same chain as the dry-run sibling: session auth, then a
// method-shaped permission gate (reads observe, writes govern activation), then the
// verified identity becomes the `adminId` the handlers and use cases already expect.
liveReview.use('*', authMiddleware);
liveReview.use('*', async (c, next) => {
  const guard = requirePermissions([
    c.req.method === 'GET' ? PERMISSIONS.REPORTS_READ : PERMISSIONS.SETTINGS_MANAGE,
  ]);
  return guard(c, next);
});
liveReview.use('*', async (c, next) => {
  const user = c.get('user');
  if (user) c.set('adminId', user.id);
  await next();
});

liveReview.post('/dry-runs/:dryRunId/live-review-candidate', zValidator('json', z.object({
  activationRequestId: z.string(),
  executionPlanId: z.string(),
  evidencePackId: z.string(),
  environment: z.string(),
  activationWindowStart: z.string(),
  activationWindowEnd: z.string(),
  canaryScopeSummary: z.string(),
  monitoringOwner: z.string(),
  incidentOwner: z.string(),
  rollbackOwner: z.string(),
})), async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const dryRunId = c.req.param('dryRunId');
  const body = c.req.valid('json');

  const candidate = await registry.createControlledActivationLiveReviewCandidateUseCase.execute({
    adminId,
    dryRunId,
    activationRequestId: body.activationRequestId,
    executionPlanId: body.executionPlanId,
    evidencePackId: body.evidencePackId,
    environment: body.environment,
    activationWindowStart: new Date(body.activationWindowStart),
    activationWindowEnd: new Date(body.activationWindowEnd),
    canaryScopeSummary: body.canaryScopeSummary,
    monitoringOwner: body.monitoringOwner,
    incidentOwner: body.incidentOwner,
    rollbackOwner: body.rollbackOwner,
  });

  return c.json(candidate, 201);
});

liveReview.get('/live-review-candidates', async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);

  const candidates = await registry.listControlledActivationLiveReviewCandidatesUseCase.execute({ adminId });
  return c.json(candidates);
});

liveReview.get('/live-review-candidates/:candidateId', async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const candidateId = c.req.param('candidateId');

  const details = await registry.getControlledActivationLiveReviewCandidateUseCase.execute({ adminId, candidateId });
  return c.json(details);
});

liveReview.post('/live-review-candidates/:candidateId/checks', async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const candidateId = c.req.param('candidateId');

  const checks = await registry.runControlledActivationLiveReadinessChecksUseCase.execute({ adminId, candidateId });
  return c.json(checks);
});

liveReview.post('/live-review-candidates/:candidateId/runbook', async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const candidateId = c.req.param('candidateId');

  const runbook = await registry.buildControlledActivationRunbookUseCase.execute({ adminId, candidateId });
  return c.json(runbook);
});

liveReview.post('/live-review-candidates/:candidateId/stakeholder-approval', zValidator('json', z.object({
  approvalStatus: z.enum(['APPROVED', 'REJECTED', 'NEEDS_CHANGES']),
  approvalNote: z.string(),
})), async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const candidateId = c.req.param('candidateId');
  const body = c.req.valid('json');

  await registry.recordControlledActivationStakeholderLiveApprovalUseCase.execute({
    adminId,
    candidateId,
    approvalStatus: body.approvalStatus,
    approvalNote: body.approvalNote
  });

  return c.json({ success: true });
});

liveReview.post('/live-review-candidates/:candidateId/operator-acknowledgement', zValidator('json', z.object({
  checklistId: z.string(),
  acknowledgementNote: z.string(),
})), async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const candidateId = c.req.param('candidateId');
  const body = c.req.valid('json');

  await registry.recordControlledActivationOperatorAcknowledgementUseCase.execute({
    adminId,
    candidateId,
    checklistId: body.checklistId,
    acknowledgementNote: body.acknowledgementNote
  });

  return c.json({ success: true });
});

liveReview.post('/live-review-candidates/:candidateId/cancel', zValidator('json', z.object({
  cancellationReason: z.string(),
})), async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const candidateId = c.req.param('candidateId');
  const body = c.req.valid('json');

  await registry.cancelControlledActivationLiveReviewCandidateUseCase.execute({
    adminId,
    candidateId,
    cancellationReason: body.cancellationReason
  });

  return c.json({ success: true });
});

liveReview.post('/live-review-candidates/:candidateId/expire', zValidator('json', z.object({
  expiryReason: z.string(),
})), async (c) => {
  const adminId = c.get('adminId');
  if (!adminId) return c.json({ error: 'Unauthorized' }, 401);
  const candidateId = c.req.param('candidateId');
  const body = c.req.valid('json');

  await registry.expireControlledActivationLiveReviewCandidateUseCase.execute({
    adminId,
    candidateId,
    expiryReason: body.expiryReason
  });

  return c.json({ success: true });
});

export { liveReview };

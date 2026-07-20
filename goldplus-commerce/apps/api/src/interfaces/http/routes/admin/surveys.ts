import { Hono } from 'hono';
import { z } from 'zod';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { SurveyOperationError } from '../../../../application/use-cases/surveys/SurveyOperationsUseCase';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';

// audit-exempt: survey governance mutations append immutable survey_events transactionally.
const routes = new Hono(); routes.use('*', authMiddleware);
const actor = (c: any) => (c.get('user') as { id: string }).id;
const question = z.object({ key: z.string(), prompt: z.string(), type: z.enum(['SINGLE_CHOICE','MULTI_CHOICE','SCALE']), required: z.boolean(), options: z.array(z.string()).optional(), min: z.number().int().optional(), max: z.number().int().optional() });
const createBody = z.object({ key: z.string(), title: z.string(), description: z.string().max(1000), purposeKey: z.literal('personalization'), questions: z.array(question).min(1).max(30), audience: z.object({ lifecycleStages: z.array(z.string()).max(10) }) });
const operationBody = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(1000), decision: z.enum(['APPROVED','REJECTED']).optional() });
const fail = (c: any, error: unknown) => { const code = error instanceof SurveyOperationError ? error.code : 'SURVEY_OPERATION_FAILED'; const status = code === 'SURVEY_NOT_FOUND' ? 404 : code === 'STALE_VERSION' ? 409 : 400; return c.json({ success: false, error: { code, message: error instanceof Error ? error.message : 'Survey operation failed.' } }, status); };
routes.get('/', requirePermissions([PERMISSIONS.SURVEYS_READ], 'PERMISSION_DENIED'), async (c) => c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.list() }));
routes.post('/', requirePermissions([PERMISSIONS.SURVEYS_CREATE], 'PERMISSION_DENIED'), async (c) => { const body = createBody.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: body.error.issues[0]?.message ?? 'Invalid body.' } }, 400); try { return c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.create({ ...body.data, actorId: actor(c) }) }, 201); } catch (error) { return fail(c, error); } });
routes.get('/:id', requirePermissions([PERMISSIONS.SURVEYS_READ], 'PERMISSION_DENIED'), async (c) => { try { return c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.detail(String(c.req.param('id') ?? '')) }); } catch (error) { return fail(c, error); } });
routes.get('/:id/analysis', requirePermissions([PERMISSIONS.SURVEYS_READ], 'PERMISSION_DENIED'), async (c) => c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.analysis(String(c.req.param('id') ?? '')) }));
routes.get('/:id/export', requirePermissions([PERMISSIONS.SURVEYS_EXPORT], 'PERMISSION_DENIED'), async (c) => c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.export(String(c.req.param('id') ?? '')) }));
for (const operation of ['submit','approve','activate','pause','close'] as const) routes.post(`/:id/${operation}`, requirePermissions([operation === 'approve' ? PERMISSIONS.SURVEYS_APPROVE : operation === 'activate' || operation === 'pause' ? PERMISSIONS.SURVEYS_ACTIVATE : PERMISSIONS.SURVEYS_MANAGE], 'PERMISSION_DENIED'), async (c) => { const body = operationBody.safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: body.error.issues[0]?.message ?? 'Invalid body.' } }, 400); try { const useCase = Registry.getInstance().surveyOperationsUseCase; const fn = useCase[operation].bind(useCase) as any; return c.json({ success: true, data: await fn({ id: c.req.param('id'), actorId: actor(c), ...body.data }) }); } catch (error) { return fail(c, error); } });
export default routes;

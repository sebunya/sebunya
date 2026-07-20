import { Hono } from 'hono';
import { z } from 'zod';
import { Registry } from '../../../infrastructure/Registry';
import { SurveyOperationError } from '../../../application/use-cases/surveys/SurveyOperationsUseCase';
import { customerSessionMiddleware } from '../middleware/customerSession';

const routes = new Hono<{ Variables: { userId: string; userEmail: string } }>(); routes.use('*', customerSessionMiddleware);
const fail = (c: any, error: unknown) => { const code = error instanceof SurveyOperationError ? error.code : 'SURVEY_OPERATION_FAILED'; const status = code === 'RESPONSE_NOT_FOUND' ? 404 : code === 'STALE_VERSION' ? 409 : 400; return c.json({ success: false, error: { code, message: error instanceof Error ? error.message : 'Survey operation failed.' } }, status); };
routes.get('/', async (c) => c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.eligible(c.get('userId')) }));
routes.post('/:id/start', async (c) => { try { return c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.start(c.req.param('id'), c.get('userId')) }, 201); } catch (error) { return fail(c, error); } });
routes.put('/responses/:id', async (c) => { const body = z.object({ expectedVersion: z.number().int().positive(), answers: z.record(z.string(), z.unknown()) }).safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid answers.' } }, 400); try { return c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.saveAnswers({ id: c.req.param('id'), userId: c.get('userId'), ...body.data }) }); } catch (error) { return fail(c, error); } });
routes.post('/responses/:id/complete', async (c) => { const body = z.object({ expectedVersion: z.number().int().positive() }).safeParse(await c.req.json().catch(() => null)); if (!body.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'Invalid response version.' } }, 400); try { return c.json({ success: true, data: await Registry.getInstance().surveyOperationsUseCase.complete({ id: c.req.param('id'), userId: c.get('userId'), ...body.data }) }); } catch (error) { return fail(c, error); } });
export default routes;

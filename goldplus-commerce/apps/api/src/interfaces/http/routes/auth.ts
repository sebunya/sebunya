import { Hono } from 'hono';
import { AuthenticateUserUseCase } from '../../../application/use-cases/identity/AuthenticateUserUseCase';

export const authRouter = new Hono();
authRouter.post('/login', async (c) => {
  const useCase = new AuthenticateUserUseCase(null); // Dependency injection placeholder
  const result = await useCase.execute('test@example.com'); // Mock input for now
  
  if (!result.success) {
    return c.json(result, 501); // Not Implemented
  }
  
  return c.json(result);
});

export default authRouter;


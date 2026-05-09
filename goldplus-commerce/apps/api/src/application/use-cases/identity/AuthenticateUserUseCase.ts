import { ApiResponse } from '@goldplus/shared';

export class AuthenticateUserUseCase {
  constructor(private readonly eventPublisher: any) {}
  
  async execute(email: string): Promise<ApiResponse<never>> {
    if(!email) throw new Error("Email required");
    
    // Auth is not implemented with a real persistence layer in this mocked version
    return {
      success: false,
      error: {
        code: 'AUTH_NOT_READY',
        message: 'Authentication persistence is not yet implemented. Cannot log in.',
      }
    };
  }
}

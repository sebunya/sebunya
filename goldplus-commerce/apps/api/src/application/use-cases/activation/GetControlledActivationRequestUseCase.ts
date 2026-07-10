import { ControlledActivationRepository, ActivationRequest } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';

export class GetControlledActivationRequestUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(adminId: string, requestId: string): Promise<ActivationRequest> {
    const canView = await this.accessPolicy.canViewActivation(adminId);
    if (!canView) throw new Error('Forbidden: Cannot view activation');

    const request = await this.repository.getActivationRequest(requestId);
    if (!request) throw new Error('Activation request not found');

    return request;
  }
}

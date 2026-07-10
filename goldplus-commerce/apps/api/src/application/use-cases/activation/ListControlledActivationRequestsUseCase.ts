import { ControlledActivationRepository, ActivationRequest } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';

export class ListControlledActivationRequestsUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(adminId: string): Promise<ActivationRequest[]> {
    const canView = await this.accessPolicy.canViewActivation(adminId);
    if (!canView) throw new Error('Forbidden: Cannot view activation requests');

    return this.repository.listActivationRequests();
  }
}

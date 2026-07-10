import { ControlledActivationRepository } from '../../ports/activation/ControlledActivationRepository.js';
import { ControlledActivationAccessPolicy } from '../../ports/activation/ControlledActivationAccessPolicy.js';

export class GetControlledActivationSummaryUseCase {
  constructor(
    private readonly repository: ControlledActivationRepository,
    private readonly accessPolicy: ControlledActivationAccessPolicy
  ) {}

  async execute(adminId: string): Promise<{ total: number; active: number; blocked: number }> {
    const canView = await this.accessPolicy.canViewActivation(adminId);
    if (!canView) throw new Error('Forbidden: Cannot view activation summary');

    const requests = await this.repository.listActivationRequests();
    const active = requests.filter(r => ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED_FOR_CONTROLLED_ACTIVATION'].includes(r.status)).length;
    const blocked = requests.filter(r => r.status === 'BLOCKED').length;

    return { total: requests.length, active, blocked };
  }
}

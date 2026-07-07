import { ISystemHealthRepository, SystemHealthMetrics } from '../../ports/ISystemHealthRepository';

export class CheckSystemHealthUseCase {
  constructor(private readonly healthRepo: ISystemHealthRepository) {}

  async execute(): Promise<SystemHealthMetrics> {
    return this.healthRepo.getHealthMetrics();
  }
}

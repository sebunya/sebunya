import type { DlqRepository } from '../../ports/measurement/DlqRepository';

export class ListMeasurementDlqUseCase {
  constructor(private readonly dlqRepo: DlqRepository) {}

  async execute(limit: number = 100) {
    return await this.dlqRepo.listUnresolved(limit);
  }
}

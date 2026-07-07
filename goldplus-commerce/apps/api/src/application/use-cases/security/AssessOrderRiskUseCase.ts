import { IOrderRiskRepository } from '../../ports/IOrderRiskRepository';
import { assessOrderRisk, RiskAssessment } from '../../../domain/security/RiskEngine';

/**
 * Velocity-based fraud check for checkout. Uses the delivery phone as the
 * abuse key (guests have no account) and blocks only blatant automation,
 * so genuine customers are never turned away.
 */
export class AssessOrderRiskUseCase {
  constructor(private readonly repo: IOrderRiskRepository) {}

  async execute(input: { phone: string }): Promise<RiskAssessment> {
    const phone = (input.phone || '').replace(/\s+/g, '');
    if (!phone) return { score: 0, decision: 'allow', reasons: [] };

    const now = Date.now();
    const [ordersLastHour, ordersLastDay] = await Promise.all([
      this.repo.countOrdersByPhoneSince(phone, new Date(now - 60 * 60 * 1000)),
      this.repo.countOrdersByPhoneSince(phone, new Date(now - 24 * 60 * 60 * 1000)),
    ]);

    return assessOrderRisk({ ordersLastHour, ordersLastDay });
  }
}

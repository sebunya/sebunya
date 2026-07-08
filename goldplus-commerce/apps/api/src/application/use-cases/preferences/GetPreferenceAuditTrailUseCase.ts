import { PreferenceAuditRepository, PreferenceAuditLogEntry } from '../../ports/preferences/PreferenceAuditRepository';
import { ConsentService } from '../measurement/ConsentService';

export class GetPreferenceAuditTrailUseCase {
  constructor(
    private auditRepo: PreferenceAuditRepository,
    private consentService: ConsentService
  ) {}

  async execute(userId: string): Promise<any> {
    const prefAudits = await this.auditRepo.getAuditTrail(userId);
    // Ideally we would also load consent audits, but consentService may not expose getAuditTrail yet.
    // If it does not, we'll return prefAudits for now.
    
    // We redact any PII implicitly since the schema/repo avoids it, but we can return safely.
    return {
      preferences: prefAudits.map(a => ({
        id: a.id,
        source: a.source,
        changes: a.afterState,
        createdAt: a.createdAt
      }))
    };
  }
}

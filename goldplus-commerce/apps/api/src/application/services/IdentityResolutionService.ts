import crypto from 'crypto';
import type { IIdentityRepository } from '../ports/IIdentityRepository';

export class IdentityResolutionService {
  private readonly pepper: string;

  constructor(private readonly identityRepo: IIdentityRepository) {
    this.pepper = process.env.IDENTITY_HASH_PEPPER || '';
    if (!this.pepper && process.env.NODE_ENV === 'production') {
      throw new Error('IDENTITY_HASH_PEPPER is required in production');
    }
  }

  public hashIdentifier(value: string): string {
    const normalized = value.trim().toLowerCase();
    return crypto
      .createHmac('sha256', this.pepper)
      .update(normalized)
      .digest('hex');
  }

  public async linkIdentity(params: {
    anonymousId?: string;
    browserId?: string;
    sessionId?: string;
    cartId?: string;
    leadId?: string;
    customerId?: string;
    email?: string;
    phone?: string;
    linkType: string;
    linkConfidence: number;
    sourceEventId?: string;
  }): Promise<void> {
    const emailHash = params.email ? this.hashIdentifier(params.email) : undefined;
    const phoneHash = params.phone ? this.hashIdentifier(params.phone) : undefined;

    await this.identityRepo.saveLink({
      id: crypto.randomUUID(),
      anonymousId: params.anonymousId,
      browserId: params.browserId,
      sessionId: params.sessionId,
      cartId: params.cartId,
      leadId: params.leadId,
      customerId: params.customerId,
      emailHash,
      phoneHash,
      linkType: params.linkType,
      linkConfidence: params.linkConfidence,
      sourceEventId: params.sourceEventId,
      lastSeenAt: new Date(),
    });
  }
}

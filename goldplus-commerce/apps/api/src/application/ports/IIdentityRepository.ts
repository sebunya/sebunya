export interface IdentityLinkParams {
  id: string;
  anonymousId?: string;
  browserId?: string;
  sessionId?: string;
  cartId?: string;
  leadId?: string;
  customerId?: string;
  emailHash?: string;
  phoneHash?: string;
  linkType: string;
  linkConfidence: number;
  sourceEventId?: string;
  lastSeenAt: Date;
}

export interface IIdentityRepository {
  saveLink(params: IdentityLinkParams): Promise<void>;
}

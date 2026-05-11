export interface VerifiedToken {
  subject: string;
  email: string;
  expiresAt: Date;
}

export interface ITokenSigner {
  /**
   * Returns true only when a token-signing secret is configured.
   * If false, sign() must throw — never issue an unverifiable token.
   */
  isConfigured(): boolean;
  sign(payload: { subject: string; email: string; ttlSeconds: number }): Promise<string>;
  verify(token: string): Promise<VerifiedToken | null>;
}

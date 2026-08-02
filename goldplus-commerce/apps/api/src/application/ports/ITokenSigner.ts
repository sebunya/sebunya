export interface VerifiedToken {
  subject: string;
  email: string;
  expiresAt: Date;
  /**
   * When the token was issued. Optional so existing signers/doubles stay valid;
   * used by the auth middleware to enforce an immediate hard-revocation cutoff
   * (Slice 3B) — a token issued at or before users.sessions_invalidated_after is
   * rejected without waiting for the access TTL.
   */
  issuedAt?: Date;
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

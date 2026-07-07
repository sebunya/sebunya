/** Token scope. 'session' is a full authenticated session; '2fa_pending'
 * is a short-lived token issued after a correct password but before the
 * second factor — it must never be accepted as a session. */
export type TokenScope = 'session' | '2fa_pending';

export interface VerifiedToken {
  subject: string;
  email: string;
  scope: TokenScope;
  expiresAt: Date;
}

export interface ITokenSigner {
  /**
   * Returns true only when a token-signing secret is configured.
   * If false, sign() must throw — never issue an unverifiable token.
   */
  isConfigured(): boolean;
  sign(payload: { subject: string; email: string; ttlSeconds: number; scope?: TokenScope }): Promise<string>;
  verify(token: string): Promise<VerifiedToken | null>;
}

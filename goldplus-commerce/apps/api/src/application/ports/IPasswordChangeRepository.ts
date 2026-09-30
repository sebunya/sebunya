/**
 * Writing a new password for an account the caller has already authenticated.
 *
 * One transaction: the new hash, the session cutoff (every token issued before
 * this instant stops verifying) and the voiding of any outstanding reset link.
 * A new password that leaves an old session or an unused reset link alive has
 * not locked anybody out.
 */
export interface IPasswordChangeRepository {
  setPasswordAndRevoke(userId: string, newPasswordHash: string): Promise<void>;
}

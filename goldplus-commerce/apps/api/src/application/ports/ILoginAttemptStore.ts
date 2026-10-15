export interface ILoginAttemptStore {
  getFailures(key: string): Promise<Date[]>;
  addFailure(key: string, at: Date): Promise<void>;
  clear(key: string): Promise<void>;
  /** Remembers a key for `ttlSeconds` (a place an account signed in from). Optional so older stores type. */
  remember?(key: string, ttlSeconds: number): Promise<void>;
  /** Whether a remembered key is still there. */
  isRemembered?(key: string): Promise<boolean>;
}

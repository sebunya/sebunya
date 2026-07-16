export interface ILoginAttemptStore {
  getFailures(key: string): Promise<Date[]>;
  addFailure(key: string, at: Date): Promise<void>;
  clear(key: string): Promise<void>;
}

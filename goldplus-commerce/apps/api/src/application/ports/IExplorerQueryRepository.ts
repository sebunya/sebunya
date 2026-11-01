/**
 * Executes a compiled, parameterized explorer query. The compiler guarantees the
 * SQL contains only catalogue fragments and $-placeholders; this runs it with
 * the driver's parameter binding so values are never interpreted as SQL.
 */
export interface IExplorerQueryRepository {
  run(sql: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

import { client } from '../client';
import { IExplorerQueryRepository } from '../../../application/ports/IExplorerQueryRepository';

export class DrizzleExplorerQueryRepository implements IExplorerQueryRepository {
  async run(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    // postgres-js binds positional $1.. parameters — values are data, never SQL.
    const rows = await client.unsafe(sql, params as any[]);
    return rows as unknown as Record<string, unknown>[];
  }
}

import { IExplorerQueryRepository } from '../../ports/IExplorerQueryRepository';
import { compileExplorerQuery, ExplorerRequest } from '../../../domain/analytics/QueryCompiler';

export type ExplorerResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; errors: string[] };

/**
 * The self-service explorer entry point: compile the request against the
 * catalogue, and only if it compiles cleanly, run the parameterized query.
 * A rejected request never reaches the database.
 */
export class RunExplorerQueryUseCase {
  constructor(private readonly repo: IExplorerQueryRepository) {}

  async execute(req: ExplorerRequest): Promise<ExplorerResult> {
    const compiled = compileExplorerQuery(req);
    if (!compiled.ok) return { ok: false, errors: compiled.errors };
    const rows = await this.repo.run(compiled.sql, compiled.params);
    return { ok: true, rows };
  }
}

import {
  EXPLORER_BASE_TABLE,
  EXPLORER_METRICS,
  EXPLORER_DIMENSIONS,
  EXPLORER_FILTERS,
  EXPLORER_MAX_ROWS,
} from './ExplorerCatalogue';

/**
 * Catalogue-approved query compiler (§7). Pure domain.
 *
 * Compiles a self-service explorer request into a SAFE, parameterized SQL spec.
 * Every metric/dimension/filter is looked up in the catalogue; anything not
 * found is rejected. No caller-supplied string is ever concatenated into SQL —
 * filter values become bound parameters ($1, $2, ...). The result is a spec the
 * infrastructure runs with the driver's parameter binding, so a value like
 * "'; drop table orders; --" is data, never code.
 */

export interface ExplorerRequest {
  metrics: string[];
  dimensions?: string[];
  filters?: Array<{ column: string; op: 'eq' | 'gte' | 'lte'; value: string }>;
  limit?: number;
}

export type CompileResult =
  | { ok: true; sql: string; params: unknown[] }
  | { ok: false; errors: string[] };

export function compileExplorerQuery(req: ExplorerRequest): CompileResult {
  const errors: string[] = [];

  const metrics = req.metrics ?? [];
  if (metrics.length === 0) errors.push('At least one metric is required.');
  for (const m of metrics) if (!EXPLORER_METRICS[m]) errors.push(`Unknown metric: ${m}`);

  const dimensions = req.dimensions ?? [];
  for (const d of dimensions) if (!EXPLORER_DIMENSIONS[d]) errors.push(`Unknown dimension: ${d}`);

  const params: unknown[] = [];
  const whereClauses: string[] = [];
  for (const f of req.filters ?? []) {
    const col = EXPLORER_FILTERS[f.column];
    if (!col) {
      errors.push(`Unknown filter column: ${f.column}`);
      continue;
    }
    if (!['eq', 'gte', 'lte'].includes(f.op)) {
      errors.push(`Unknown operator: ${f.op}`);
      continue;
    }
    if (col.kind === 'text') {
      if (f.op !== 'eq') errors.push(`Text filter ${f.column} supports only eq.`);
      if (col.allowedValues && !col.allowedValues.includes(f.value)) {
        errors.push(`Value not allowed for ${f.column}: ${f.value}`);
        continue;
      }
      params.push(f.value);
      whereClauses.push(`${col.column} = $${params.length}`);
    } else {
      // timestamp
      const op = f.op === 'gte' ? '>=' : f.op === 'lte' ? '<=' : '=';
      const ts = new Date(f.value);
      if (Number.isNaN(ts.getTime())) {
        errors.push(`Invalid timestamp for ${f.column}: ${f.value}`);
        continue;
      }
      params.push(ts);
      whereClauses.push(`${col.column} ${op} $${params.length}`);
    }
  }

  const limit = Math.min(Math.max(1, req.limit ?? EXPLORER_MAX_ROWS), EXPLORER_MAX_ROWS);
  if (errors.length) return { ok: false, errors };

  const selectDims = dimensions.map((d) => `${EXPLORER_DIMENSIONS[d].sql} as "${d}"`);
  const selectMetrics = metrics.map((m) => `${EXPLORER_METRICS[m].sql} as "${m}"`);
  const select = [...selectDims, ...selectMetrics].join(', ');
  const where = whereClauses.length ? ` where ${whereClauses.join(' and ')}` : '';
  const groupBy = dimensions.length ? ` group by ${dimensions.map((_, i) => i + 1).join(', ')}` : '';
  const orderBy = dimensions.length ? ` order by ${dimensions.map((_, i) => i + 1).join(', ')}` : '';

  const sql = `select ${select} from ${EXPLORER_BASE_TABLE}${where}${groupBy}${orderBy} limit ${limit}`;
  return { ok: true, sql, params };
}

/**
 * ImportSeoKeywordCsvUseCase — validated bulk upsert of parsed keyword rows
 * plus one seo_keyword_imports provenance record. Cap 5000 rows per import.
 * Rows are pre-parsed client-side; this validates, normalizes and persists.
 */

export interface KeywordImportRow {
  query: string;
  intent?: string;
  category?: string;
  volume?: number;
  volumeSource?: string;
  cpcUsd?: number;
  difficulty?: number;
  targetPath?: string;
  priority?: string;
}

export interface KeywordImportStore {
  upsertQuery(input: any): Promise<any>;
  recordKeywordImport(input: {
    provider: string; country: string; language: string;
    methodology?: string | null; rowCount: number; importedBy?: string | null;
  }): Promise<any>;
}

const MAX_ROWS = 5000;
const INTENTS = new Set(['TRANSACTIONAL', 'COMMERCIAL', 'INFORMATIONAL', 'NAVIGATIONAL', 'LOCAL', 'COMPARISON', 'UNKNOWN']);
const PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3', 'UNTRIAGED']);

export const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export type ImportResult =
  | { ok: true; imported: number; skipped: Array<{ row: number; reason: string }>; importId: string | null }
  | { ok: false; code: string; message: string };

export class ImportSeoKeywordCsvUseCase {
  constructor(private readonly store: KeywordImportStore) {}

  async execute(input: {
    provider: string;
    country?: string;
    language?: string;
    methodology?: string | null;
    importedBy?: string | null;
    rows: KeywordImportRow[];
  }): Promise<ImportResult> {
    if (!input.provider || input.provider.trim() === '') {
      return { ok: false, code: 'BAD_INPUT', message: 'provider is required (where these keyword facts came from).' };
    }
    if (!Array.isArray(input.rows) || input.rows.length === 0) {
      return { ok: false, code: 'BAD_INPUT', message: 'rows must be a non-empty array.' };
    }
    if (input.rows.length > MAX_ROWS) {
      return { ok: false, code: 'TOO_MANY_ROWS', message: `At most ${MAX_ROWS} rows per import (got ${input.rows.length}).` };
    }

    const skipped: Array<{ row: number; reason: string }> = [];
    let imported = 0;
    const seen = new Set<string>();
    for (let i = 0; i < input.rows.length; i++) {
      const r = input.rows[i];
      const query = typeof r?.query === 'string' ? r.query.trim() : '';
      if (query === '' || query.length > 300) {
        skipped.push({ row: i, reason: 'query missing or longer than 300 chars' });
        continue;
      }
      const normalized = normalizeQuery(query);
      if (seen.has(normalized)) {
        skipped.push({ row: i, reason: 'duplicate of an earlier row in this import' });
        continue;
      }
      seen.add(normalized);
      const intent = r.intent && INTENTS.has(r.intent.toUpperCase()) ? r.intent.toUpperCase() : 'UNKNOWN';
      const volume = r.volume != null && Number.isFinite(Number(r.volume)) && Number(r.volume) >= 0 ? Math.floor(Number(r.volume)) : null;
      const cpcUsd = r.cpcUsd != null && Number.isFinite(Number(r.cpcUsd)) && Number(r.cpcUsd) >= 0 ? Number(r.cpcUsd) : null;
      const difficulty = r.difficulty != null && Number.isFinite(Number(r.difficulty)) && Number(r.difficulty) >= 0 && Number(r.difficulty) <= 100 ? Number(r.difficulty) : null;
      await this.store.upsertQuery({
        query,
        normalizedQuery: normalized,
        intent,
        category: r.category?.trim() || null,
        targetPath: r.targetPath?.trim() || null,
        source: 'CSV_IMPORT',
        volume,
        volumeSource: volume != null ? (r.volumeSource?.trim() || input.provider) : null,
        cpcUsd,
        difficulty,
        priority: r.priority && PRIORITIES.has(r.priority.trim().toUpperCase()) ? r.priority.trim().toUpperCase() : 'UNTRIAGED',
        country: input.country ?? 'UG',
        language: input.language ?? 'en',
        evidenceState: 'OBSERVED',
      });
      imported += 1;
    }

    let importId: string | null = null;
    if (imported > 0) {
      const rec = await this.store.recordKeywordImport({
        provider: input.provider,
        country: input.country ?? 'UG',
        language: input.language ?? 'en',
        methodology: input.methodology ?? null,
        rowCount: imported,
        importedBy: input.importedBy ?? null,
      });
      importId = rec?.id ?? null;
    }
    return { ok: true, imported, skipped, importId };
  }
}

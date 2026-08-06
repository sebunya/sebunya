import { isDistanceBand } from '../../../domain/delivery/DeliveryModel';
import { isFulfilmentMode } from '../../../domain/delivery/DeliveryFulfilmentMode';

/**
 * Corridor CSV round trip with a DRY RUN (brief PART 6 / PART 9 #29).
 *
 * "…with a dry run showing every changed and failing row, landing as one
 * versioned change." A bulk edit that lands without a dry run is a bulk
 * mistake, and 362 areas is exactly the scale at which one bad column silently
 * repriced the whole metro set.
 *
 * The dry run WRITES NOTHING. It reports what would change and what would fail,
 * and it reports both — a run that only showed failures would let an operator
 * apply 300 unintended changes while congratulating themselves on zero errors.
 */

export interface CorridorCsvRow {
  areaSlug: string;
  corridor: string;
  distanceBand: string;
  accessMode: string;
  serviceable: boolean;
  fulfilmentMode: string | null;
}

export interface CorridorChange {
  areaSlug: string;
  field: string;
  from: string;
  to: string;
}

export interface CorridorFailure {
  line: number;
  areaSlug: string;
  problem: string;
}

export interface CorridorDryRun {
  totalRows: number;
  changes: CorridorChange[];
  failures: CorridorFailure[];
  unchanged: number;
  /** Plain language, so nobody has to count rows to understand the impact. */
  summary: string;
}

export interface ICorridorCsvRepository {
  currentCorridors(): Promise<Map<string, CorridorCsvRow>>;
}

export class DryRunCorridorCsvUseCase {
  constructor(private readonly repo: ICorridorCsvRepository) {}

  async execute(csv: string): Promise<CorridorDryRun> {
    const current = await this.repo.currentCorridors();
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) {
      return { totalRows: 0, changes: [], failures: [], unchanged: 0, summary: 'The file is empty — nothing to apply.' };
    }
    const header = lines[0].split(',').map((h) => h.trim());
    const idx = (name: string) => header.indexOf(name);
    const required = ['area_slug', 'corridor', 'distance_band', 'access_mode'];
    const missingCols = required.filter((r) => idx(r) === -1);
    if (missingCols.length > 0) {
      return {
        totalRows: 0,
        changes: [],
        failures: [{ line: 1, areaSlug: '—', problem: `Missing column(s): ${missingCols.join(', ')}` }],
        unchanged: 0,
        summary: 'The file is missing required columns, so nothing can be read from it.',
      };
    }

    const changes: CorridorChange[] = [];
    const failures: CorridorFailure[] = [];
    let unchanged = 0;

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');
      const areaSlug = (cells[idx('area_slug')] ?? '').trim();
      if (!areaSlug) {
        failures.push({ line: i + 1, areaSlug: '—', problem: 'No area slug.' });
        continue;
      }
      const existing = current.get(areaSlug);
      if (!existing) {
        // A CSV cannot CREATE an area. The gazetteer is the only source of
        // areas, and a typo'd slug must not quietly become a new row.
        failures.push({ line: i + 1, areaSlug, problem: 'Not a known area. The gazetteer is the only source of areas; this file can only change them.' });
        continue;
      }

      const band = (cells[idx('distance_band')] ?? '').trim();
      const corridor = (cells[idx('corridor')] ?? '').trim();
      const access = (cells[idx('access_mode')] ?? '').trim();
      const modeCol = idx('fulfilment_mode');
      const mode = modeCol === -1 ? null : (cells[modeCol] ?? '').trim() || null;
      const servCol = idx('serviceable');
      const serviceable = servCol === -1 ? existing.serviceable : /^(y|yes|true|1)$/i.test((cells[servCol] ?? '').trim());

      let rowFailed = false;
      if (!isDistanceBand(band)) {
        failures.push({ line: i + 1, areaSlug, problem: `"${band}" is not a distance band. Use B0 to B6.` });
        rowFailed = true;
      }
      if (!corridor) {
        failures.push({ line: i + 1, areaSlug, problem: 'Corridor cannot be empty.' });
        rowFailed = true;
      }
      if (access !== 'road' && access !== 'water') {
        failures.push({ line: i + 1, areaSlug, problem: `"${access}" is not an access mode. Use road or water.` });
        rowFailed = true;
      }
      if (mode !== null && !isFulfilmentMode(mode)) {
        failures.push({ line: i + 1, areaSlug, problem: `"${mode}" is not a fulfilment mode.` });
        rowFailed = true;
      }
      if (rowFailed) continue;

      const diffs: CorridorChange[] = [];
      if (existing.corridor !== corridor) diffs.push({ areaSlug, field: 'corridor', from: existing.corridor, to: corridor });
      if (existing.distanceBand !== band) diffs.push({ areaSlug, field: 'distance_band', from: existing.distanceBand, to: band });
      if (existing.accessMode !== access) diffs.push({ areaSlug, field: 'access_mode', from: existing.accessMode, to: access });
      if (existing.serviceable !== serviceable) {
        diffs.push({ areaSlug, field: 'serviceable', from: String(existing.serviceable), to: String(serviceable) });
      }
      if ((existing.fulfilmentMode ?? '') !== (mode ?? '')) {
        diffs.push({ areaSlug, field: 'fulfilment_mode', from: existing.fulfilmentMode ?? '(derived)', to: mode ?? '(derived)' });
      }
      if (diffs.length === 0) unchanged++;
      else changes.push(...diffs);
    }

    const areasChanged = new Set(changes.map((c) => c.areaSlug)).size;
    const summary =
      failures.length > 0 && changes.length === 0
        ? `Nothing can be applied: ${failures.length} row(s) failed and none would change anything.`
        : failures.length > 0
          ? `${areasChanged} area(s) would change across ${changes.length} field(s), and ${failures.length} row(s) would FAIL. Fix the failures first — this applies as one change or not at all.`
          : changes.length === 0
            ? `All ${unchanged} row(s) match what is already stored. Applying this would change nothing.`
            : `${areasChanged} area(s) would change across ${changes.length} field(s). ${unchanged} row(s) are unchanged.`;

    return { totalRows: lines.length - 1, changes, failures, unchanged, summary };
  }
}

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windowSentence } from '../../apps/api/src/domain/delivery/DeliveryPresentation';
import { RunNightlyCalibrationUseCase, type ICalibrationRepository } from '../../apps/api/src/application/use-cases/delivery/DeliveryCalibrationUseCases';
import type { Observation } from '../../apps/api/src/domain/delivery/DeliveryCalibration';

/**
 * The learning loop could never fit the hour factor, the detour factor or the
 * hour window: no hours in scope, null hour and straight-line distance on every
 * observation, and the window percentiles thrown away.
 */
const root = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');

const obs = (over: Partial<Observation>): Observation => ({
  areaSlug: 'kira', corridor: 'north', eatHourOfWeek: 34, predictedMinutes: 40, actualMinutes: 50,
  straightLineKm: 10, distanceTravelledKm: 13, hadPin: true, quotedFeeUgx: 8000, finalFeeUgx: 8000,
  actualRiderCostUgx: 5000, varianceReason: null, ...over,
});

function repo(observations: Observation[]) {
  const stored: { windows: unknown[] | null; proposals: Array<{ factorKind: string; scopeKey: string }> } = { windows: null, proposals: [] };
  const r: ICalibrationRepository = {
    allObservations: async () => observations,
    counts: async () => ({ observations: observations.length, deliveredOrders: observations.length, riderCostsRecorded: 0, skippedMirrors: 0 }),
    scopes: async () => ({ corridors: ['north'], areas: ['kira'], hours: [34] }),
    currentFactor: async () => null,
    replacePendingProposals: async (p) => { stored.proposals = p as never; return p.length; },
    listProposals: async () => [],
    findProposal: async () => null,
    setProposalStatus: async () => undefined,
    writeFactor: async () => undefined,
    areasWithMeasuredDistances: async () => [],
    firstObservationAlertFired: async () => true,
    markFirstObservationAlertFired: async () => undefined,
    firstObservation: async () => null,
    replaceWindowPercentiles: async (rows) => { stored.windows = rows; },
  };
  return { r, stored };
}

describe('the nightly calibration can learn hour, detour and the window', () => {
  it('proposes hour and detour factors and stores per-area windows', async () => {
    const observations = Array.from({ length: 10 }, (_, i) => obs({ actualMinutes: 40 + i * 5 }));
    const { r, stored } = repo(observations);
    const uc = new RunNightlyCalibrationUseCase(r, { create: async () => undefined } as never,
      async () => ({ calibration_min_sample_size: 5, window_min_sample_size: 5 }), () => null, null);
    await uc.execute();
    const kinds = stored.proposals.map((p) => `${p.factorKind}:${p.scopeKey}`);
    expect(kinds).toContain('hour_factor:34');
    expect(kinds).toContain('detour_factor:north');
    expect(stored.windows).toEqual([{ scopeKey: 'kira', p10: 40, p90: 80, sampleSize: 10 }]);
  });

  it('reads hours, straight-line distance and stored windows instead of hard-coded nulls', () => {
    const calibration = read('apps/api/src/infrastructure/db/repositories/DrizzleDeliveryCalibrationRepository.ts');
    expect(calibration).not.toContain('hours: [],');
    expect(calibration).not.toMatch(/eatHourOfWeek: null,/);
    expect(calibration).not.toMatch(/straightLineKm: null,/);
    const quoting = read('apps/api/src/infrastructure/db/repositories/DrizzleDeliveryQuotingRepository.ts');
    expect(quoting).toContain('from delivery_window_percentile');
    expect(quoting).not.toMatch(/observedMinutes: null,/);
    const migration = read('apps/api/src/infrastructure/db/migrations/0152_delivery_learning_inputs.sql');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "eat_hour_of_week" smallint');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "straight_line_km"');
  });
});

describe('the window sentence reads naturally below two hours', () => {
  it('uses minutes below two hours and collapses equal bounds', () => {
    expect(windowSentence({ kind: 'hours', lowMinutes: 25, highMinutes: 80, sampleSize: 12 })).toContain('within 25 to 80 minutes');
    expect(windowSentence({ kind: 'hours', lowMinutes: 50, highMinutes: 150, sampleSize: 12 })).toContain('within 50 minutes to 3 hours');
    expect(windowSentence({ kind: 'hours', lowMinutes: 120, highMinutes: 140, sampleSize: 12 })).toContain('within about 2 hours');
    expect(windowSentence({ kind: 'hours', lowMinutes: 120, highMinutes: 300, sampleSize: 44 })).toContain('2 to 5 hours');
  });
});

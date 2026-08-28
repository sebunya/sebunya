import { describe, expect, it } from 'vitest';
import {
  DraftConfigVersionUseCase,
  type ConfigValueInput,
  type ConfigVersionRow,
  type IDeliveryConfigRepository,
} from '../../apps/api/src/application/use-cases/delivery/DeliveryConfigUseCases';

/**
 * Publishing one changed value must not delete the others.
 *
 * WHAT WAS WRONG
 * DeliveryConfigReader resolves the live configuration as registry defaults
 * overlaid with the rows of the ONE published version. A draft stored only the
 * keys the operator supplied, so a version holding a single key did not mean
 * "change this key", it meant "these are all the values": publishing it dropped
 * every other live value back to its registry default.
 *
 * The preview did not reveal that. It computed { ...live, ...draft } and showed
 * the merged result, with stillMissing empty and a quotable fee, so an operator
 * changing one cutoff saw everything still in place and confirmed. Publishing
 * then wiped the speed, the rider cost, the handling minutes, the margin, the
 * minimum fee and the rider band. Under docs/delivery/CONTRACT.md those drive
 * the fee AND the delivery window for every metro quote.
 *
 * A version is now a complete snapshot, so what the preview promises is what
 * publishing produces.
 */

const LIVE: ConfigValueInput[] = [
  { key: 'effective_speed_kmh', value: '18', origin: 'human', sampleSize: null },
  { key: 'rider_cost_per_minute_ugx', value: '120', origin: 'human', sampleSize: null },
  { key: 'handling_minutes', value: '12', origin: 'human', sampleSize: null },
  { key: 'margin_multiplier', value: '1.25', origin: 'model_proposed', sampleSize: 40 },
  { key: 'minimum_fee_ugx', value: '4000', origin: 'human', sampleSize: null },
  { key: 'own_rider_max_band', value: 'C', origin: 'human', sampleSize: null },
  { key: 'same_day_cutoff_eat', value: '17:00', origin: 'human', sampleSize: null },
];

function build(live: ConfigValueInput[] | null) {
  const captured: { values: ConfigValueInput[] } = { values: [] };
  const version: ConfigVersionRow = {
    id: 'v2', status: 'draft', reason: null, createdBy: 'op', publishedBy: null,
    publishedAt: null, scheduledFor: null, revertedFrom: null, createdAt: new Date(),
  };
  const repo = {
    createDraft: async (input: { values: ConfigValueInput[] }) => {
      captured.values = input.values;
      return version;
    },
    publishedVersion: async () =>
      live ? ({ ...version, id: 'v1', status: 'published' } as ConfigVersionRow) : null,
    valueRowsForVersion: async () => live ?? [],
  } as unknown as IDeliveryConfigRepository;

  const audit = { create: async () => undefined, save: async () => undefined } as never;
  return { useCase: new DraftConfigVersionUseCase(repo, audit), captured };
}

const byKey = (rows: ConfigValueInput[]) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe('a one-key change keeps every other live value', () => {
  it('carries the other six forward', async () => {
    const { useCase, captured } = build(LIVE);

    const result = await useCase.execute({
      values: { same_day_cutoff_eat: '15:00' },
      reason: 'Earlier cutoff',
      actorId: 'op',
    });

    expect(result.ok).toBe(true);
    const written = byKey(captured.values);
    for (const key of LIVE.map((r) => r.key)) {
      expect(written[key], `${key} must survive the draft`).toBeDefined();
    }
    expect(Object.keys(written)).toHaveLength(LIVE.length);
  });

  it('applies the operator’s new value, once', async () => {
    const { useCase, captured } = build(LIVE);
    await useCase.execute({ values: { same_day_cutoff_eat: '15:00' }, reason: 'r', actorId: 'op' });

    expect(captured.values.filter((r) => r.key === 'same_day_cutoff_eat')).toHaveLength(1);
    expect(byKey(captured.values).same_day_cutoff_eat.value).toBe('15:00');
  });

  it('keeps each carried value’s own provenance', async () => {
    // Restamping somebody else's model-proposed number as this operator's
    // human decision would corrupt the audit trail.
    const { useCase, captured } = build(LIVE);
    await useCase.execute({ values: { same_day_cutoff_eat: '15:00' }, reason: 'r', actorId: 'op' });

    const written = byKey(captured.values);
    expect(written.margin_multiplier.origin).toBe('model_proposed');
    expect(written.margin_multiplier.sampleSize).toBe(40);
    expect(written.same_day_cutoff_eat.origin).toBe('human');
  });

  it('marks the operator’s own value as theirs', async () => {
    const { useCase, captured } = build(LIVE);
    await useCase.execute({
      values: { margin_multiplier: '1.4' },
      reason: 'r',
      actorId: 'op',
      origin: 'human',
      sampleSizes: { margin_multiplier: 7 },
    });
    const written = byKey(captured.values);
    expect(written.margin_multiplier.origin).toBe('human');
    expect(written.margin_multiplier.sampleSize).toBe(7);
  });
});

describe('what must not change', () => {
  it('the first ever version is exactly what was supplied', async () => {
    const { useCase, captured } = build(null);
    await useCase.execute({ values: { effective_speed_kmh: '18' }, reason: 'r', actorId: 'op' });
    expect(captured.values).toHaveLength(1);
    expect(captured.values[0].key).toBe('effective_speed_kmh');
  });

  it('a draft that supplies nothing is still refused', async () => {
    const { useCase } = build(LIVE);
    const result = await useCase.execute({ values: {}, reason: 'r', actorId: 'op' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMPTY_DRAFT');
  });

  it('an invalid supplied value is still refused before anything is written', async () => {
    const { useCase, captured } = build(LIVE);
    const result = await useCase.execute({
      values: { effective_speed_kmh: 'not a number' },
      reason: 'r',
      actorId: 'op',
    });
    expect(result.ok).toBe(false);
    expect(captured.values).toHaveLength(0);
  });
});

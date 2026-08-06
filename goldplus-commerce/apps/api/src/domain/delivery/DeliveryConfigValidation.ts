import { parseClockMinutes } from '@goldplus/shared';
import { isWritableConfigKey, validateConfigValue } from './DeliveryConfigRegistry';

/**
 * Cross-field validation for a configuration draft (brief PART 6:
 * "validation makes bad states unreachable").
 *
 * Per-field type and range live in the registry. What cannot live there is a
 * rule spanning two fields — a free-delivery threshold below the minimum fee it
 * cancels is individually valid in both fields and nonsense together.
 *
 * Pure: it takes the whole proposed value set and returns the problems. The
 * draft is validated at entry AND again at publish, because a draft can be
 * written when one value is set and published after another has changed.
 */

export interface ConfigProblem {
  key: string | null;
  message: string;
}

export function validateConfigDraft(values: Record<string, string>): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  // 1. Every key must be writable, and every value must pass its own registry
  //    declaration. A key outside the registry cannot be written at all.
  for (const [key, raw] of Object.entries(values)) {
    if (!isWritableConfigKey(key)) {
      problems.push({ key, message: `"${key}" is not a configurable value and cannot be saved.` });
      continue;
    }
    const check = validateConfigValue(key, raw);
    if (!check.ok) problems.push({ key, message: check.message });
  }
  if (problems.length > 0) return problems;

  const num = (key: string): number | null => {
    if (!(key in values)) return null;
    const n = Number(values[key]);
    return Number.isFinite(n) ? n : null;
  };

  // 2. A free-delivery threshold below the minimum fee cancels a fee that could
  //    never have been charged, which means the mechanic does nothing.
  const minFee = num('minimum_fee_ugx');
  const freeAt = num('free_delivery_threshold_ugx');
  if (minFee !== null && freeAt !== null && freeAt > 0 && freeAt < minFee) {
    problems.push({
      key: 'free_delivery_threshold_ugx',
      message: `Free delivery above ${freeAt.toLocaleString('en-UG')} UGX is below the ${minFee.toLocaleString('en-UG')} UGX minimum fee, so no order would ever pay for delivery. Raise the threshold or lower the minimum fee.`,
    });
  }

  // 3. A zero absorption threshold means every variance, however small, stops
  //    for a customer conversation. That is not a policy anyone wants; unset it
  //    instead, which refuses the variance outright and is at least honest.
  const absAbs = num('variance_absorption_threshold_ugx');
  if (absAbs !== null && absAbs === 0) {
    problems.push({
      key: 'variance_absorption_threshold_ugx',
      message: 'A zero absorption threshold sends every variance to the customer, however small. Leave it unset if you do not want to decide yet.',
    });
  }
  const absBps = num('variance_absorption_threshold_bps');
  if (absBps !== null && absBps === 0) {
    problems.push({
      key: 'variance_absorption_threshold_bps',
      message: 'A zero absorption share sends every variance to the customer, however small. Leave it unset if you do not want to decide yet.',
    });
  }

  // 4. The cutoff must be a real time of day, judged in East Africa Time.
  if ('same_day_cutoff_eat' in values) {
    const raw = values.same_day_cutoff_eat.trim();
    if (raw !== '' && parseClockMinutes(raw) === null) {
      problems.push({
        key: 'same_day_cutoff_eat',
        message: `"${raw}" is not a time of day. Use 24-hour East Africa Time, for example 15:30.`,
      });
    }
  }

  // 5. The plausibility band must not be inverted, or every speed is outside it.
  const speedMin = num('plausible_speed_min_kmh');
  const speedMax = num('plausible_speed_max_kmh');
  if (speedMin !== null && speedMax !== null && speedMin >= speedMax) {
    problems.push({
      key: 'plausible_speed_max_kmh',
      message: 'The upper speed warning must be above the lower one.',
    });
  }

  return problems;
}

import { DistanceBand, bandMidpointKm } from './DeliveryModel';

/**
 * The launch wizard (brief "FINISH", PART 2).
 *
 * Rob blocked this build four times waiting to send six numbers. That is a
 * design fault in the module, not a delay in the shop: the six values are all
 * derivable from one delivery the owner already makes. So the module asks about
 * that delivery in plain language and does the arithmetic itself.
 *
 * Everything here is pure. It takes seven answers and returns the launch values
 * with the working shown for each — no database, no clock, no configuration.
 * The publish path is elsewhere; this is the derivation and nothing else, which
 * is what makes every branch testable including the ones that divide by zero.
 *
 * NOTHING IS DEFAULTED. Every value out of here traces to an answer in. If an
 * answer is missing or unusable, this refuses and names which answer caused it.
 */

/* ── The seven answers ───────────────────────────────────────────────────── */

export interface WizardAnswers {
  /** 1. A place they deliver to often. The area supplies the band. */
  areaSlug: string;
  areaLabel: string;
  band: DistanceBand;
  /** 2. There and back, including finding the address. */
  roundTripMinutes: number;
  /** 3. What the rider is paid for that trip. */
  riderPayUgx: number;
  /** 4. Order confirmed to rider leaving the shop. */
  handlingMinutes: number;
  /** 5. What they want to make on top of what the delivery costs. */
  marginPercent: number;
  /** 6. Below which a delivery is not worth doing. */
  minimumFeeUgx: number;
  /** 7. Free delivery above this order value, or null for "not yet". */
  freeDeliveryThresholdUgx: number | null;
}

export type WizardRefusal =
  | 'AREA_NOT_CHOSEN'
  | 'TRIP_TIME_NOT_POSITIVE'
  | 'RIDER_PAY_INVALID'
  | 'HANDLING_INVALID'
  | 'MARGIN_INVALID'
  | 'MINIMUM_FEE_INVALID'
  | 'FREE_THRESHOLD_INVALID';

/**
 * One derived value, with the working an operator can check.
 *
 * `working` is written in their own terms — "your Ntinda trip is 14 km there
 * and back; 14 km in 45 minutes is 18.7 km/h" — because a derived number
 * presented without its arithmetic is indistinguishable from an invented one.
 */
export interface DerivedValue {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** Which of the seven answers this came from. */
  fromAnswer: string;
  working: string;
}

export interface PlausibilityWarning {
  /** Which answer most likely caused it. */
  answer: string;
  message: string;
}

export type WizardDerivation =
  | {
      ok: true;
      /** Exactly the registry keys the publish path will write. */
      values: Record<string, number>;
      derived: DerivedValue[];
      warnings: PlausibilityWarning[];
      roundTripKm: number;
    }
  | { ok: false; refusal: WizardRefusal; message: string };

/**
 * Sanity bounds on the derived speed.
 *
 * These are the only two numbers in this module that were chosen rather than
 * answered or fitted, and they are declared here as constants so the registry
 * entry that carries them has one source. They are the same class as
 * `implausible_rider_cost_ugx` — a typo guard, not a pricing parameter — and
 * the design keeps them harmless in two ways: they can never alter a fee, and
 * they only ever WARN. The operator knows their city better than the check
 * does, so the check never refuses.
 */
export const DEFAULT_PLAUSIBLE_SPEED_MIN_KMH = 8;
export const DEFAULT_PLAUSIBLE_SPEED_MAX_KMH = 45;

const ugx = (n: number): string => Math.round(n).toLocaleString('en-UG');
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Derive the launch values from the seven answers.
 *
 * Every division is guarded and every guard names the answer responsible, so a
 * zero in answer 2 produces "how long the trip takes must be more than zero
 * minutes" rather than Infinity quietly reaching a fee.
 */
export function deriveLaunchValues(
  answers: WizardAnswers,
  bounds: { minKmh: number; maxKmh: number },
): WizardDerivation {
  if (!answers.areaSlug || !answers.band) {
    return {
      ok: false,
      refusal: 'AREA_NOT_CHOSEN',
      message: 'Choose a place you deliver to often — its distance band is what turns your trip time into a speed.',
    };
  }
  if (!Number.isFinite(answers.roundTripMinutes) || answers.roundTripMinutes <= 0) {
    return {
      ok: false,
      refusal: 'TRIP_TIME_NOT_POSITIVE',
      message: 'How long the trip takes must be more than zero minutes.',
    };
  }
  if (!Number.isFinite(answers.riderPayUgx) || answers.riderPayUgx <= 0) {
    return {
      ok: false,
      refusal: 'RIDER_PAY_INVALID',
      message: 'What you pay the rider for that trip must be more than zero shillings.',
    };
  }
  if (!Number.isFinite(answers.handlingMinutes) || answers.handlingMinutes < 0) {
    return {
      ok: false,
      refusal: 'HANDLING_INVALID',
      message: 'The time from order confirmed to the rider leaving cannot be negative.',
    };
  }
  if (!Number.isFinite(answers.marginPercent) || answers.marginPercent < 0) {
    return { ok: false, refusal: 'MARGIN_INVALID', message: 'What you want to make on top cannot be negative.' };
  }
  if (!Number.isFinite(answers.minimumFeeUgx) || answers.minimumFeeUgx < 0) {
    return { ok: false, refusal: 'MINIMUM_FEE_INVALID', message: 'The lowest fee you will charge cannot be negative.' };
  }
  if (
    answers.freeDeliveryThresholdUgx !== null &&
    (!Number.isFinite(answers.freeDeliveryThresholdUgx) || answers.freeDeliveryThresholdUgx < 0)
  ) {
    return {
      ok: false,
      refusal: 'FREE_THRESHOLD_INVALID',
      message: 'The order value that earns free delivery cannot be negative. Choose "not yet" to leave it off.',
    };
  }

  const oneWayKm = bandMidpointKm(answers.band);
  const roundTripKm = oneWayKm * 2;
  const hours = answers.roundTripMinutes / 60;

  const speed = roundTripKm / hours;
  const costPerMinute = answers.riderPayUgx / answers.roundTripMinutes;
  const margin = 1 + answers.marginPercent / 100;

  const values: Record<string, number> = {
    effective_speed_kmh: speed,
    rider_cost_per_minute_ugx: costPerMinute,
    handling_minutes: answers.handlingMinutes,
    margin_multiplier: margin,
    minimum_fee_ugx: answers.minimumFeeUgx,
  };
  if (answers.freeDeliveryThresholdUgx !== null) {
    values.free_delivery_threshold_ugx = answers.freeDeliveryThresholdUgx;
  }

  const derived: DerivedValue[] = [
    {
      key: 'effective_speed_kmh',
      label: 'How fast a rider actually covers ground',
      value: speed,
      unit: 'km/h',
      fromAnswer: 'Your trip to ' + answers.areaLabel + ', and how long it takes',
      working: `${answers.areaLabel} is in band ${answers.band}, about ${round1(oneWayKm)} km away, so ${round1(roundTripKm)} km there and back. ${round1(roundTripKm)} km in ${round1(answers.roundTripMinutes)} minutes works out to ${round1(speed)} km/h.`,
    },
    {
      key: 'rider_cost_per_minute_ugx',
      label: 'What we pay a rider per minute',
      value: costPerMinute,
      unit: 'UGX per minute',
      fromAnswer: 'What you pay the rider for that trip',
      working: `UGX ${ugx(answers.riderPayUgx)} for a ${round1(answers.roundTripMinutes)} minute trip is UGX ${round1(costPerMinute)} a minute.`,
    },
    {
      key: 'handling_minutes',
      label: 'Minutes from order confirmed to rider leaving',
      value: answers.handlingMinutes,
      unit: 'minutes',
      fromAnswer: 'How long before the rider leaves the shop',
      working: `Used as you gave it: ${round1(answers.handlingMinutes)} minutes of picking, packing and handover, added to every delivery.`,
    },
    {
      key: 'margin_multiplier',
      label: 'What goes on top of cost',
      value: margin,
      unit: '×',
      fromAnswer: 'What you want to make on top',
      working: `${round1(answers.marginPercent)}% on top means every delivery is charged at ${round1(margin)} times what it costs you.`,
    },
    {
      key: 'minimum_fee_ugx',
      label: 'The lowest delivery fee we will charge',
      value: answers.minimumFeeUgx,
      unit: 'UGX',
      fromAnswer: 'Below what fee a delivery is not worth doing',
      working: `Used as you gave it: no delivery is ever quoted below UGX ${ugx(answers.minimumFeeUgx)}, however short the trip.`,
    },
  ];

  if (answers.freeDeliveryThresholdUgx !== null) {
    derived.push({
      key: 'free_delivery_threshold_ugx',
      label: 'Order value that earns free delivery',
      value: answers.freeDeliveryThresholdUgx,
      unit: 'UGX',
      fromAnswer: 'Free delivery above a certain order value',
      working: `Orders worth UGX ${ugx(answers.freeDeliveryThresholdUgx)} or more pay no delivery fee. Measured on the goods after any promotion and before loyalty points, because points are payment rather than a discount.`,
    });
  }

  return { ok: true, values, derived, warnings: plausibility(answers, speed, roundTripKm, bounds), roundTripKm };
}

/**
 * Warn, never refuse.
 *
 * Two checks, and the first invents nothing at all: an operator who answered
 * "40 minutes" meaning forty each way is the single most likely error in this
 * form, and both readings of their own answer can simply be shown side by side.
 * The second is the range check, which needs bounds and is therefore the weaker
 * of the two.
 */
export function plausibility(
  answers: WizardAnswers,
  speed: number,
  roundTripKm: number,
  bounds: { minKmh: number; maxKmh: number },
): PlausibilityWarning[] {
  const warnings: PlausibilityWarning[] = [];

  if (speed < bounds.minKmh) {
    warnings.push({
      answer: 'How long that trip takes',
      message: `${round1(speed)} km/h is slower than we would expect for ${round1(roundTripKm)} km of Kampala road. If you meant ${round1(answers.roundTripMinutes)} minutes EACH WAY rather than there and back, the answer should be ${round1(answers.roundTripMinutes * 2)}. Check the preview below before you publish.`,
    });
  } else if (speed > bounds.maxKmh) {
    warnings.push({
      answer: 'How long that trip takes',
      message: `${round1(speed)} km/h is faster than we would expect for ${round1(roundTripKm)} km of Kampala road. Either the trip takes longer than ${round1(answers.roundTripMinutes)} minutes, or the place you picked is further out than the one you meant. Check the preview below before you publish.`,
    });
  } else {
    // Inside the range, so no judgement is made — but the ambiguity in the
    // question is real and costs nothing to name.
    warnings.push({
      answer: 'How long that trip takes',
      message: `Read as ${round1(answers.roundTripMinutes)} minutes THERE AND BACK, giving ${round1(speed)} km/h. Had you meant that each way, it would be ${round1(speed / 2)} km/h and every fee would be about double. The preview below is where you check it.`,
    });
  }

  if (answers.marginPercent === 0) {
    warnings.push({
      answer: 'What you want to make on top',
      message: 'Zero percent charges the customer exactly what the delivery costs you. That is allowed, and it means delivery makes you nothing.',
    });
  }

  return warnings;
}

import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_METRIC_CATALOGUE,
  ANALYTICS_SOURCE_KEYS,
  assessChange,
  buildMetricValue,
  getMetricDefinition,
  rateState,
  requireMetricDefinition,
} from '@goldplus/shared';

describe('metric catalogue completeness', () => {
  it('has unique keys', () => {
    const keys = ANALYTICS_METRIC_CATALOGUE.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every metric a definition, formula, polarity, source and drilldown', () => {
    for (const definition of ANALYTICS_METRIC_CATALOGUE) {
      expect(definition.definition.length, definition.key).toBeGreaterThan(10);
      expect(definition.formula.length, definition.key).toBeGreaterThan(3);
      expect(['INCREASE_IS_GOOD', 'INCREASE_IS_BAD', 'DIRECTIONLESS']).toContain(definition.polarity);
      expect(ANALYTICS_SOURCE_KEYS).toContain(definition.source);
      expect(definition.drilldownRoute.startsWith('/admin'), definition.key).toBe(true);
      expect(definition.owner.length, definition.key).toBeGreaterThan(0);
    }
  });

  it('declares an exact denominator and minimum sample for every rate', () => {
    for (const definition of ANALYTICS_METRIC_CATALOGUE.filter((d) => d.unit === 'rate')) {
      expect(definition.denominator, definition.key).not.toBe('NONE');
      expect(definition.minimumSample, definition.key).toBeGreaterThan(0);
    }
  });

  it('never labels operational paid value as revenue', () => {
    const paidValue = requireMetricDefinition('paid_order_value');
    expect(paidValue.definition.toLowerCase()).toContain('not recognised accounting revenue');
    for (const definition of ANALYTICS_METRIC_CATALOGUE) {
      expect(definition.label.toLowerCase()).not.toContain('revenue');
    }
  });

  it('marks failure-style metrics as increase-is-bad', () => {
    expect(requireMetricDefinition('payment_failure_rate').polarity).toBe('INCREASE_IS_BAD');
    expect(requireMetricDefinition('search_zero_result_rate').polarity).toBe('INCREASE_IS_BAD');
    expect(requireMetricDefinition('order_cancellation_rate').polarity).toBe('INCREASE_IS_BAD');
    expect(requireMetricDefinition('low_stock_products').polarity).toBe('INCREASE_IS_BAD');
    expect(requireMetricDefinition('discount_value').polarity).toBe('DIRECTIONLESS');
  });

  it('returns null for unknown metrics and throws only on require', () => {
    expect(getMetricDefinition('made_up_metric')).toBeNull();
    expect(() => requireMetricDefinition('made_up_metric')).toThrow('UNKNOWN_METRIC');
  });
});

describe('assessChange polarity semantics', () => {
  it('treats an increase in a bad metric as DECLINED', () => {
    expect(assessChange('INCREASE_IS_BAD', 0.05)).toBe('DECLINED');
    expect(assessChange('INCREASE_IS_BAD', -0.05)).toBe('IMPROVED');
  });

  it('treats an increase in a good metric as IMPROVED', () => {
    expect(assessChange('INCREASE_IS_GOOD', 3)).toBe('IMPROVED');
    expect(assessChange('INCREASE_IS_GOOD', -3)).toBe('DECLINED');
  });

  it('never assigns a verdict to directionless or unknown changes', () => {
    expect(assessChange('DIRECTIONLESS', 100)).toBe('MIXED_CONTEXT');
    expect(assessChange('INCREASE_IS_GOOD', null)).toBe('UNKNOWN');
    expect(assessChange('INCREASE_IS_BAD', 0)).toBe('FLAT');
  });
});

describe('metric state semantics', () => {
  it('separates a valid zero from missing data', () => {
    expect(rateState({ sourceAvailable: true, denominator: 0, minimumSample: 5 })).toBe('NO_DATA');
    expect(rateState({ sourceAvailable: true, denominator: 3, minimumSample: 5 })).toBe('INSUFFICIENT_EVIDENCE');
    expect(rateState({ sourceAvailable: true, denominator: 5, minimumSample: 5 })).toBe('VALUE');
    expect(rateState({ sourceAvailable: false, denominator: 100, minimumSample: 5 })).toBe('SOURCE_UNAVAILABLE');
  });

  it('strips the numeric value from non-value-bearing states', () => {
    const metric = buildMetricValue({
      key: 'payment_failure_rate',
      state: 'SOURCE_UNAVAILABLE',
      value: 0.4,
      previousState: 'NO_DATA',
      previousValue: 0.2,
    });
    expect(metric.value).toBeNull();
    expect(metric.previousValue).toBeNull();
    expect(metric.absoluteChange).toBeNull();
    expect(metric.assessment).toBe('UNKNOWN');
  });

  it('keeps a genuine zero as a value', () => {
    const metric = buildMetricValue({
      key: 'orders',
      state: 'VALUE',
      value: 0,
      previousState: 'VALUE',
      previousValue: 4,
    });
    expect(metric.value).toBe(0);
    expect(metric.absoluteChange).toBe(-4);
    expect(metric.assessment).toBe('DECLINED');
  });
});

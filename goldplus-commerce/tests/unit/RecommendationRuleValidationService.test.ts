import { describe, it, expect } from 'vitest';
import { RecommendationRuleValidationService } from '../../apps/api/src/application/recommendations/RecommendationRuleValidationService';

const validator = new RecommendationRuleValidationService();

function makeValidRule(overrides = {}) {
  return {
    name: 'Valid Boost Rule',
    placement: 'home_trending', // directly assign valid placement
    type: 'BOOST' as const,
    status: 'ACTIVE' as const,
    priority: 100,
    targetType: 'GLOBAL' as const,
    conditions: {},
    action: { type: 'BOOST', boostScore: 20 },
    ...overrides,
  };
}

describe('RecommendationRuleValidationService', () => {
  it('accepts a valid BOOST rule', () => {
    const errors = validator.validate(makeValidRule());
    expect(errors).toHaveLength(0);
  });

  it('rejects missing name', () => {
    const errors = validator.validate(makeValidRule({ name: '' }));
    expect(errors).toContain('Rule name is required.');
  });

  it('rejects invalid placement', () => {
    const errors = validator.validate(makeValidRule({ placement: 'invalid_placement' } as any));
    expect(errors).toContain('Invalid placement: invalid_placement');
  });

  it('rejects invalid type', () => {
    const errors = validator.validate(makeValidRule({ type: 'UNKNOWN' } as any));
    expect(errors).toContain('Rule type is required.'); // validation will treat as missing
  });

  it('rejects invalid status', () => {
    const errors = validator.validate(makeValidRule({ status: 'WRONG' } as any));
    expect(errors).toContain('Rule status is required.');
  });

  it('rejects invalid targetType', () => {
    const errors = validator.validate(makeValidRule({ targetType: 'INVALID' } as any));
    expect(errors).toContain('Target type is required.');
  });

  it('rejects campaign without dates', () => {
    const errors = validator.validate(makeValidRule({ type: 'CAMPAIGN', action: { type: 'CAMPAIGN' } } as any));
    expect(errors).toContain('CAMPAIGN rules must have explicit Start and End dates.');
  });

  it('rejects pin without product target', () => {
    const errors = validator.validate(
      makeValidRule({
        type: 'PIN',
        action: { type: 'PIN', pinPosition: 5 },
        targetType: 'CATEGORY',
      })
    );
    expect(errors).toContain('PIN rules must explicitly target a specific product (targetType=PRODUCT).');
  });

  it('rejects startsAt after endsAt', () => {
    const errors = validator.validate(
      makeValidRule({
        startsAt: new Date('2024-01-02'),
        endsAt: new Date('2024-01-01'),
        action: { type: 'BOOST', boostScore: 10 },
      })
    );
    expect(errors).toContain('Start date must occur before End date.');
  });

  it('rejects boostScore outside range', () => {
    const errors = validator.validate(
      makeValidRule({
        action: { type: 'BOOST', boostScore: 200 },
      })
    );
    expect(errors).toContain('boostScore must be between -100 and +100.');
  });

  it('rejects pinPosition outside range', () => {
    const errors = validator.validate(
      makeValidRule({
        type: 'PIN',
        targetType: 'PRODUCT',
        targetValue: 'prod-123',
        action: { type: 'PIN', pinPosition: 30 },
      })
    );
    expect(errors).toContain('PIN rules must specify a pinPosition between 1 and 20.');
  });

  it('rejects unknown action fields', () => {
    const errors = validator.validate(
      makeValidRule({
        action: { type: 'BOOST', boostScore: 10, unknownField: 'oops' } as any,
      })
    );
    expect(errors).toContain('Unknown action field: unknownField');
  });

  it('rejects unknown condition fields', () => {
    const errors = validator.validate(
      makeValidRule({
        conditions: { unknownCond: true } as any,
      })
    );
    expect(errors).toContain('Unknown condition field: unknownCond');
  });
});

import { describe, expect, it } from 'vitest';
import {
  AutomationJsonbContractError,
  decodeAutomationJsonb,
  decodeAutomationVersionConfig,
  encodeAutomationJsonb,
} from '../../apps/api/src/infrastructure/db/AutomationJsonbCodec';
import { AutomationVersionConfig } from '../../apps/api/src/domain/automation/Automation';

const config = (over: Partial<AutomationVersionConfig> = {}): AutomationVersionConfig => ({
  triggerFamily: 'DOMAIN_EVENT',
  triggerRef: 'OrderPlaced',
  audiencePolicyMode: 'REEVALUATE_AT_EXECUTION',
  conditions: [{ conditionId: 'lifecycle', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' }],
  actions: [{ actionIndex: 0, family: 'INTERNAL_NOTIFICATION', channel: null, config: { queue: 'ops' } }],
  schedule: null,
  frequency: null,
  ...over,
});

describe('Automation JSONB codec', () => {
  it('reads a native object and rehydrates schedule dates', () => {
    const input = config({
      triggerFamily: 'SCHEDULED',
      schedule: {
        timezone: 'Africa/Kampala',
        intervalMinutes: 60,
        effectiveStart: new Date('2026-07-19T00:00:00.000Z'),
        effectiveEnd: null,
        misfirePolicy: 'SKIP',
      },
    });
    const decoded = decodeAutomationVersionConfig(JSON.parse(JSON.stringify(input)));
    expect(decoded.triggerFamily).toBe('SCHEDULED');
    expect(decoded.schedule?.effectiveStart).toEqual(new Date('2026-07-19T00:00:00.000Z'));
  });

  it('reads exactly one historical double-encoded layer with semantic equality', () => {
    const input = config();
    expect(decodeAutomationVersionConfig(JSON.stringify(input))).toEqual(input);
  });

  it('reads native object and array containers', () => {
    expect(decodeAutomationJsonb({ result: true })).toEqual({ result: true });
    expect(decodeAutomationJsonb([{ result: true }])).toEqual([{ result: true }]);
  });

  it('rejects malformed stored JSON and does not recursively parse two layers', () => {
    expect(() => decodeAutomationVersionConfig('{"triggerFamily":')).toThrowError(
      expect.objectContaining<Partial<AutomationJsonbContractError>>({ code: 'MALFORMED_STORED_JSONB' })
    );
    expect(() => decodeAutomationVersionConfig(JSON.stringify(JSON.stringify(config())))).toThrowError(
      expect.objectContaining<Partial<AutomationJsonbContractError>>({ code: 'JSONB_CONTAINER_REQUIRED' })
    );
  });

  it('rejects structurally invalid stored configuration', () => {
    expect(() => decodeAutomationVersionConfig({ ...config(), actions: 'not-an-array' })).toThrowError(
      expect.objectContaining<Partial<AutomationJsonbContractError>>({ code: 'INVALID_AUTOMATION_CONFIG' })
    );
  });

  it('accepts serializable object/array writes and rejects invalid containers', () => {
    expect(encodeAutomationJsonb({ result: true })).toBeDefined();
    expect(encodeAutomationJsonb([{ result: true }])).toBeDefined();
    expect(() => encodeAutomationJsonb('already encoded')).toThrowError(
      expect.objectContaining<Partial<AutomationJsonbContractError>>({ code: 'JSONB_CONTAINER_REQUIRED' })
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => encodeAutomationJsonb(circular)).toThrowError(
      expect.objectContaining<Partial<AutomationJsonbContractError>>({ code: 'UNSERIALIZABLE_JSONB' })
    );
  });
});

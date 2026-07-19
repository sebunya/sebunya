import { SQL, sql } from 'drizzle-orm';
import {
  AutomationVersionConfig,
  TRIGGER_FAMILIES,
  isSupportedAction,
  validateVersionConfig,
} from '../../domain/automation/Automation';
import { client } from './client';

export type AutomationJsonbContainer = Record<string, unknown> | unknown[];

export class AutomationJsonbContractError extends Error {
  constructor(
    public readonly code:
      | 'UNSERIALIZABLE_JSONB'
      | 'MALFORMED_STORED_JSONB'
      | 'JSONB_CONTAINER_REQUIRED'
      | 'INVALID_AUTOMATION_CONFIG',
    message: string
  ) {
    super(message);
    this.name = 'AutomationJsonbContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertJsonbContainer(value: unknown): asserts value is AutomationJsonbContainer {
  if (!isRecord(value) && !Array.isArray(value)) {
    throw new AutomationJsonbContractError('JSONB_CONTAINER_REQUIRED', 'Automation JSONB must be an object or array.');
  }
}

/**
 * postgres-js must receive its explicit JSON parameter wrapper here. The
 * Drizzle 0.29 JSONB mapper serializes first; postgres-js then serializes that
 * string again, producing a JSONB string instead of an object/array.
 */
export function encodeAutomationJsonb(value: unknown): SQL {
  assertJsonbContainer(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined JSON');
  } catch {
    throw new AutomationJsonbContractError('UNSERIALIZABLE_JSONB', 'Automation JSONB value is not serializable.');
  }
  return sql`${client.json(value as any)}::jsonb`;
}

/** Decode at most one historical double-encoded layer; never parse recursively. */
export function decodeAutomationJsonb(value: unknown): AutomationJsonbContainer {
  let decoded = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      throw new AutomationJsonbContractError('MALFORMED_STORED_JSONB', 'Stored Automation JSONB is malformed.');
    }
  }
  assertJsonbContainer(decoded);
  return decoded;
}

function nullableDate(value: unknown, field: string): Date | null {
  if (value === null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', `${field} must be an ISO date or null.`);
}

/** Validate and rehydrate one persisted Automation version configuration. */
export function decodeAutomationVersionConfig(value: unknown): AutomationVersionConfig {
  const decoded = decodeAutomationJsonb(value);
  if (!isRecord(decoded)) {
    throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation configuration must be an object.');
  }

  const triggerFamily = decoded.triggerFamily;
  if (typeof triggerFamily !== 'string' || !(TRIGGER_FAMILIES as readonly string[]).includes(triggerFamily)) {
    throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation triggerFamily is invalid.');
  }
  if (decoded.triggerRef !== null && typeof decoded.triggerRef !== 'string') {
    throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation triggerRef must be a string or null.');
  }
  if (decoded.audiencePolicyMode !== 'SNAPSHOT_AT_PLAN' && decoded.audiencePolicyMode !== 'REEVALUATE_AT_EXECUTION') {
    throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation audiencePolicyMode is invalid.');
  }
  if (!Array.isArray(decoded.conditions) || !decoded.conditions.every((condition) =>
    isRecord(condition)
    && typeof condition.conditionId === 'string'
    && typeof condition.category === 'string'
    && typeof condition.operator === 'string'
  )) {
    throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation conditions are invalid.');
  }
  if (!Array.isArray(decoded.actions) || !decoded.actions.every((action) =>
    isRecord(action)
    && Number.isInteger(action.actionIndex)
    && typeof action.family === 'string'
    && isSupportedAction(action.family)
    && (action.channel === null || typeof action.channel === 'string')
    && isRecord(action.config)
  )) {
    throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation actions are invalid.');
  }

  let schedule: AutomationVersionConfig['schedule'] = null;
  if (decoded.schedule !== null) {
    if (!isRecord(decoded.schedule)
      || typeof decoded.schedule.timezone !== 'string'
      || !Number.isInteger(decoded.schedule.intervalMinutes)
      || (decoded.schedule.misfirePolicy !== 'SKIP' && decoded.schedule.misfirePolicy !== 'RUN_ONCE')) {
      throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation schedule is invalid.');
    }
    schedule = {
      timezone: decoded.schedule.timezone,
      intervalMinutes: decoded.schedule.intervalMinutes as number,
      effectiveStart: nullableDate(decoded.schedule.effectiveStart, 'schedule.effectiveStart'),
      effectiveEnd: nullableDate(decoded.schedule.effectiveEnd, 'schedule.effectiveEnd'),
      misfirePolicy: decoded.schedule.misfirePolicy,
    };
  }

  let frequency: AutomationVersionConfig['frequency'] = null;
  if (decoded.frequency !== null) {
    if (!isRecord(decoded.frequency)
      || (decoded.frequency.perCustomerPerWindow !== null && !Number.isInteger(decoded.frequency.perCustomerPerWindow))
      || (decoded.frequency.windowDays !== null && !Number.isInteger(decoded.frequency.windowDays))
      || typeof decoded.frequency.global !== 'boolean'
      || typeof decoded.frequency.countsAttempts !== 'boolean') {
      throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', 'Automation frequency policy is invalid.');
    }
    frequency = {
      perCustomerPerWindow: decoded.frequency.perCustomerPerWindow as number | null,
      windowDays: decoded.frequency.windowDays as number | null,
      global: decoded.frequency.global,
      countsAttempts: decoded.frequency.countsAttempts,
    };
  }

  const config: AutomationVersionConfig = {
    triggerFamily: triggerFamily as AutomationVersionConfig['triggerFamily'],
    triggerRef: decoded.triggerRef,
    audiencePolicyMode: decoded.audiencePolicyMode,
    conditions: decoded.conditions as AutomationVersionConfig['conditions'],
    actions: decoded.actions as AutomationVersionConfig['actions'],
    schedule,
    frequency,
  };
  const validation = validateVersionConfig(config);
  if (!validation.ok) {
    throw new AutomationJsonbContractError('INVALID_AUTOMATION_CONFIG', `Automation configuration failed ${validation.code}.`);
  }
  return config;
}

/** SQL read expression compatible with native JSONB and exactly one legacy string layer. */
export function automationJsonbReadExpression(column: SQL): SQL {
  return sql`(CASE WHEN jsonb_typeof(${column}) = 'string' THEN (${column} #>> '{}')::jsonb ELSE ${column} END)`;
}

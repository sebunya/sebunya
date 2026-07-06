/**
 * First-party activity events.
 *
 * These are the server-side tracked interactions that power the
 * first-party data strategy: no third-party cookies, no external
 * trackers. Every event is attributed to a first-party visitor id
 * (an opaque UUID issued by our own HTTP layer) and optionally to a
 * logged-in user.
 */

export const ACTIVITY_EVENT_TYPES = [
  'PAGE_VIEW',
  'PRODUCT_VIEW',
  'SEARCH',
  'ADD_TO_CART',
  'REMOVE_FROM_CART',
  'CHECKOUT_STARTED',
  'CHECKOUT_COMPLETED',
  'ORDER_TRACKED',
  'EXPERIMENT_EXPOSURE',
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(ACTIVITY_EVENT_TYPES);

const MAX_PATH_LENGTH = 500;
const MAX_ENTITY_LENGTH = 50;
const MAX_ENTITY_ID_LENGTH = 100;
const MAX_PROPERTY_KEYS = 20;
const MAX_PROPERTY_VALUE_LENGTH = 500;

export interface ActivityEventInput {
  visitorId: string;
  sessionId?: string | null;
  userId?: string | null;
  eventType: string;
  path?: string | null;
  entity?: string | null;
  entityId?: string | null;
  properties?: Record<string, unknown> | null;
}

export interface ValidatedActivityEvent {
  visitorId: string;
  sessionId: string | null;
  userId: string | null;
  eventType: ActivityEventType;
  path: string | null;
  entity: string | null;
  entityId: string | null;
  properties: Record<string, string | number | boolean>;
}

export type ActivityEventValidation =
  | { ok: true; event: ValidatedActivityEvent }
  | { ok: false; code: 'MISSING_VISITOR' | 'UNKNOWN_EVENT_TYPE' | 'BAD_PROPERTIES'; message: string };

/**
 * Validates and normalises a raw tracking payload into a well-formed
 * activity event. Rejects unknown event types outright so the event
 * store stays a closed, documented vocabulary (data-dictionary rule).
 */
export function validateActivityEvent(input: ActivityEventInput): ActivityEventValidation {
  const visitorId = (input.visitorId || '').trim();
  if (!visitorId) {
    return { ok: false, code: 'MISSING_VISITOR', message: 'visitorId is required for first-party attribution.' };
  }

  const eventType = (input.eventType || '').trim().toUpperCase();
  if (!EVENT_TYPE_SET.has(eventType)) {
    return {
      ok: false,
      code: 'UNKNOWN_EVENT_TYPE',
      message: `Unknown event type "${input.eventType}". Allowed: ${ACTIVITY_EVENT_TYPES.join(', ')}.`,
    };
  }

  const properties: Record<string, string | number | boolean> = {};
  if (input.properties) {
    const keys = Object.keys(input.properties);
    if (keys.length > MAX_PROPERTY_KEYS) {
      return { ok: false, code: 'BAD_PROPERTIES', message: `At most ${MAX_PROPERTY_KEYS} properties are allowed per event.` };
    }
    for (const key of keys) {
      const value = input.properties[key];
      if (value === null || value === undefined) continue;
      if (typeof value === 'string') {
        properties[key] = value.slice(0, MAX_PROPERTY_VALUE_LENGTH);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        properties[key] = value;
      } else if (typeof value === 'boolean') {
        properties[key] = value;
      } else {
        return { ok: false, code: 'BAD_PROPERTIES', message: `Property "${key}" must be a string, number, or boolean.` };
      }
    }
  }

  return {
    ok: true,
    event: {
      visitorId: visitorId.slice(0, 100),
      sessionId: input.sessionId ? String(input.sessionId).trim().slice(0, 100) || null : null,
      userId: input.userId ? String(input.userId).trim() || null : null,
      eventType: eventType as ActivityEventType,
      path: input.path ? String(input.path).trim().slice(0, MAX_PATH_LENGTH) || null : null,
      entity: input.entity ? String(input.entity).trim().slice(0, MAX_ENTITY_LENGTH) || null : null,
      entityId: input.entityId ? String(input.entityId).trim().slice(0, MAX_ENTITY_ID_LENGTH) || null : null,
      properties,
    },
  };
}

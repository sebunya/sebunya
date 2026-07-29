import { apiBase } from './api';

/**
 * Server-side client for the canonical readiness endpoint.
 *
 * The admin surface previously rendered a static status table, so a card could
 * claim "Live" with no relationship to whether anything worked. Runtime status now
 * comes only from here. When this call fails the caller must render a truthful
 * failure state — never a static green card.
 */

export type ModuleServiceStatus = 'LIVE' | 'DEGRADED' | 'BLOCKED' | 'UNAVAILABLE';
export type ModuleAccessStatus = 'OPEN' | 'AUTHENTICATED' | 'PROTECTED' | 'APPROVAL_REQUIRED';
export type ModuleActivationStatus =
  | 'ACTIVE'
  | 'DORMANT'
  | 'READ_ONLY'
  | 'DRY_RUN'
  | 'NOT_CONFIGURED';
export type ModuleCategory = 'TRUST_CENTRE' | 'COMMERCE_OS' | 'READINESS';

export interface ModuleAction {
  key: string;
  label: string;
  target: string;
  requiredPermission?: string;
  kind: 'READ' | 'WRITE' | 'APPROVE' | 'DIAGNOSTIC';
}

export interface ModuleReadiness {
  moduleKey: string;
  displayName: string;
  category: ModuleCategory;
  serviceStatus: ModuleServiceStatus;
  accessStatus: ModuleAccessStatus;
  activationStatus: ModuleActivationStatus;
  lastCheckedAt: string;
  latencyMs: number;
  contractVersion: string;
  requiredPermissions: string[];
  dependencies: { name: string; status: 'UP' | 'DOWN' | 'UNKNOWN'; detail?: string }[];
  availableActions: ModuleAction[];
  degradedReasons: string[];
  deepLink: string;
  traceId: string;
}

export interface ReadinessSummary {
  contractVersion: string;
  generatedAt: string;
  totalModules: number;
  liveModules: number;
  degradedModules: number;
  blockedModules: number;
  unavailableModules: number;
  modules: ModuleReadiness[];
  traceId: string;
}

export type ReadinessFailureReason =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ROUTE_MISSING'
  | 'SERVICE_UNAVAILABLE'
  | 'MALFORMED_RESPONSE'
  | 'NETWORK';

export type ReadinessResult =
  | { ok: true; summary: ReadinessSummary; traceId: string }
  | { ok: false; reason: ReadinessFailureReason; message: string; traceId: string; status?: number };

/**
 * Distinguishes the failure causes the UI must never collapse into one another:
 * a 401 is not a 403, and neither is a missing route or a dependency outage.
 */
function classify(status: number): { reason: ReadinessFailureReason; message: string } {
  if (status === 401) {
    return {
      reason: 'UNAUTHENTICATED',
      message: 'Your admin session is not authenticated. Sign in again to load module readiness.',
    };
  }
  if (status === 403) {
    return {
      reason: 'FORBIDDEN',
      message:
        'Your role does not include reports read access, which the Control Centre requires to compute module readiness.',
    };
  }
  if (status === 404) {
    return {
      reason: 'ROUTE_MISSING',
      message:
        'The readiness route is not mounted on the API this page is talking to. The deployed API build is older than this admin build.',
    };
  }
  return {
    reason: 'SERVICE_UNAVAILABLE',
    message: `The readiness service returned HTTP ${status}. Module status cannot be computed right now.`,
  };
}

export async function fetchModuleReadiness(
  token: string,
  options: { category?: ModuleCategory; timeoutMs?: number } = {},
): Promise<ReadinessResult> {
  // Correlates the browser request with API logs even when the call fails.
  const traceId = crypto.randomUUID();
  const query = options.category ? `?category=${options.category}` : '';

  try {
    const response = await fetch(`${apiBase}/admin/control-centre/modules${query}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-correlation-id': traceId,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });

    if (!response.ok) {
      const { reason, message } = classify(response.status);
      return { ok: false, reason, message, traceId, status: response.status };
    }

    const body = (await response.json()) as { success?: boolean; data?: ReadinessSummary };
    if (!body?.success || !Array.isArray(body.data?.modules)) {
      return {
        ok: false,
        reason: 'MALFORMED_RESPONSE',
        message: 'The readiness service replied without a module collection.',
        traceId,
      };
    }
    return { ok: true, summary: body.data as ReadinessSummary, traceId };
  } catch (error) {
    return {
      ok: false,
      reason: 'NETWORK',
      message:
        error instanceof Error && error.name === 'TimeoutError'
          ? 'The readiness service did not respond in time.'
          : 'The readiness service could not be reached from the admin server.',
      traceId,
    };
  }
}

/** Presentation tone per axis. Access and activation are never failure colours. */
export function serviceTone(status: ModuleServiceStatus): 'success' | 'warning' | 'danger' {
  if (status === 'LIVE') return 'success';
  if (status === 'DEGRADED' || status === 'BLOCKED') return 'warning';
  return 'danger';
}

export function accessTone(status: ModuleAccessStatus): 'info' | 'neutral' {
  return status === 'OPEN' ? 'neutral' : 'info';
}

export function activationTone(status: ModuleActivationStatus): 'success' | 'neutral' {
  return status === 'ACTIVE' ? 'success' : 'neutral';
}

/** Plain-English meaning so an operator never has to infer it from a colour. */
export function activationExplanation(status: ModuleActivationStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'Switched on and operating.';
    case 'DORMANT':
      return 'Operational and auditable, but the business programme is not switched on. An operator approval activates it.';
    case 'READ_ONLY':
      return 'Inspection only — this module performs no outward action.';
    case 'DRY_RUN':
      return 'Running without external side effects while some providers are still unconfigured.';
    case 'NOT_CONFIGURED':
      return 'The capability works and can report its state; no external provider is connected yet.';
    default:
      return '';
  }
}

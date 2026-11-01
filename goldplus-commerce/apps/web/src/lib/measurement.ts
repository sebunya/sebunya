/**
 * Whether server-side measurement is actually provisioned.
 *
 * The container id gate was already right — production carries no
 * PUBLIC_GTM_ID, so no tag has ever been injected. The hole was the endpoint:
 *
 *     PUBLIC_METRICS_URL || 'https://metrics.shopgoldplus.com'
 *
 * That default is a guess, not a fact. `metrics.shopgoldplus.com` has no DNS
 * record, so a deploy that set the container id and forgot the endpoint would
 * ship a loader pointing at a host that does not resolve — measurement that
 * looks configured, reports nothing, and costs every visitor a failed request.
 *
 * Provisioning is all three or none: an id to load, an endpoint to load it
 * from, and the server container behind that endpoint. Two out of three is not
 * a degraded integration, it is an unconfigured one.
 */

const clean = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export interface MeasurementConfig {
  configured: boolean;
  gtmId: string;
  metricsUrl: string;
}

export const resolveMeasurementConfig = (env: {
  PUBLIC_GTM_ID?: unknown;
  PUBLIC_METRICS_URL?: unknown;
}): MeasurementConfig => {
  const gtmId = clean(env.PUBLIC_GTM_ID);
  const metricsUrl = clean(env.PUBLIC_METRICS_URL).replace(/\/+$/, "");
  return { configured: gtmId.length > 0 && metricsUrl.length > 0, gtmId, metricsUrl };
};

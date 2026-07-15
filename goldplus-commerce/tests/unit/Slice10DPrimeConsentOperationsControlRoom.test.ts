import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConsentOperationsCounters } from '../../apps/api/src/application/ports/consent/ConsentOperationsSummaryRepository';
import {
  ConsentOperationsSummaryService,
  readConsentOperationsFeatureState,
  type ConsentOperationsFeatureState,
} from '../../apps/api/src/application/services/consent/ConsentOperationsSummaryService';
import routes from '../../apps/api/src/interfaces/http/routes/admin/consent-operations';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const paths = {
  port: 'apps/api/src/application/ports/consent/ConsentOperationsSummaryRepository.ts',
  service: 'apps/api/src/application/services/consent/ConsentOperationsSummaryService.ts',
  adapter: 'apps/api/src/infrastructure/consent/DrizzleConsentOperationsSummaryRepository.ts',
  runtime: 'apps/api/src/infrastructure/consent/ConsentOperationsRuntime.ts',
  route: 'apps/api/src/interfaces/http/routes/admin/consent-operations.ts',
  app: 'apps/api/src/interfaces/http/app.ts',
  page: 'apps/web/src/pages/admin/consent-operations.astro',
  navigation: 'apps/web/src/lib/admin-navigation.ts',
} as const;

const now = '2026-07-15T15:00:00.000Z';
const counters: ConsentOperationsCounters = {
  totalEvents: 4,
  grants: 2,
  withdrawals: 2,
  providerSuppressions: 0,
  policyBlocks: 0,
  duplicateLifecycleGroups: 0,
  lastEventAt: '2026-07-15T11:34:41.266Z',
  providerCallbacks: 0,
  providerUnsubscribes: 0,
  outboxRows: 0,
  notificationAttempts: 0,
  transportCalls: 0,
};
const features: ConsentOperationsFeatureState = {
  monitoringEnabled: true,
  incidentControlsRequested: false,
  safeOperatorStateAvailable: false,
  preferenceCentrePilotSaveEnabled: false,
  publicSavesEnabled: false,
  providerSendsEnabled: false,
  customerCommunicationsEnabled: false,
  notificationDeliveryEnabled: false,
};
const service = new ConsentOperationsSummaryService();

describe('Slice 10-D PRIME deterministic incident classifier', () => {
  it('returns green for the clean no-send baseline', () => {
    const result = service.evaluate(counters, features, now);
    expect(result.status).toBe('green');
    expect(result.incidents).toEqual([]);
    expect(result.noSend).toEqual({ providerCallbacks: 0, providerUnsubscribes: 0, outboxRows: 0, notificationAttempts: 0, transportCalls: 0 });
    expect(result.preferenceCentre).toEqual({ publicSavesEnabled: false, currentMode: 'read_only', noChangesSavedConfirmed: true });
  });

  it.each([
    ['providerCallbacks', 'PROVIDER_CALLBACK_ACTIVITY'],
    ['providerUnsubscribes', 'PROVIDER_UNSUBSCRIBE_ACTIVITY'],
    ['outboxRows', 'OUTBOX_ACTIVITY'],
    ['notificationAttempts', 'NOTIFICATION_ATTEMPT_ACTIVITY'],
    ['transportCalls', 'TRANSPORT_ACTIVITY'],
    ['duplicateLifecycleGroups', 'DUPLICATE_CONSENT_LIFECYCLE'],
  ] as const)('returns red when %s is non-zero', (key, code) => {
    const result = service.evaluate({ ...counters, [key]: 1 }, features, now);
    expect(result.status).toBe('red');
    expect(result.incidents.map(item => item.code)).toContain(code);
    expect(result.actions.canResume).toBe(false);
  });

  it.each([
    ['providerSendsEnabled', 'PROVIDER_SENDS_ENABLED'],
    ['customerCommunicationsEnabled', 'CUSTOMER_COMMUNICATIONS_ENABLED'],
    ['notificationDeliveryEnabled', 'NOTIFICATION_DELIVERY_ENABLED'],
    ['publicSavesEnabled', 'PUBLIC_PREFERENCE_SAVES_ENABLED'],
  ] as const)('returns red when %s is enabled', (key, code) => {
    const result = service.evaluate(counters, { ...features, [key]: true }, now);
    expect(result.status).toBe('red');
    expect(result.incidents.map(item => item.code)).toContain(code);
  });

  it('returns amber when pilot saves are enabled without a ledger timestamp', () => {
    const result = service.evaluate({ ...counters, lastEventAt: null }, { ...features, preferenceCentrePilotSaveEnabled: true }, now);
    expect(result.status).toBe('amber');
    expect(result.incidents.map(item => item.code)).toContain('PILOT_EVENT_TIMESTAMP_UNAVAILABLE');
  });

  it('never enables sends or unsafe write controls', () => {
    const result = service.evaluate(counters, features, now);
    expect(result.actions).toEqual({ canPause: false, canResume: false, canForceReadOnly: false, canEnableSends: false });
    expect(result.pilot.incidentControlsEnabled).toBe(false);
  });

  it('fails red when the counter source is unavailable', () => {
    const result = service.counterSourceUnavailable(features, now);
    expect(result.status).toBe('red');
    expect(result.incidents[0].code).toBe('COUNTER_SOURCE_UNAVAILABLE');
    expect(result.actions.canResume).toBe(false);
  });

  it('fails closed when incident controls are requested without safe persistence', () => {
    const result = service.evaluate(counters, { ...features, incidentControlsRequested: true }, now);
    expect(result.status).toBe('red');
    expect(result.pilot.incidentControlsEnabled).toBe(false);
    expect(result.incidents.map(item => item.code)).toContain('INCIDENT_CONTROLS_PERSISTENCE_UNAVAILABLE');
  });
});

describe('feature gates and read-only API protection', () => {
  it('defaults every new operations, public-save and delivery gate to false', () => {
    expect(readConsentOperationsFeatureState({})).toEqual({
      monitoringEnabled: false,
      incidentControlsRequested: false,
      safeOperatorStateAvailable: false,
      preferenceCentrePilotSaveEnabled: false,
      publicSavesEnabled: false,
      providerSendsEnabled: false,
      customerCommunicationsEnabled: false,
      notificationDeliveryEnabled: false,
    });
  });

  it('requires authentication before reading counters', async () => {
    const response = await routes.request('/summary');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('uses the existing audit-read permission and exposes GET only', () => {
    const source = read(paths.route);
    expect(source).toContain("routes.use('*', authMiddleware)");
    expect(source).toContain('requirePermissions([PERMISSIONS.AUDIT_READ])');
    expect(source).toContain("routes.get('/summary'");
    expect(source).not.toContain('routes.post(');
    expect(source).not.toContain('routes.put(');
    expect(source).not.toContain('routes.patch(');
  });

  it('mounts the exact protected operations summary path', () => {
    expect(read(paths.app)).toContain("app.route('/api/admin/consent/operations', adminConsentOperationsRoutes)");
  });

  it('returns aggregate fields without PII or secrets', () => {
    const payload = JSON.stringify(service.evaluate(counters, features, now));
    expect(payload).not.toMatch(/customer_identity_ref|endpoint_ref|recipient|email|phone|token|password|secret/i);
  });
});

describe('admin control room and artifact boundaries', () => {
  Object.values(paths).forEach(path => it(`${path} exists`, () => expect(read(path).length).toBeGreaterThan(40)));

  it('protects the page before loading operational data', () => {
    const page = read(paths.page);
    const guard = page.indexOf('readSessionToken(Astro.request)');
    const redirect = page.indexOf('return Astro.redirect');
    const fetch = page.indexOf('await fetch');
    expect(guard).toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(guard);
    expect(fetch).toBeGreaterThan(redirect);
    expect(page).toContain("Astro.redirect('/admin/login?returnTo=/admin/consent-operations', 303)");
  });

  it('labels every required sentinel and runbook section', () => {
    const page = read(paths.page);
    for (const label of ['Pilot State', 'Ledger Health', 'No-Send Sentinel', 'Preference Centre Safety', 'Incidents and Recommended Actions', 'Operator Runbook', 'No sends enabled', 'Public saves disabled', 'Provider delivery disabled']) {
      expect(page).toContain(label);
    }
  });

  it('contains no mutating control or provider transport', () => {
    const combined = [paths.service, paths.route, paths.page].map(read).join('\n').toLowerCase();
    expect(combined).not.toMatch(/recordconsentgrant|recordconsentwithdrawal|appendimmutableconsentevent|providertransport|sendemail|sendsms|sendwhatsapp/);
    expect(combined).not.toMatch(/<button|method="post"|canenablesends:\s*true/);
  });

  it('documents runbook-only controls in navigation and UI', () => {
    expect(read(paths.navigation)).toContain("href: '/admin/consent-operations'");
    expect(read(paths.page)).toContain('Write controls are deliberately deferred');
  });
});

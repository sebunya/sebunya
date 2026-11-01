import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  deriveProviderStatus,
  statusViewOf,
  statusBadgeClass,
  freshnessBadgeClass,
  familyBucketOf,
  friendlyError,
  fieldControlOf,
  readSchemaForm,
  durationOf,
  SUPPORTED_FIELD_TYPES,
  FRIENDLY_ERROR_MESSAGES,
  type ManifestField,
} from '../../apps/web/src/lib/adminSeoIntegrations';

const page = (rel: string) =>
  readFileSync(resolve(__dirname, '../../apps/web/src/pages/admin/seo/integrations', rel), 'utf8');

const INDEX = page('index.astro');
const DETAIL = page('[provider].astro');
const WIZARD = page('[provider]/connect.astro');
const SYNC = page('sync.astro');
const ALL_PAGES = [INDEX, DETAIL, WIZARD, SYNC];

describe('integration status derivation is honest', () => {
  it('reports NOT_CONFIGURED when a provider has no connection', () => {
    expect(deriveProviderStatus([])).toBe('NOT_CONFIGURED');
    expect(statusViewOf('NOT_CONFIGURED')).toBe('AVAILABLE');
  });

  it('never reports CONNECTED merely because a connection row exists', () => {
    expect(deriveProviderStatus([{ status: 'CONFIGURING' }])).toBe('CONFIGURING');
    expect(deriveProviderStatus([{ status: 'AUTHORIZATION_REQUIRED' }])).toBe('AUTHORIZATION_REQUIRED');
    expect(deriveProviderStatus([{ status: 'READY' }])).toBe('READY');
  });

  it('surfaces an error state ahead of a healthy sibling connection', () => {
    expect(deriveProviderStatus([{ status: 'CONNECTED' }, { status: 'AUTH_EXPIRED' }])).toBe('AUTH_EXPIRED');
    expect(statusViewOf('AUTH_EXPIRED')).toBe('ERROR');
  });

  it('keeps DISABLED distinct from not-set-up', () => {
    expect(deriveProviderStatus([{ status: 'DISABLED' }])).toBe('DISABLED');
    expect(statusViewOf('DISABLED')).toBe('DISABLED');
    expect(statusBadgeClass('DISABLED')).not.toBe(statusBadgeClass('NOT_CONFIGURED'));
  });

  it('gives NO_DATA its own badge — it is not STALE', () => {
    expect(freshnessBadgeClass('NO_DATA')).not.toBe(freshnessBadgeClass('STALE'));
    expect(freshnessBadgeClass('STALE')).not.toBe(freshnessBadgeClass('FRESH'));
  });

  it('buckets provider families and falls back to Other rather than guessing', () => {
    expect(familyBucketOf('GOOGLE_SEARCH')).toBe('Google');
    expect(familyBucketOf('CUSTOM_READ_ONLY')).toBe('Other');
    expect(familyBucketOf('something-unmapped')).toBe('Other');
  });
});

describe('typed provider errors reach the operator as actions', () => {
  it('covers all nine canonical error codes', () => {
    expect(Object.keys(FRIENDLY_ERROR_MESSAGES).sort()).toEqual([
      'ACCOUNT_NOT_ACCESSIBLE', 'AUTH_EXPIRED', 'CONFIGURATION_ERROR', 'INSUFFICIENT_SCOPE',
      'INVALID_CREDENTIAL', 'PROPERTY_NOT_FOUND', 'PROVIDER_UNAVAILABLE', 'QUOTA_EXCEEDED', 'RATE_LIMITED',
    ]);
  });

  it('never invents a diagnosis for an unknown code', () => {
    expect(friendlyError('SOMETHING_NEW')).toContain('no typed error code');
    expect(friendlyError('SOMETHING_NEW', 'provider said no')).toBe('provider said no');
  });
});

describe('manifest-driven form rendering covers every declared field type', () => {
  it('plans a control for each supported type', () => {
    for (const type of SUPPORTED_FIELD_TYPES) {
      const plan = fieldControlOf({ key: 'k', label: 'L', type, required: false });
      expect(['input', 'select', 'textarea']).toContain(plan.control);
    }
  });

  it('treats password-json as a secret textarea, never a plain text input', () => {
    const plan = fieldControlOf({ key: 'sa', label: 'Service account', type: 'password-json', required: true });
    expect(plan).toEqual({ control: 'textarea', inputType: 'password' });
  });

  it('omits blank optional fields instead of storing empty strings', () => {
    const fields: ManifestField[] = [
      { key: 'siteUrl', label: 'Site', type: 'url', required: true },
      { key: 'limit', label: 'Limit', type: 'number', required: false },
      { key: 'note', label: 'Note', type: 'text', required: false },
    ];
    const form = new FormData();
    form.set('cfg_siteUrl', ' https://shopgoldplus.com ');
    form.set('cfg_limit', '25');
    form.set('cfg_note', '   ');
    expect(readSchemaForm(fields, form, 'cfg_')).toEqual({ siteUrl: 'https://shopgoldplus.com', limit: 25 });
  });
});

describe('sync duration formatting', () => {
  it('renders an em dash rather than a fabricated duration', () => {
    expect(durationOf(null, null)).toBe('—');
    expect(durationOf('2026-08-13T10:00:00Z', null)).toBe('—');
  });

  it('formats real elapsed time', () => {
    expect(durationOf('2026-08-13T10:00:00Z', '2026-08-13T10:00:02Z')).toBe('2.0s');
    expect(durationOf('2026-08-13T10:00:00Z', '2026-08-13T10:02:30Z')).toBe('2m 30s');
  });
});

describe('the control-plane pages are real admin surfaces', () => {
  it('guards every page server-side before rendering', () => {
    for (const source of ALL_PAGES) {
      expect(source).toContain('readSessionToken(Astro.request)');
      // Static pages quote the return target; dynamic ones template-interpolate it.
      expect(source).toMatch(/return Astro\.redirect\([`'"]\/admin\/login\?returnTo=[^`'"]*[`'"], 303\)/);
    }
  });

  it('never offers to reveal a stored secret', () => {
    for (const source of ALL_PAGES) {
      expect(source).not.toMatch(/show\s*secret|reveal\s*secret|show\s*key/i);
    }
    expect(DETAIL).toContain('never displayed again');
  });

  it('shows no fabricated health score anywhere', () => {
    for (const source of ALL_PAGES) {
      expect(source).not.toMatch(/health\s*(score|%)|API Health/i);
    }
  });

  it('drives every operator action through an endpoint that actually exists', () => {
    // Asserting that a path string appears in the page proves nothing: delete
    // the handler and the page still contains the string. So resolve each UI
    // action against the ROUTE FILE's real registrations.
    const routeSource = readFileSync(
      resolve(__dirname, '../../apps/api/src/interfaces/http/routes/admin/seo-integrations.ts'),
      'utf8',
    );
    const registered = new Set(
      [...routeSource.matchAll(/routes\.(get|post|patch|delete)\('([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`),
    );
    for (const route of [
      'GET /providers', 'GET /connections', 'POST /connections', 'PATCH /connections/:id',
      'DELETE /connections/:id', 'POST /connections/:id/credentials', 'GET /connections/:id/credentials',
      'POST /credentials/:id/revoke', 'POST /connections/:id/test', 'POST /connections/:id/discover',
      'POST /connections/:id/select-resource', 'POST /connections/:id/sync',
      'POST /sync-jobs/:id/cancel', 'GET /sync-jobs', 'GET /audit', 'GET /usage',
      'GET /oauth/google/start',
    ]) {
      expect(registered, `the UI depends on ${route}`).toContain(route);
    }
    for (const intent of ['test', 'discover', 'select-resource', 'sync', 'rotate-credential', 'revoke-credential', 'oauth', 'delete']) {
      expect(DETAIL, `detail page must handle intent ${intent}`).toContain(`"${intent}"`);
    }
  });

  it('keeps the OAuth callback off the admin router, where it could never authenticate', () => {
    // Google's consent redirect is a browser navigation with no Authorization
    // header. Registered under authMiddleware it returned 401 and the button
    // was a dead control that left the connection AUTHORIZATION_REQUIRED.
    const adminRoutes = readFileSync(
      resolve(__dirname, '../../apps/api/src/interfaces/http/routes/admin/seo-integrations.ts'),
      'utf8',
    );
    const publicRoutes = readFileSync(
      resolve(__dirname, '../../apps/api/src/interfaces/http/routes/seo.ts'),
      'utf8',
    );
    expect(adminRoutes).not.toMatch(/routes\.get\('\/oauth\/google\/callback'/);
    expect(publicRoutes).toContain("routes.get('/oauth/google/callback'");
    expect(publicRoutes).toContain('oauth.consumeState(state)');
  });

  it('states plainly that a connection is not connected until a test passes', () => {
    expect(WIZARD).toContain('only after a staged test passes');
    expect(WIZARD).toContain('never marked connected');
  });

  it('keeps NO DATA distinct from STALE in the sync centre copy', () => {
    expect(SYNC).toContain('NO DATA');
    expect(SYNC).toContain('is not the same as');
  });

  it('uses exact states rather than vague placeholders', () => {
    for (const source of ALL_PAGES) {
      expect(source).not.toMatch(/coming soon|api unavailable|todo|placeholder/i);
    }
  });

  it('explains a credential-permission denial instead of showing "none"', () => {
    expect(DETAIL).toContain('seo.integrations.credentials');
  });
});

describe('the Google OAuth callback is reachable and returns the operator to the admin UI', () => {
  const publicRoutes = readFileSync(
    resolve(__dirname, '../../apps/api/src/interfaces/http/routes/seo.ts'),
    'utf8',
  );
  const oauthService = readFileSync(
    resolve(__dirname, '../../apps/api/src/infrastructure/seo/GoogleOAuthService.ts'),
    'utf8',
  );

  it('serves the callback from the API origin, which is what the redirect base must point at', () => {
    // The handler is mounted on the PUBLIC api router at /seo/oauth/google/callback.
    // Google therefore calls <API_ORIGIN>/seo/oauth/google/callback — NOT the
    // storefront origin, which has no such route and answers 404.
    expect(publicRoutes).toContain("routes.get('/oauth/google/callback'");
    expect(oauthService).toContain('/seo/oauth/google/callback');
  });

  it('returns the operator to the storefront admin UI, not to this API host', () => {
    // A relative redirect resolves against the API origin, landing the operator
    // on the JSON route (401) after a SUCCESSFUL authorization — a dead end.
    expect(publicRoutes).toContain('SEO_ADMIN_RETURN_BASE');
    expect(publicRoutes).toContain('CORS_ORIGIN');
    expect(publicRoutes).toMatch(/adminBase \? `\$\{adminBase\}\$\{path\}` : path/);
  });

  it('still rejects a missing or forged state', () => {
    expect(publicRoutes).toContain('oauth.consumeState(state)');
    expect(publicRoutes).toContain('oauth=invalid_state');
  });
});

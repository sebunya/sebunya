import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';
import { logger } from '../../../infrastructure/logging/logger';
import { isSocialProvider } from '../../../domain/identity/SocialProvider';
import {
  OIDC_PROVIDERS,
  buildAuthorizationUrl,
  createPkcePair,
  exchangeCodeForIdToken,
  isProviderConfigured,
  providerCredentials,
  randomToken,
  verifyIdToken,
} from '../../../infrastructure/identity/OidcProviders';
import { ResolveSocialIdentityUseCase } from '../../../application/use-cases/identity/ResolveSocialIdentityUseCase';

/**
 * Social sign-in — the cryptographic half (0106).
 *
 * WHY THE FLOW IS SPLIT. The session cookie belongs to the STOREFRONT host
 * (shopgoldplus.com); the API answers on a different host and its cookies are
 * invisible there. So the browser-facing half of the flow — the redirect out,
 * the callback back, and setting the session — lives on the web tier, and this
 * file does the parts that must never happen in a browser: minting and sealing
 * the flow, exchanging the authorization code, and verifying the ID token.
 *
 * The web tier holds the sealed flow as an opaque string. It cannot read it,
 * cannot forge one (HMAC with a server secret), and cannot make this endpoint
 * accept a state it did not issue.
 *
 * Every route answers NOT_CONFIGURED honestly when a provider has no
 * credentials, which is the state production is in right now.
 */

const routes = new Hono();

const FLOW_TTL_SECONDS = 10 * 60;

const flowSecret = (): string =>
  (process.env.CART_CREDENTIAL_SECRET || process.env.JWT_SECRET || '').trim();

interface FlowState {
  provider: string;
  state: string;
  nonce: string;
  verifier: string;
  issuedAt: number;
}

const sealFlow = (flow: FlowState): string => {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  const mac = createHmac('sha256', flowSecret()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
};

const openFlow = (sealed: string | undefined): FlowState | null => {
  if (!sealed) return null;
  const [payload, mac] = sealed.split('.');
  if (!payload || !mac) return null;
  const expected = createHmac('sha256', flowSecret()).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Constant-time: a length-leaking compare on a MAC is a forgery oracle.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as FlowState;
    if (Date.now() - flow.issuedAt > FLOW_TTL_SECONDS * 1000) return null;
    return flow;
  } catch {
    return null;
  }
};

const publicWebBase = (): string =>
  (process.env.PUBLIC_WEB_BASE_URL || 'https://shopgoldplus.com').replace(/\/$/, '');

/** The provider redirects the BROWSER here — a storefront URL, not an API one. */
const redirectUriFor = (provider: string): string => `${publicWebBase()}/auth/${provider}/callback`;

/** Which providers an operator has actually configured — drives the UI. */
routes.get('/providers', async (c) => {
  const entries = await Promise.all(
    Object.values(OIDC_PROVIDERS).map(async (config) => ({
      provider: config.provider,
      displayName: config.displayName,
      configured: await isProviderConfigured(config.provider),
      startUrl: `/auth/${config.provider}/start`,
    })),
  );
  const res: ApiResponse<{ providers: typeof entries }> = { success: true, data: { providers: entries } };
  return c.json(res);
});

/**
 * Mint a flow. Returns the URL to send the browser to, plus the sealed state
 * the web tier must hand back at the callback.
 */
routes.post('/:provider/authorize-url', async (c) => {
  const provider = String(c.req.param('provider'));
  if (!isSocialProvider(provider)) {
    return c.json({ success: false, error: { code: 'UNKNOWN_PROVIDER', message: 'Unknown sign-in provider.' } }, 404);
  }
  if (!flowSecret()) {
    return c.json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'Sign-in is not configured on this server.' } }, 503);
  }

  const credentials = await providerCredentials(provider);
  if (!credentials) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_CONFIGURED',
          message: `${OIDC_PROVIDERS[provider].displayName} sign-in is not configured. Set ${provider.toUpperCase()}_CLIENT_ID and its secret to enable it.`,
        },
      },
      503,
    );
  }

  const { verifier, challenge } = createPkcePair();
  const flow: FlowState = {
    provider,
    state: randomToken(),
    nonce: randomToken(),
    verifier,
    issuedAt: Date.now(),
  };

  const authorizationUrl = buildAuthorizationUrl({
    provider,
    clientId: credentials.clientId,
    redirectUri: redirectUriFor(provider),
    state: flow.state,
    nonce: flow.nonce,
    codeChallenge: challenge,
  });

  const res: ApiResponse<{ authorizationUrl: string; sealedFlow: string; state: string; usesFormPost: boolean }> = {
    success: true,
    data: {
      authorizationUrl,
      sealedFlow: sealFlow(flow),
      state: flow.state,
      usesFormPost: OIDC_PROVIDERS[provider].responseMode === 'form_post',
    },
  };
  return c.json(res);
});

/**
 * Exchange a completed callback for a session token.
 *
 * Refuses unless the sealed flow verifies, belongs to this provider, and
 * carries the same `state` the browser came back with. Anything else is a
 * callback we did not start — the CSRF case.
 */
routes.post('/:provider/exchange', async (c) => {
  const provider = String(c.req.param('provider'));
  if (!isSocialProvider(provider)) {
    return c.json({ success: false, error: { code: 'UNKNOWN_PROVIDER', message: 'Unknown sign-in provider.' } }, 404);
  }

  const body = await c.req.json().catch(() => null);
  const code = String(body?.code ?? '');
  const state = String(body?.state ?? '');
  const flow = openFlow(typeof body?.sealedFlow === 'string' ? body.sealedFlow : undefined);

  const refuse = (code: string, message: string, status = 400) =>
    c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status as never);

  if (!flow || flow.provider !== provider || !state || state !== flow.state) {
    logger.warn({ provider }, 'SOCIAL_LOGIN_STATE_MISMATCH');
    return refuse('STATE_MISMATCH', 'This sign-in could not be verified. Start again.', 400);
  }
  if (!code) return refuse('NO_CODE', 'Sign-in was cancelled.', 400);

  const credentials = await providerCredentials(provider);
  if (!credentials) return refuse('NOT_CONFIGURED', 'This provider is not configured.', 503);

  const exchanged = await exchangeCodeForIdToken({
    provider,
    code,
    redirectUri: redirectUriFor(provider),
    codeVerifier: flow.verifier,
    credentials,
  });
  if (!exchanged.ok) {
    logger.warn({ provider, reason: exchanged.reason }, 'SOCIAL_LOGIN_EXCHANGE_FAILED');
    return refuse('EXCHANGE_FAILED', 'We could not complete sign-in with that provider. Try again.', 502);
  }

  const verified = await verifyIdToken({
    idToken: exchanged.idToken,
    provider,
    clientId: credentials.clientId,
    expectedNonce: flow.nonce,
  });
  if (!verified.ok) {
    logger.warn({ provider, reason: verified.reason }, 'SOCIAL_LOGIN_TOKEN_REJECTED');
    return refuse('TOKEN_REJECTED', 'That sign-in could not be verified. Start again.', 401);
  }

  const registry = Registry.getInstance();
  const resolved = await new ResolveSocialIdentityUseCase(registry.userRepo, registry.socialIdentityRepo).execute({
    provider,
    subject: verified.identity.subject,
    email: verified.identity.email,
    emailVerified: verified.identity.emailVerified,
    autoLinkOnVerifiedEmail: OIDC_PROVIDERS[provider].autoLinkOnVerifiedEmail,
  });

  if (!resolved.ok) {
    logger.info({ provider, code: resolved.code }, 'SOCIAL_LOGIN_REFUSED');
    return refuse(resolved.code, resolved.message, resolved.code === 'ACCOUNT_DISABLED' ? 403 : 409);
  }

  const user = await registry.userRepo.findById(resolved.userId);
  if (!user) return refuse('ACCOUNT_MISSING', 'That account could not be loaded.', 500);

  const ttlSeconds = 60 * 60 * 24 * 7;
  const token = await registry.tokenSigner.sign({ subject: user.id, email: user.email, ttlSeconds });

  await registry.createAuditLogUseCase
    .execute({
      actorId: user.id,
      action: resolved.created ? 'SOCIAL_ACCOUNT_CREATED' : resolved.linked ? 'SOCIAL_IDENTITY_LINKED' : 'SOCIAL_LOGIN',
      entity: 'user',
      entityId: user.id,
      previousState: null,
      newState: { provider, emailVerified: verified.identity.emailVerified },
    })
    .catch(() => undefined);

  const res: ApiResponse<{
    token: string;
    expiresAt: string;
    created: boolean;
    user: { id: string; email: string };
  }> = {
    success: true,
    data: {
      token,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      created: resolved.created,
      user: { id: user.id, email: user.email },
    },
  };
  return c.json(res);
});

export default routes;

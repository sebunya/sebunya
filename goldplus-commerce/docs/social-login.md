# Social Login (Google, OAuth 2.0 / OpenID Connect)

Google sign-in using the OAuth 2.0 authorization-code flow. The design is
provider-agnostic (`ISocialIdentityProvider`), so Facebook/Apple can be added
later by implementing the same port — no changes to the login use case.

## Configuration

| Variable                     | Required | Notes |
|------------------------------|----------|-------|
| `GOOGLE_OAUTH_CLIENT_ID`     | yes      | From the Google Cloud console OAuth client. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes      | Same client. |
| `GOOGLE_OAUTH_REDIRECT_URI`  | yes      | Must exactly match the console entry and point at the **web** callback, e.g. `https://<web-host>/auth/google/callback`. |

**No fake integrations**: with any credential missing, the API `/auth/google/url`
endpoint returns `503 NOT_CONFIGURED` and nothing is attempted.

## Flow

The **web app** owns the browser-facing redirect and CSRF state (its session
cookie lives on the web origin); the **API** only builds the authorization URL
and performs the secret code→token exchange, so no access token or provider
secret ever reaches the browser.

```
Web  GET /auth/google            -> mints CSRF state (HttpOnly cookie on web origin),
                                     asks API GET /auth/google/url?state=, 303 to Google
Web  GET /auth/google/callback   -> validates state cookie, POSTs code to
                                     API POST /auth/google/exchange, sets session, 303 /account
API  GET  /auth/google/url        -> { url } for the given state (503 NOT_CONFIGURED if unset)
API  POST /auth/google/exchange   -> { code } -> session token + resolution outcome
```

The API exchanges the code for an access token and reads the OpenID `userinfo`
profile directly from Google over TLS, so no local signature verification is
needed. OAuth failures bounce back to `/login?social=<reason>` with a friendly
message.

## Account resolution (`SocialLoginUseCase`)

1. **Known identity** `(provider, providerUserId)` → sign in that user (`SIGNED_IN`).
2. **Same verified email** on an existing account → link the identity, sign in (`LINKED`).
3. **Otherwise** → create an account with a random unusable password, link, sign in
   (`REGISTERED`), and enqueue the welcome email.

Only **provider-verified** emails are trusted for step 2 — an unverified email can
never take over an existing account (`EMAIL_UNVERIFIED`). Disabled accounts are
refused (`ACCOUNT_DISABLED`). Every sign-in writes a `SOCIAL_LOGIN` audit entry.

## Managing linked accounts

```
GET    /account/identities            # list linked providers (Bearer session)
DELETE /account/identities/:provider  # unlink
```

Unlinking is blocked (`LAST_LOGIN_METHOD`) when it would remove the account's only
remaining sign-in method without a usable password set — so a user can never lock
themselves out.

## Security notes

- `state` cookie is HttpOnly + SameSite=Lax and cleared after the callback.
- Cookies are marked `Secure` when `NODE_ENV=production`.
- Provider secrets live only in environment variables; access/refresh tokens are
  used transiently and never persisted.
- Only `openid email profile` scopes are requested.

## Testing

`tests/unit/SocialLogin.test.ts` — all three resolution paths, unverified-email
refusal, disabled-account refusal, NOT_CONFIGURED propagation, and the
`GoogleOAuthAdapter` (unconfigured behaviour, successful code exchange, and
provider-rejection handling) using an injected fetch.

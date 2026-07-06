# Social Login (Google, OAuth 2.0 / OpenID Connect)

Google sign-in using the OAuth 2.0 authorization-code flow. The design is
provider-agnostic (`ISocialIdentityProvider`), so Facebook/Apple can be added
later by implementing the same port — no changes to the login use case.

## Configuration

| Variable                     | Required | Notes |
|------------------------------|----------|-------|
| `GOOGLE_OAUTH_CLIENT_ID`     | yes      | From the Google Cloud console OAuth client. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes      | Same client. |
| `GOOGLE_OAUTH_REDIRECT_URI`  | yes      | Must exactly match the console entry and point at `/auth/google/callback`. |

**No fake integrations**: with any credential missing, `/auth/google/*` returns
`503 NOT_CONFIGURED` and nothing is attempted.

## Flow

```
GET /auth/google/start      -> 302 redirect to Google, sets HttpOnly state cookie (CSRF)
GET /auth/google/callback   -> validates state, exchanges code, returns session token
```

1. `start` mints a random `state`, stores it in an HttpOnly, SameSite=Lax cookie,
   and redirects to Google's consent screen.
2. `callback` rejects any `state` mismatch (`BAD_STATE`, CSRF protection), exchanges
   the code for an access token, and reads the OpenID `userinfo` profile. The token
   is fetched directly from Google over TLS, so no local signature verification is
   needed.

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

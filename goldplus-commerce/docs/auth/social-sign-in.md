# Social sign-in: Google, Apple, Facebook

Code: `apps/api/src/infrastructure/identity/OidcProviders.ts` (providers), `apps/api/src/interfaces/http/routes/auth-social.ts`
(flow, exchange), `apps/web/src/pages/auth/[provider]/` (browser half), `apps/web/src/pages/account/sign-in.astro`
(Account → Sign-in methods).

A provider shows on `/login` and `/register` only when its credentials are set. Until then it is "not configured" and
there is no button. Set the variables in `/opt/goldplus/app/goldplus-commerce/.env.production`. Compose passes them to
the api by name (`docker-compose.production.yml`). Then restart the api: `scripts/deploy-prod.sh <sha> api`.

| Provider | Where the customer returns (register exactly this) | Variables |
|---|---|---|
| Google | `https://shopgoldplus.com/auth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Apple | `https://api.shopgoldplus.com/auth/social/apple/form-post` | `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` |
| Facebook | `https://shopgoldplus.com/auth/facebook/callback` | `FACEBOOK_CLIENT_ID` (App ID), `FACEBOOK_CLIENT_SECRET` (App secret) |

## Google (Google Cloud Console)
1. Google Auth Platform → Branding:
   - App name GoldPlus, support email, home page `https://shopgoldplus.com`.
   - Privacy policy `https://shopgoldplus.com/privacy`, terms `https://shopgoldplus.com/terms`.
   - Authorised domain `shopgoldplus.com`.
2. Data access: the scopes are `openid`, `email` and `profile` only. These are basic scopes, so no sensitive-scope review applies.
3. Clients → Create client → Web application. Add the authorised redirect URI from the table. Copy the client ID and secret.
4. Audience → Publish app (In production). While it is "Testing", only listed test users can sign in.

## Apple (developer.apple.com, needs the paid Apple Developer Program)
1. Identifiers → App IDs: an App ID with **Sign in with Apple** enabled. It is needed as the primary ID even for a website.
2. Identifiers → Services IDs → register one, for example `com.shopgoldplus.web`. This identifier is `APPLE_CLIENT_ID`.
   - Enable Sign in with Apple → Configure.
   - Primary App ID: the one from step 1.
   - Domains: `shopgoldplus.com`, `api.shopgoldplus.com`.
   - Return URL: the one in the table.
3. Keys → create a key with Sign in with Apple, linked to that App ID.
   - Download the `.p8` file. Apple gives it once.
   - Its Key ID is `APPLE_KEY_ID`.
4. `APPLE_TEAM_ID` is the Team ID shown under Membership.
5. `APPLE_PRIVATE_KEY` is the `.p8` contents on ONE line, with `\n` where each line break was.
   - The code turns `\n` back into line breaks.
   - It signs a fresh 15-minute client secret per sign-in, so nothing expires every six months.
6. Customers who choose "Hide my email" get an `@privaterelay.appleid.com` address. Apple forwards mail to it only from
   registered senders.
   - Register them under Services → Sign in with Apple for Email Communication: the sending domain (`shopgoldplus.com`),
     its SPF, and the from-address the shop uses.
   - Until then, receipts to those customers bounce.

How it works: Apple returns the sign-in as a cross-site form POST. The API's relay answers it with a 303 to the website
callback, so the website's cookie and origin rules stay strict. Apple documents no PKCE, so the Apple flow sends none.
State, nonce and the signed client secret bind it.

## Facebook (developers.facebook.com)
1. Create an app with the use case **Authenticate and request data from users with Facebook Login** (consumer login).
   - The WhatsApp/Business app is the wrong type: Facebook Login for Business is for business assets, not customers.
2. Facebook Login → Settings: add the Valid OAuth Redirect URI from the table.
   - Keep "Use Strict Mode for redirect URIs" on.
3. Permissions: `public_profile` and `email`.
4. App settings → Basic:
   - Privacy Policy URL `https://shopgoldplus.com/privacy`.
   - User data deletion `https://shopgoldplus.com/data-deletion`.
   - Add an icon and a category.
   - Switch the app to **Live**. In Development mode only the app's own roles can sign in.
5. The App ID is `FACEBOOK_CLIENT_ID` and the App secret is `FACEBOOK_CLIENT_SECRET`.

How it works: the shop uses Facebook's OIDC code flow with PKCE (Meta's guide "OIDC Code Flow with PKCE for Manually
Built Facebook Login Flows"). The guide is marked as still in testing by Meta, so test a real Facebook sign-in after
switching it on. The exchange is a GET on the shop's pinned Graph version (`META_GRAPH_VERSION`).

Facebook does not assert that an email is verified. A Facebook sign-in never joins an existing account automatically.
- If an account already uses that email, the customer is asked to sign in with the password.
- They can then connect Facebook under Account → Sign-in methods.

## Which account a sign-in opens
- A provider identity already connected → that account.
- A new email → a new account with no password. The customer can set one with Forgot password.
- An existing email:
  - Google or Apple, with the email verified → joined to that account. An unproven password on it is cleared and its
    sessions are ended (`ResolveSocialIdentityUseCase`).
  - Facebook → refused with "sign in with your password, then connect it".
- Account → Sign-in methods connects a provider to the signed-in account, whatever its email.
  - Refused when that provider account already opens a different GoldPlus account, or when another account from the
    same provider is connected.
  - Removing is refused when it is the last way in.

## After switching one on
1. `curl -s https://api.shopgoldplus.com/auth/social/providers`: the provider shows `"configured":true`.
2. `/login` shows the button. Sign in with a real account and check you land signed in.
3. Account → Sign-in methods shows it as connected.

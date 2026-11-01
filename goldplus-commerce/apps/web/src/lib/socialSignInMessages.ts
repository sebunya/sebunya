/**
 * What a customer reads when a social sign-in (or connecting a provider) did not complete.
 *
 * The callback and start routes redirect with `?social_error=<code>` (the API's error code, lower-cased). The login
 * page used to ignore it, so a refused sign-in landed on the plain form with no word of why; a customer told nothing
 * tries the same button again. Unknown codes get the general line, never the raw code.
 */
const MESSAGES: Record<string, string> = {
  cancelled: 'Sign-in was cancelled before it finished. Nothing was changed.',
  no_code: 'Sign-in was cancelled before it finished. Nothing was changed.',
  state: 'That sign-in took too long or was started in another tab. Please start again.',
  state_mismatch: 'That sign-in took too long or was started in another tab. Please start again.',
  not_configured: 'That sign-in option is not available right now. Use your email and password.',
  start: 'We could not start that sign-in just now. Please try again, or use your email and password.',
  exchange: 'We could not finish signing you in with that provider. Please try again.',
  exchange_failed: 'We could not finish signing you in with that provider. Please try again.',
  token_rejected: 'That sign-in could not be verified. Please start again.',
  manual_link_required:
    'An account already uses that email address. Sign in with your password, then connect the provider under Account, Sign-in methods.',
  no_email_from_provider:
    'The provider did not share an email address, so we could not find or create your account. Sign in with your email and password, then connect it under Account, Sign-in methods.',
  account_disabled: 'This account has been disabled. Please contact us on WhatsApp.',
  account_missing: 'That account could not be loaded. Please contact us on WhatsApp.',
  identity_in_use:
    'That provider account already signs in to a different GoldPlus account. Sign in with it to use that account.',
  provider_already_linked: 'A different account from that provider is already connected. Remove it first, then connect this one.',
  link_session_mismatch: 'Your session changed while connecting. Sign in again, then connect the provider.',
  unauthenticated: 'Please sign in first, then connect the provider.',
};

const GENERAL = 'We could not complete that sign-in. Please try again, or use your email and password.';

export function socialSignInMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.trim().toLowerCase();
  return MESSAGES[key] ?? GENERAL;
}

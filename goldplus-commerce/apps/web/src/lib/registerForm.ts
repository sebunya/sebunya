/**
 * The /register form's own checks and messages.
 *
 * Before 2026-09-24 every refused registration showed "Check the highlighted
 * fields" while no field was highlighted: the page never passed an error to a
 * field. The API's reason (BAD_INPUT: phone, email or password) is used here
 * only to decide WHICH field is wrong; what the customer reads is always the
 * page's own sentence, never the API's text.
 *
 * The shapes mirror RegisterCustomerUseCase exactly, so the page never refuses
 * something the API would accept (or the reverse).
 */

export type RegisterField = 'email' | 'phone' | 'password' | 'confirmPassword';
export type RegisterFieldErrors = Partial<Record<RegisterField, string>>;

/** Same as RegisterCustomerUseCase EMAIL_SHAPE. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/**
 * Same as RegisterCustomerUseCase UG_PHONE_SHAPE, checked after removing spaces and hyphens.
 *
 * Checkout also takes a landline (0414 123 456, see UG_FIXED_LINE in
 * lib/checkout.ts) because a rider can ring one. The account phone is
 * different on purpose: it is where the password-reset SMS code goes, and a
 * landline cannot receive one, so the API refuses it and so does this page.
 * The two agree on everything else: spaces and hyphens are ignored, and the
 * message names an example number in the same format.
 */
const UG_PHONE_SHAPE = /^(\+?256|0)?[17]\d{8}$/;
export const MIN_PASSWORD_LENGTH = 8;

export const REGISTER_FIELD_MESSAGES = {
  emailMissing: 'Enter your email address.',
  email: 'Enter a valid email address, like name@example.com.',
  phoneMissing: 'Enter your phone number.',
  phone: 'Enter a Ugandan mobile number, like 0772 123 456.',
  passwordMissing: 'Choose a password.',
  password: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  confirmPassword: 'The two passwords do not match.',
} as const;

/** The order fields appear in on the form: the first error gets the focus. */
export const REGISTER_FIELD_ORDER: RegisterField[] = ['email', 'phone', 'password', 'confirmPassword'];

export interface RegisterInput {
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

/** Everything the page can check before asking the API. */
export function validateRegistration(input: RegisterInput): RegisterFieldErrors {
  const errors: RegisterFieldErrors = {};
  const email = input.email.trim();
  const phone = input.phone.replace(/[\s-]/g, '');

  if (!email) errors.email = REGISTER_FIELD_MESSAGES.emailMissing;
  else if (!EMAIL_SHAPE.test(email.toLowerCase()) || email.length > 255) errors.email = REGISTER_FIELD_MESSAGES.email;

  if (!phone) errors.phone = REGISTER_FIELD_MESSAGES.phoneMissing;
  else if (!UG_PHONE_SHAPE.test(phone)) errors.phone = REGISTER_FIELD_MESSAGES.phone;

  if (!input.password) errors.password = REGISTER_FIELD_MESSAGES.passwordMissing;
  else if (input.password.length < MIN_PASSWORD_LENGTH) errors.password = REGISTER_FIELD_MESSAGES.password;
  else if (input.password !== input.confirmPassword) errors.confirmPassword = REGISTER_FIELD_MESSAGES.confirmPassword;

  return errors;
}

/**
 * Which field a BAD_INPUT refusal is about. The API message is read to
 * classify, never shown. Unknown wording returns no field, and the page falls
 * back to a sentence that does not promise a highlight.
 */
export function fieldErrorsFromBadInput(apiMessage: unknown): RegisterFieldErrors {
  const text = typeof apiMessage === 'string' ? apiMessage : '';
  if (/phone/i.test(text)) return { phone: REGISTER_FIELD_MESSAGES.phone };
  if (/password/i.test(text)) return { password: REGISTER_FIELD_MESSAGES.password };
  if (/email/i.test(text)) return { email: REGISTER_FIELD_MESSAGES.email };
  return {};
}

export function firstErrorField(errors: RegisterFieldErrors): RegisterField | null {
  return REGISTER_FIELD_ORDER.find((f) => Boolean(errors[f])) ?? null;
}

/** The banner above the form: it only mentions marked fields when there are some. */
export function registerBannerMessage(errors: RegisterFieldErrors): string {
  const count = REGISTER_FIELD_ORDER.filter((f) => Boolean(errors[f])).length;
  if (count === 0) return 'Some details do not look right. Please check them and try again.';
  return count === 1 ? 'Please fix the field marked below.' : 'Please fix the fields marked below.';
}

/** Cookie that carries the header "Join free" number across the clean-URL redirect. */
export const JOIN_PHONE_COOKIE = 'gp_join_phone';

/**
 * The number typed into the header's "Join free" form arrives as ?phone=…
 * (a GET form). It is carried into the phone field, but it must not stay in
 * the address bar, where analytics would record it as part of the page URL.
 * Returns the value to prefill, or '' when there is nothing usable. Only digits,
 * spaces, hyphens and a leading + survive, capped at 20 characters.
 */
export function sanitiseJoinPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim().slice(0, 20);
  const cleaned = trimmed.replace(/[^\d\s+-]/g, '').replace(/(?!^)\+/g, '').trim();
  return /\d/.test(cleaned) ? cleaned : '';
}

/** The /register URL with the phone removed and only returnTo and ref kept. */
export function registerUrlWithoutPhone(url: URL): string {
  const kept = new URLSearchParams();
  for (const key of ['returnTo', 'ref']) {
    const value = url.searchParams.get(key);
    if (value) kept.set(key, value);
  }
  const qs = kept.toString();
  return qs ? `/register?${qs}` : '/register';
}

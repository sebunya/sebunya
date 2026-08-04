import { IUserRepository } from '../../ports/IUserRepository';
import { IPasswordHasher } from '../../ports/IPasswordHasher';
import { ITokenSigner } from '../../ports/ITokenSigner';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // same session length as login

/**
 * Self-service customer registration.
 *
 * Until this existed the platform had NO door into the account system: the only
 * users were operator-bootstrapped, so loyalty (keyed by user id), order history
 * and every other account feature were structurally unreachable for real
 * customers — the loyalty programme could be "active" while nobody could ever
 * hold an account to earn into.
 *
 * Phone is REQUIRED, not optional: it is the identity Ugandan commerce actually
 * runs on (delivery calls, mobile-money payments), and a user row without a
 * phone can never be matched to the orders it will place.
 *
 * Past guest orders are deliberately NOT claimed at registration. The phone is
 * unverified at this point, so claiming order history by phone match would hand
 * anyone who types someone else's number that person's purchase history. Orders
 * link from the first signed-in checkout onward; back-claiming needs phone
 * verification first.
 */
export interface RegisterCustomerInput {
  email: string;
  phone: string;
  password: string;
}

export type RegisterCustomerResult =
  | {
      ok: true;
      token: string;
      user: { id: string; email: string; phone: string | null };
      expiresAt: Date;
    }
  | {
      ok: false;
      code: 'BAD_INPUT' | 'ALREADY_REGISTERED' | 'AUTH_NOT_CONFIGURED';
      message: string;
    };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UG_PHONE_SHAPE = /^(\+?256|0)?[17]\d{8}$/;

export class RegisterCustomerUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IPasswordHasher,
    private readonly signer: ITokenSigner,
  ) {}

  async execute(input: RegisterCustomerInput): Promise<RegisterCustomerResult> {
    const email = (input.email ?? '').trim().toLowerCase();
    const phone = (input.phone ?? '').replace(/[\s-]/g, '');
    const password = input.password ?? '';

    if (!EMAIL_SHAPE.test(email) || email.length > 255) {
      return { ok: false, code: 'BAD_INPUT', message: 'Enter a valid email address.' };
    }
    if (!UG_PHONE_SHAPE.test(phone)) {
      return { ok: false, code: 'BAD_INPUT', message: 'Enter a valid Ugandan phone number (07XX XXX XXX).' };
    }
    if (password.length < 8) {
      return { ok: false, code: 'BAD_INPUT', message: 'Password must be at least 8 characters.' };
    }
    if (!this.signer.isConfigured()) {
      return { ok: false, code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured.' };
    }

    // Normalise to the storage form used by checkout (local 07…/expanded 2567…)
    // so a user's phone matches the phone their orders carry.
    const normalisedPhone = phone.startsWith('+') ? phone.slice(1) : phone;

    if (await this.users.findByEmail(email)) {
      // Registration is the one flow where "this email exists" must be said:
      // the person typing it either owns it (send them to sign in) or already
      // knows it exists. Hiding it here only strands the legitimate owner.
      return { ok: false, code: 'ALREADY_REGISTERED', message: 'An account with this email already exists. Sign in instead.' };
    }

    const passwordHash = await this.hasher.hash(password);
    let user;
    try {
      user = await this.users.create({ email, phone: normalisedPhone, passwordHash });
    } catch (error) {
      // Unique-violation duck-typing: postgres 23505 on email (raced) or phone.
      if ((error as { code?: string })?.code === '23505') {
        return { ok: false, code: 'ALREADY_REGISTERED', message: 'An account with this email or phone already exists. Sign in instead.' };
      }
      throw error;
    }

    const token = await this.signer.sign({ subject: user.id, email: user.email, ttlSeconds: SESSION_TTL_SECONDS });
    return {
      ok: true,
      token,
      user: { id: user.id, email: user.email, phone: user.phone },
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    };
  }
}

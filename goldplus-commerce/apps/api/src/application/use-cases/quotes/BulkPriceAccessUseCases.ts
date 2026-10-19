import type { IBulkPriceAccessRepository } from '../../ports/IBulkPriceAccessRepository';
import type { IBulkTermsRepository } from '../../ports/IBulkTermsRepository';
import {
  ACCESS_CODE_TTL_MS,
  MAX_CODES_PER_PHONE_PER_HOUR,
  challengeMessage,
  checkChallenge,
  issueAccessToken,
  maskPhone,
  readAccessToken,
} from '../../../domain/quotes/BulkPriceAccess';
import type { BulkUnit } from '../../../domain/quotes/BulkQuoteRequest';
import { isValidUgandanPhone, normalizePhone } from '../../services/validationHelpers';

/** The crypto the use cases need, implemented in infrastructure. */
export interface PriceAccessCrypto {
  /** A fresh six-digit code. */
  newCode(): string;
  /** Keyed hash of a code, as stored. */
  hashCode(code: string): string;
  /** Keyed MAC (hex) over a token body. */
  sign(body: string): string;
}

export interface CodeSender {
  send(phoneE164: string, code: string): Promise<unknown>;
}

const HOUR_MS = 60 * 60 * 1000;

export type StartPriceAccessResult =
  | { ok: true; maskedPhone: string }
  | { ok: false; code: 'BAD_PHONE' | 'TOO_MANY_CODES'; message: string };

/** Texts a six-digit code to the phone the buyer typed. */
export class StartBulkPriceAccessUseCase {
  constructor(
    private readonly access: IBulkPriceAccessRepository,
    private readonly sender: CodeSender,
    private readonly crypto: PriceAccessCrypto,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: { phone: unknown }): Promise<StartPriceAccessResult> {
    if (!isValidUgandanPhone(input.phone)) {
      return { ok: false, code: 'BAD_PHONE', message: 'Enter a Ugandan phone number, for example 0772 123 456.' };
    }
    const phone = normalizePhone(input.phone);
    const now = this.clock();
    if ((await this.access.countSince(phone, new Date(now.getTime() - HOUR_MS))) >= MAX_CODES_PER_PHONE_PER_HOUR) {
      return { ok: false, code: 'TOO_MANY_CODES', message: 'We have sent this number several codes in the last hour. Use the latest one, or try again later.' };
    }
    const code = this.crypto.newCode();
    await this.access.create({ phone, codeHash: this.crypto.hashCode(code), expiresAt: new Date(now.getTime() + ACCESS_CODE_TTL_MS) });
    await this.sender.send(phone, code);
    return { ok: true, maskedPhone: maskPhone(phone) };
  }
}

export type VerifyPriceAccessResult =
  | { ok: true; token: string; expiresAt: Date; maskedPhone: string }
  | { ok: false; code: 'BAD_INPUT' | 'NO_CODE' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'WRONG_CODE'; message: string };

export class VerifyBulkPriceAccessUseCase {
  constructor(
    private readonly access: IBulkPriceAccessRepository,
    private readonly crypto: PriceAccessCrypto,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: { phone: unknown; code: unknown }): Promise<VerifyPriceAccessResult> {
    const typed = typeof input.code === 'string' ? input.code.replace(/\s+/g, '') : '';
    if (!isValidUgandanPhone(input.phone) || !/^\d{6}$/.test(typed)) {
      return { ok: false, code: 'BAD_INPUT', message: 'Type the six-digit code from the SMS.' };
    }
    const phone = normalizePhone(input.phone);
    const now = this.clock();
    const challenge = await this.access.latestOpen(phone);
    // The attempt is counted before the check, so parallel guesses all count.
    const attempts = challenge ? await this.access.recordAttempt(challenge.id) : 0;
    const check = checkChallenge(challenge ? { ...challenge, attempts } : null, this.crypto.hashCode(typed), now);
    if (!check.ok) return { ok: false, code: check.code, message: challengeMessage(check.code) };
    if (!(await this.access.markVerified(challenge!.id, now))) {
      return { ok: false, code: 'NO_CODE', message: challengeMessage('NO_CODE') };
    }
    const issued = issueAccessToken(phone, now, (body) => this.crypto.sign(body));
    return { ok: true, token: issued.token, expiresAt: issued.expiresAt, maskedPhone: maskPhone(phone) };
  }
}

/** Public bulk terms of one product; bulkPriceUgx only for a verified phone. */
export interface PublicBulkTerms {
  productId: string;
  bulkUnit: BulkUnit;
  unitsPerCarton: number | null;
  bulkPriceUgx?: number | null;
}

export interface BulkTermsResult {
  /** Whether the caller proved a phone; prices are included only then. */
  pricesUnlocked: boolean;
  maskedPhone: string | null;
  terms: PublicBulkTerms[];
}

/**
 * The carton size and unit of every product on sale, for anyone; the bulk price
 * per piece only with a valid access token. This is the ONE public read of the
 * dealer price, and it is gated (owner, 2026-10-19).
 */
export class GetBulkTermsUseCase {
  constructor(
    private readonly terms: IBulkTermsRepository,
    private readonly crypto: Pick<PriceAccessCrypto, 'sign'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** The verified phone a token proves, or null. */
  phoneFor(token: unknown): string | null {
    return readAccessToken(token, this.clock(), (body) => this.crypto.sign(body));
  }

  async execute(input: { token?: unknown }): Promise<BulkTermsResult> {
    const phone = this.phoneFor(input.token);
    const rows = await this.terms.findOnSale();
    return {
      pricesUnlocked: phone !== null,
      maskedPhone: phone ? maskPhone(phone) : null,
      terms: rows.map((row) => ({
        productId: row.productId,
        bulkUnit: row.bulkUnit,
        unitsPerCarton: row.unitsPerCarton,
        ...(phone !== null ? { bulkPriceUgx: row.dealerPriceUgx } : {}),
      })),
    };
  }
}

export class ListBulkPriceLeadsUseCase {
  constructor(private readonly access: IBulkPriceAccessRepository, private readonly clock: () => Date = () => new Date()) {}
  execute(): Promise<Array<{ phone: string; verifiedAt: Date }>> {
    return this.access.listVerified({ since: new Date(this.clock().getTime() - 90 * 24 * HOUR_MS), limit: 200 });
  }
}

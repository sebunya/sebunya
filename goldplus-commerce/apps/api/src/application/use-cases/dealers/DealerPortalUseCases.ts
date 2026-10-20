import type { IBulkPriceAccessRepository } from '../../ports/IBulkPriceAccessRepository';
import type { CodeSender, PriceAccessCrypto } from '../quotes/BulkPriceAccessUseCases';
import type { DealerAccountView, IDealerPortalReader } from '../../ports/IDealerPortalReader';
import { ACCESS_CODE_TTL_MS, MAX_CODES_PER_PHONE_PER_HOUR, challengeMessage, checkChallenge, maskPhone } from '../../../domain/quotes/BulkPriceAccess';
import { issueDealerToken, readDealerToken } from '../../../domain/dealers/DealerPortalAccess';
import { isValidUgandanPhone, normalizePhone } from '../../services/validationHelpers';

/**
 * Dealer portal (gap analysis #16). Sign-in is ALWAYS an SMS code (never the bulk gate's no-code first visit),
 * using the same code store, sender and hourly limit, so one phone cannot be texted more often by having two doors.
 */
const HOUR_MS = 60 * 60 * 1000;

export class StartDealerSignInUseCase {
  constructor(private readonly access: IBulkPriceAccessRepository, private readonly sender: CodeSender, private readonly crypto: PriceAccessCrypto, private readonly clock: () => Date = () => new Date()) {}

  async execute(input: { phone: unknown }): Promise<{ ok: true; maskedPhone: string } | { ok: false; code: 'BAD_PHONE' | 'TOO_MANY_CODES'; message: string }> {
    if (!isValidUgandanPhone(input.phone)) return { ok: false, code: 'BAD_PHONE', message: 'Enter a Ugandan phone number, for example 0772 123 456.' };
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

export class VerifyDealerSignInUseCase {
  constructor(private readonly access: IBulkPriceAccessRepository, private readonly crypto: PriceAccessCrypto, private readonly clock: () => Date = () => new Date()) {}

  async execute(input: { phone: unknown; code: unknown }): Promise<{ ok: true; token: string; expiresAt: Date; maskedPhone: string } | { ok: false; code: string; message: string }> {
    const typed = typeof input.code === 'string' ? input.code.replace(/\s+/g, '') : '';
    if (!isValidUgandanPhone(input.phone) || !/^\d{6}$/.test(typed)) return { ok: false, code: 'BAD_INPUT', message: 'Type the six-digit code from the SMS.' };
    const phone = normalizePhone(input.phone);
    const now = this.clock();
    const challenge = await this.access.latestOpen(phone);
    const attempts = challenge ? await this.access.recordAttempt(challenge.id) : 0;
    const check = checkChallenge(challenge ? { ...challenge, attempts } : null, this.crypto.hashCode(typed), now);
    if (!check.ok) return { ok: false, code: check.code, message: challengeMessage(check.code) };
    if (!(await this.access.markVerified(challenge!.id, now))) return { ok: false, code: 'NO_CODE', message: challengeMessage('NO_CODE') };
    const issued = issueDealerToken(phone, now, (b) => this.crypto.sign(b));
    return { ok: true, token: issued.token, expiresAt: issued.expiresAt, maskedPhone: maskPhone(phone) };
  }
}

export class GetDealerAccountUseCase {
  constructor(private readonly reader: IDealerPortalReader, private readonly crypto: PriceAccessCrypto, private readonly clock: () => Date = () => new Date()) {}

  async execute(input: { token: unknown }): Promise<{ ok: true; maskedPhone: string; account: DealerAccountView } | { ok: false }> {
    const phone = readDealerToken(input.token, this.clock(), (b) => this.crypto.sign(b));
    if (!phone) return { ok: false };
    return { ok: true, maskedPhone: maskPhone(phone), account: await this.reader.account(phone) };
  }
}

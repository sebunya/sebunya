import { DrizzleIdentityRepository } from '../../../infrastructure/db/repositories/DrizzleIdentityRepository';
import { piiHasher } from '../../../infrastructure/security/PiiHashingService';

const identityRepo = new DrizzleIdentityRepository();

export interface StitchBrowserIdentityInput {
  fp_client_id: string;
  user_id?: string;
  email?: string;
  phone?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  fbc?: string;
  fbp?: string;
  ttclid?: string;
  twclid?: string;
  li_fat_id?: string;
  epik?: string;
}

export class StitchBrowserIdentityUseCase {
  async execute(body: StitchBrowserIdentityInput, realIp: string, realUa: string): Promise<void> {
    const fpClientId = body.fp_client_id;
    let hashedEmail: string | undefined;
    let hashedPhone: string | undefined;

    if (typeof body.email === 'string' && body.email.includes('@')) {
      try {
        hashedEmail = piiHasher.hashEmailStandard(body.email);
      } catch {
        /* invalid email */
      }
    }
    if (typeof body.phone === 'string' && body.phone.length >= 7) {
      try {
        hashedPhone = piiHasher.hashPhoneStandard(body.phone);
      } catch {
        /* invalid phone */
      }
    }

    await identityRepo.upsertByFpClientId(fpClientId, {
      fpClientId,
      userId:      typeof body.user_id === 'string' ? body.user_id : undefined,
      gclid:       body.gclid,
      wbraid:      body.wbraid,
      gbraid:      body.gbraid,
      fbc:         body.fbc,
      fbp:         body.fbp,
      ttclid:      body.ttclid,
      twclid:      body.twclid,
      li_fat_id:   body.li_fat_id,
      epik:        body.epik,
      hashedEmail,
      hashedPhone,
      ipAddress:   realIp,
      userAgent:   realUa,
    });
  }
}

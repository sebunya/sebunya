import type { AstroCookies } from 'astro';
import { accountCartNeed, resolveCartCredential, type ResolvedCart } from './cartCredential';
import { cartClient } from './cartClient';
import { SESSION_COOKIE, checkCustomerSession } from './customerAuth';

/**
 * Who is signing this document request, and which basket credential it carries.
 * The middleware runs this once per document; pages reuse the answer.
 *
 * - USER: the credential names the customer's ACCOUNT basket. When one has to be
 *   minted (sign-in, new device, lapsed credential) the API is asked first, and it
 *   merges the guest basket the customer arrived with into that account basket.
 * - GUEST: a guest credential, reused or minted.
 * - UNKNOWN (the session check timed out or failed): whatever credential verifies is
 *   reused and nothing is minted or overwritten; `gpUserId` stays undefined so pages
 *   that need the answer ask again (requestSession).
 */
export interface RequestIdentity {
  gpUserId: string | null | undefined;
  gpSessionUnknown: boolean;
  gpCart: ResolvedCart | null;
}

export async function resolveRequestIdentity(
  cookies: AstroCookies,
  deps: {
    check?: typeof checkCustomerSession;
    accountCart?: typeof cartClient.accountCart;
  } = {},
): Promise<RequestIdentity> {
  const session = await (deps.check ?? checkCustomerSession)(cookies);

  if (session.state === 'UNKNOWN') {
    return {
      gpUserId: undefined,
      gpSessionUnknown: true,
      gpCart: resolveCartCredential(cookies, null, { sessionUnknown: true }),
    };
  }

  if (session.state === 'GUEST') {
    return { gpUserId: null, gpSessionUnknown: false, gpCart: resolveCartCredential(cookies, null) };
  }

  const userId = session.customer.userId;
  let accountCartId: string | null = null;
  const need = accountCartNeed(cookies, userId);
  if (need) {
    const token = cookies.get(SESSION_COOKIE)?.value;
    if (token) accountCartId = await (deps.accountCart ?? cartClient.accountCart)(token, need.guestToken);
  }
  return {
    gpUserId: userId,
    gpSessionUnknown: false,
    gpCart: resolveCartCredential(cookies, userId, { cartId: accountCartId }),
  };
}

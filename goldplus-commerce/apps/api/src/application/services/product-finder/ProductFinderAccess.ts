import { createHash } from "node:crypto";
import {
  ProductFinderPrincipal,
  ProductFinderSession,
} from "../../ports/product-finder/ProductFinderRepository";

export const productFinderAnonymousId = (accessToken: string) =>
  `anon_${createHash("sha256").update(accessToken).digest("hex")}`;

export function canAccessProductFinderSession(
  session: ProductFinderSession,
  principal: ProductFinderPrincipal,
): boolean {
  if (session.userId)
    return Boolean(principal.userId && principal.userId === session.userId);
  return Boolean(
    principal.accessToken &&
    session.anonymousId === productFinderAnonymousId(principal.accessToken),
  );
}

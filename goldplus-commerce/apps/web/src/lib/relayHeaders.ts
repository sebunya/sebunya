import { readClientAddress } from './forwardClient';

/**
 * Headers the same-origin telemetry relays (rec, hero, nav) add on the server
 * hop: the visit token the middleware has already verified (locals.gpVisit,
 * signed tokens only) and the visitor's address, read through
 * readClientAddress so a throwing clientAddress getter degrades instead of
 * failing the relay with a 500.
 */
export function relayHeaders(
  context: { locals: { gpVisit?: string }; clientAddress?: string },
  base: Record<string, string>,
): Record<string, string> {
  const headers = { ...base };
  const visit = context.locals?.gpVisit;
  if (visit) headers['x-gp-visit'] = visit;
  const address = readClientAddress(context);
  if (address) headers['X-Forwarded-For'] = address;
  return headers;
}

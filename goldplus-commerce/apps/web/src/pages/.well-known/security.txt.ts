import type { APIRoute } from 'astro';
import { getBusinessInfo } from '../../lib/businessInfo';
import { SITE_ORIGIN } from '../../lib/sitemap';

/**
 * /.well-known/security.txt (RFC 9116) — how to report a security problem.
 * Contacts are the shop's own published channels; Expires rolls forward a year
 * from each request so the file never goes stale.
 */
export const GET: APIRoute = async () => {
  const biz = await getBusinessInfo();
  const expires = new Date(Date.now() + 365 * 864e5);
  expires.setUTCHours(0, 0, 0, 0);
  const tel = biz.phoneDial ? `tel:${biz.phoneDial.replace(/[^+\d]/g, '')}` : null;
  const body = [
    `Contact: ${SITE_ORIGIN}/support`,
    ...(biz.whatsappUrl ? [`Contact: ${biz.whatsappUrl}`] : []),
    ...(tel ? [`Contact: ${tel}`] : []),
    `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
    'Preferred-Languages: en',
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
};

import type { APIRoute } from 'astro';
import { checkRequestOrigin } from '../lib/requestOrigin';
import { forgetGuestMemoryHeaders } from '../lib/guestMemory';

/**
 * "Not you? Clear these details." Removes the guest memory (name, phone, email, area
 * from the last checkout on this device) so the next person on a shared phone or
 * cyber-café PC does not see them filled in. POST only, from our own pages, then
 * back to the page the shopper was on.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>).allowed) {
    return new Response('Forbidden', { status: 403 });
  }
  let back = '/';
  try {
    const form = await request.formData();
    const b = String(form.get('back') ?? '');
    // Only a path on this site: never an absolute or protocol-relative URL.
    if (/^\/(?!\/)[\w\-./?=&%#]*$/.test(b)) back = b;
  } catch { /* default */ }
  const headers = new Headers({ Location: back, 'Cache-Control': 'no-store' });
  for (const c of forgetGuestMemoryHeaders()) headers.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers });
};

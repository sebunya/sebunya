import type { APIRoute } from 'astro';
import { forgetChosenPlace, placeFromPayload, safeBackPath, writeChosenPlace } from '../lib/deliveryPlace';

/**
 * Saves the customer's "Deliver to" area (the picker's payload, area only) and returns them to the page they were
 * on, now priced for that area. A plain form POST: it works without JavaScript.
 */
export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  const form = await request.formData().catch(() => null);
  const back = safeBackPath(form?.get('back'));
  if (form?.get('action') === 'forget') {
    forgetChosenPlace(cookies);
    return redirect(back, 303);
  }
  const place = placeFromPayload(String(form?.get('locationJson') ?? ''), 'chosen');
  if (place) writeChosenPlace(cookies, place, url.protocol === 'https:');
  return redirect(back, 303);
};

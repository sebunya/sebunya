import type { APIRoute } from 'astro';
import { forgetChosenPlace, placeFromPayload, safeBackPath, writeChosenPlace } from '../lib/deliveryPlace';
import { sendLocationSignal } from '../lib/locationSignals';

/**
 * Saves the customer's "Deliver to" area (the picker's payload, area only) and returns them to the page they were
 * on, now priced for that area. A plain form POST: it works without JavaScript.
 */
export const POST: APIRoute = async ({ request, cookies, redirect, url, locals }) => {
  const form = await request.formData().catch(() => null);
  const back = safeBackPath(form?.get('back'));
  if (form?.get('action') === 'forget') {
    forgetChosenPlace(cookies);
    return redirect(back, 303);
  }
  const place = placeFromPayload(String(form?.get('locationJson') ?? ''), 'chosen');
  if (place) {
    writeChosenPlace(cookies, place, url.protocol === 'https:');
    // Kept on the visitor's profile too (0193), so a signed-in customer's other devices know it.
    const surface = form?.get('surface') === 'cart' ? 'cart' : 'pdp';
    await sendLocationSignal({ kind: 'deliver_to_set', surface, areaSlug: place.areaSlug, district: place.district, label: place.label }, (locals as { gpVisit?: string }).gpVisit, request);
  }
  return redirect(back, 303);
};

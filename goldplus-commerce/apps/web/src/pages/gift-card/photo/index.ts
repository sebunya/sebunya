import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { readBytesCapped } from '../../../lib/boundedBody';

/**
 * 0201: same-origin relay for the buyer's gift card photo. The phone has already cropped it to a square of at most
 * 1080 px, so a real upload is a few hundred KB; the API re-encodes it and strips its metadata.
 */
const MAX_BYTES = 6 * 1024 * 1024;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  if (!/^image\//.test(request.headers.get('content-type') ?? '')) return json({ success: false, error: { code: 'NOT_A_PHOTO', message: 'Choose a photo.' } }, 415);
  const read = await readBytesCapped(request, MAX_BYTES);
  if (!read.ok) return json({ success: false, error: { code: 'TOO_LARGE', message: 'Choose a photo smaller than 6 MB.' } }, 413);
  try {
    const upstream = await fetch(`${apiBase}/commerce/gift-cards/photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(request.headers.get('x-forwarded-for') ? { 'x-forwarded-for': request.headers.get('x-forwarded-for') as string } : {}),
      },
      body: read.bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return json({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not add the photo just now. Try again, or send the card without one.' } }, 502);
  }
};

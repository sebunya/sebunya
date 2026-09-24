import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/**
 * Admin upload body cap (2026-09-24).
 *
 * Every multipart admin route used parseBody({ all: true }), which buffers the
 * WHOLE request before a single file is checked, then copied each file again
 * into a Buffer. The API runs in 512 MB (--max-old-space-size=400) and also
 * serves checkout and the PesaPal IPN; a 300 MB drop of phone photos was
 * measured at ~960 MB RSS — an OOM kill for every in-flight order. The cap is
 * enforced WHILE the body streams in, so an oversized request is refused
 * before it is held. Requests under the cap behave exactly as before.
 */
export const ADMIN_UPLOAD_MAX_BYTES = 60 * 1024 * 1024;

export const ADMIN_UPLOAD_TOO_LARGE_MESSAGE = 'This upload is larger than 60 MB. Send the photos in smaller batches.';

const tooLarge = (c: Context) =>
  c.json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: ADMIN_UPLOAD_TOO_LARGE_MESSAGE } }, 413);

export const adminUploadLimit = bodyLimit({ maxSize: ADMIN_UPLOAD_MAX_BYTES, onError: tooLarge });

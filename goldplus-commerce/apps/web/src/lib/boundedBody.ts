/**
 * Reading a public request body without trusting what it declares.
 *
 * The relays used to refuse a DECLARED Content-Length over their cap and then
 * call request.text(). A chunked upload (or HTTP/2 without a length) declares
 * nothing, Number(null) is 0, so the check passed and the whole body — tens of
 * megabytes — was buffered into this SSR process before the byte check ran. A
 * handful of those in parallel could take the 512 MB web container down.
 *
 * This reads the stream and stops the moment the running byte count passes the
 * cap, whatever the headers say. A declared length over the cap is refused
 * before a single byte is read.
 */
export type BoundedBody = { ok: true; text: string } | { ok: false; reason: 'TOO_LARGE' };

export async function readBodyCapped(request: Request, maxBytes: number): Promise<BoundedBody> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      break;
    }
    if (chunk.done || !chunk.value) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: 'TOO_LARGE' };
    }
    parts.push(chunk.value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(joined) };
}

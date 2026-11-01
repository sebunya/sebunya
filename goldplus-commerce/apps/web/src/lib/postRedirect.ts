/**
 * Post/Redirect/Get for admin pages whose POST actions used to render their
 * result directly: a refresh (or the browser's "resubmit?" prompt) re-sent the
 * action — a second coupon batch, a second SMS to the asker, a second grant.
 * The result now rides the redirect as two short query parameters and the GET
 * shows it once.
 */
export type FlashNotice = { kind: 'success' | 'error'; text: string };

const KIND = 'notice_kind';
const TEXT = 'notice';
const MAX_TEXT = 400;

/** The same page (path + its query, minus any old notice) carrying this notice. */
export function redirectWithNotice(current: URL, notice: FlashNotice, hash = ''): string {
  const q = new URLSearchParams(current.search);
  q.delete(KIND);
  q.delete(TEXT);
  q.set(KIND, notice.kind);
  q.set(TEXT, notice.text.slice(0, MAX_TEXT));
  return `${current.pathname}?${q.toString()}${hash}`;
}

/** The notice a redirect carried, or null. Rendered as text, never HTML. */
export function readNotice(url: URL): FlashNotice | null {
  const kind = url.searchParams.get(KIND);
  const text = url.searchParams.get(TEXT);
  if ((kind !== 'success' && kind !== 'error') || !text) return null;
  return { kind, text: text.slice(0, MAX_TEXT) };
}

import { flushTelemetry, getFpClientId, isOwnAutomation, telemetryBatchUrl, track } from './telemetry';
import { newWhatsAppRef, tagWhatsAppHref } from './whatsappRef';
import { isWhatsAppChatWithUs } from './leadSignalRules';

/**
 * Taps on WhatsApp chat links. Registered ONLY by the pages that render a
 * WhatsApp chat call to action (product page, bulk request sent) — never from
 * BaseLayout, the header or lib/telemetry, so the home page and every other
 * page carry none of it. A tap on the header's WhatsApp link on another page is
 * therefore not counted as a lead (a deliberate trade for page weight).
 * ONE click listener does both jobs:
 *
 *  - Click-to-chat reference (attribution module, 0156): a tap on one of our
 *    WhatsApp links adds a visible "Ref GP-XXXXXX" line to the prefilled
 *    message and files which visitor that code was given to, so staff can link
 *    a sale closed in the chat back to the visits that led to it. Only chats
 *    with a number (ours); a share link (wa.me/?text=) goes to anyone and is
 *    left alone. Automation is not a shopper.
 *  - Lead signal (advertising 0154): opening a WhatsApp chat WITH US is a
 *    lead, sent like add_to_cart (beacon → our API → GA4 generate_lead and,
 *    where the owner selected it, each ad platform's lead/contact event, with
 *    this event id for deduplication). One lead per link per 30 seconds: a
 *    double tap is one lead.
 */
export const WA_LINK_SELECTOR = 'a[href^="https://wa.me/"], a[href^="https://api.whatsapp.com/send"]';

const lastLeadAt = new Map<string, number>();

function lead(href: string): void {
  if (!isWhatsAppChatWithUs(href)) return;
  const key = href.split('?')[0];
  const now = Date.now();
  if (now - (lastLeadAt.get(key) ?? 0) < 30_000) return;
  lastLeadAt.set(key, now);
  track('generate_lead', { lead: { method: 'whatsapp' } });
  flushTelemetry(); // the chat app may take the page away before the 500 ms batch
}

function tag(a: HTMLAnchorElement): void {
  const tagged = tagWhatsAppHref(a.href, newWhatsAppRef());
  if (!tagged || !tagged.fresh) return;
  a.href = tagged.href; // before the default action: the chat opens with the code in it
  const body = JSON.stringify({
    batchId: crypto.randomUUID(), schemaVersion: 1,
    events: [{ event_name: 'whatsapp_ref', event_id: crypto.randomUUID(), event_time: Math.floor(Date.now() / 1000), source: 'browser',
      user_data: { fp_client_id: getFpClientId() }, ref: { code: tagged.code, page_path: location.pathname.slice(0, 300) } }],
  });
  const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
  if (!(navigator.sendBeacon && navigator.sendBeacon(telemetryBatchUrl(), blob))) {
    fetch(telemetryBatchUrl(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, keepalive: true }).catch(() => {});
  }
}

let installed = false;

/**
 * Installs the listener. `earlyTaps`: chat links tapped before this module had
 * loaded. Their chats already opened without a reference, but each still
 * counts as a lead.
 */
export function installWhatsAppClicks(earlyTaps: string[] = []): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  for (const href of earlyTaps.splice(0)) { try { lead(href); } catch { /* measurement never breaks a page */ } }
  document.addEventListener('click', (e) => {
    try {
      const a = (e.target as Element | null)?.closest?.(WA_LINK_SELECTOR) as HTMLAnchorElement | null;
      if (!a) return;
      if (!isOwnAutomation()) tag(a);
      lead(a.href);
    } catch { /* a chat link must always open */ }
  }, { capture: true });
}

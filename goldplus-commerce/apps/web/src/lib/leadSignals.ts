import { track } from './telemetry';
import { leadAlreadySent } from './leadSignalRules';

/**
 * Quote-request leads (advertising 0154). A confirmation page marks the
 * request it confirms with `data-lead-ref`; this sends ONE generate_lead per
 * reference on this device (a reload or a revisit of the page is not a second
 * lead). Storage off: sent once per page view, never more.
 */
export function recordQuoteLead(): void {
  try {
    const ref = document.querySelector<HTMLElement>('[data-lead-ref]')?.dataset.leadRef ?? '';
    if (!/^[A-Za-z0-9-]{3,40}$/.test(ref)) return;
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    if (leadAlreadySent(ref, storage)) return;
    track('generate_lead', { lead: { method: 'quote_request' } });
  } catch { /* measurement never breaks a page */ }
}

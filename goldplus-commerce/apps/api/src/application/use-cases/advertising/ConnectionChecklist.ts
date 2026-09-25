import type { AdDestinationRow } from '../../ports/Advertising';
import type { CapabilityView } from './AdCapabilities';

/**
 * The per-platform connection checklist in /admin/advertising: every field
 * the owner must fill in, where to find it in the platform's own screens, and
 * the live status of each piece, read from real state (ad_destinations,
 * ad_destination_capabilities, the public catalogue). Nothing here is assumed:
 * a step is done only when the stored value passes validation.
 */

export type ChecklistStatus = 'NOT_CONFIGURED' | 'READY_OFF' | 'TEST' | 'LIVE' | 'READY' | 'NOT_AVAILABLE';

/** `unverifiable`: done inside the platform, where this shop cannot see it (shown as such, never ticked). */
export interface ChecklistStep { label: string; where: string; done: boolean; secret?: boolean; optional?: boolean; unverifiable?: boolean }
export interface ChecklistItem { key: string; title: string; status: ChecklistStatus; detail: string; steps: ChecklistStep[]; url?: string }
export interface PlatformChecklist { platform: string; name: string; status: ChecklistStatus; items: ChecklistItem[] }

export interface DestinationView {
  key: string; name: string; state: string; unavailable?: string; secretLabel: string; secretHint?: string;
  fields: Array<{ key: string; label: string; pattern: RegExp; hint: string; optional?: boolean }>;
  events: Record<string, string>;
  row: AdDestinationRow | null;
  testable?: boolean;
}

/** Exact screens for the conversions fields of the three main platforms (the others use their field hints). */
const WHERE: Record<string, Record<string, string>> = {
  meta: {
    datasetId: 'Meta Events Manager > Data sources > your dataset (pixel) > Settings: the "Dataset ID" under its name.',
    secret: 'Events Manager > the same dataset > Settings > Conversions API > "Generate access token".',
    testEventCode: 'Events Manager > the dataset > Test events > "Test server events": the code (TEST…) shown there. Only needed while in Test mode.',
  },
  tiktok: {
    pixelCode: 'TikTok Ads Manager > Tools > Events > Web events > Manage > your pixel: the code under its name.',
    secret: 'The same pixel > Settings > Events API > "Generate access token".',
    testEventCode: 'The pixel > Test events: the test event code. Only needed while in Test mode.',
  },
  google_ads: {
    customerId: 'Google Ads, top right: the 10-digit customer ID (enter without dashes).',
    conversionActionId: 'Goals > Conversions > Summary > New conversion action > Import > "CRM, files or other data sources" > "Track conversions from clicks". Open it: the number after ctId= in the address bar.',
    loginCustomerId: 'Only when access is through a manager account (MCC): that account\'s 10-digit ID.',
    apiVersion: 'Google Ads API release notes (developers.google.com/google-ads/api/docs/release-notes): the newest version, e.g. v25.',
    secret: 'developerToken: manager account > Tools > API Center. clientId / clientSecret: Google Cloud console > APIs & Services > Credentials > Create OAuth client ID (enable the Google Ads API first). refreshToken: one OAuth consent with the scope https://www.googleapis.com/auth/adwords for the Google account that can open the ads account.',
  },
};

const STATE_OF_DEST: Record<string, ChecklistStatus> = { LIVE: 'LIVE', TEST: 'TEST', READY_OFF: 'READY_OFF', NOT_CONFIGURED: 'NOT_CONFIGURED', NOT_AVAILABLE: 'NOT_AVAILABLE' };

export function buildChecklist(input: {
  destinations: DestinationView[];
  capabilities: CapabilityView[];
  /** null = the catalogue could not be read (never shown as zero). */
  feedProducts: number | null;
  feedUrls: { google: string; meta: string; tiktok: string };
}): PlatformChecklist[] {
  return input.destinations.map((d) => {
    const items: ChecklistItem[] = [];
    const where = WHERE[d.key] ?? {};
    if (d.unavailable) {
      items.push({ key: 'conversions', title: 'Conversions', status: 'NOT_AVAILABLE', detail: d.unavailable, steps: [] });
      return { platform: d.key, name: d.name, status: 'NOT_AVAILABLE', items };
    }
    const cfg = d.row?.config ?? {};
    const steps: ChecklistStep[] = d.fields.filter((f) => f.key !== 'testEventCode').map((f) => ({
      label: f.label, where: where[f.key] ?? f.hint, optional: !!f.optional, done: f.optional ? !cfg[f.key] || f.pattern.test(cfg[f.key]) : f.pattern.test(cfg[f.key] ?? ''),
    }));
    if (d.secretLabel) steps.push({ label: d.secretLabel, where: where.secret ?? (d.secretHint ? `Format: ${d.secretHint}` : 'From the platform\'s conversions settings.'), secret: true, done: !!d.row?.hasSecret });
    steps.push({ label: 'Switched on', where: 'Below, in this platform\'s card: "Save and switch on".', done: !!d.row?.enabled });
    const state = STATE_OF_DEST[d.state] ?? 'NOT_CONFIGURED';
    items.push({ key: 'conversions', title: 'Conversions (server-side)', status: state, detail: Object.entries(d.events).map(([k, v]) => `${k} → ${v}`).join(' · '), steps });
    if (d.testable) {
      items.push({ key: 'test', title: 'Test mode', status: d.row?.enabled && d.row?.mode === 'test' ? 'TEST' : 'READY_OFF',
        detail: d.key === 'google_ads' ? 'Test sends with validateOnly: Google checks each upload and records nothing.' : 'Test sends carry the test event code: the platform shows them under Test events and does not count them.',
        steps: d.key === 'google_ads' ? [] : [{ label: 'Test event code', where: where.testEventCode ?? 'The platform\'s Test events screen.', done: !!cfg.testEventCode, optional: true }] });
    }
    const early = Object.keys(d.events).filter((e) => e !== 'purchase');
    if (early.length) {
      const sel = d.row?.eventSelection ?? null;
      items.push({ key: 'early_signals', title: 'Optimisation events', status: state === 'LIVE' || state === 'TEST' ? state : 'READY_OFF',
        detail: sel == null ? `All supported: ${early.join(', ')}` : sel.length ? `Selected: ${sel.join(', ')}` : 'None selected: only purchases are sent.', steps: [] });
    }
    if (d.key === 'meta' || d.key === 'tiktok' || d.key === 'google_ads') {
      const url = d.key === 'meta' ? input.feedUrls.meta : d.key === 'tiktok' ? input.feedUrls.tiktok : input.feedUrls.google;
      const whereFeed = d.key === 'meta'
        ? 'Commerce Manager > Catalogue > Data sources > Add items > Data feed > "Use a URL" (scheduled feed): paste this URL, repeat daily, currency UGX.'
        : d.key === 'tiktok'
          ? 'TikTok Ads Manager > Assets > Catalogs > create or open a catalogue > Add products > Data feed: paste this URL and choose a daily schedule.'
          : 'Merchant Center > Products > Data sources > Add product source > "Add products from a file" > enter a link: paste this URL, daily.';
      const n = input.feedProducts;
      items.push({ key: 'catalogue', title: 'Product catalogue feed', status: n !== null && n > 0 ? 'READY' : 'NOT_CONFIGURED',
        detail: n === null ? 'The catalogue could not be read just now.' : n > 0 ? `${n} products qualify (same rules as the Google feed). Whether the platform fetches it is set in the platform.` : 'No product qualifies yet (see Product Feeds for the reasons).',
        url, steps: [{ label: 'Scheduled feed URL', where: whereFeed, done: false, unverifiable: true }] });
    }
    for (const cap of input.capabilities.filter((c) => c.platform === d.key)) {
      const ccfg = cap.row?.config ?? {};
      const cSteps: ChecklistStep[] = cap.fields.map((f) => ({ label: f.label, where: f.where, optional: !!f.optional, done: f.optional ? !ccfg[f.key] || f.pattern.test(ccfg[f.key]) : f.pattern.test(ccfg[f.key] ?? '') }));
      if (cap.secretLabel) cSteps.push({ label: cap.secretLabel, where: cap.secretWhere ?? '', secret: true, optional: !!cap.secretOptional, done: !!cap.row?.hasSecret });
      if (cap.requiresDestination) cSteps.push({ label: 'Conversions settings complete', where: 'The conversions steps above (ids and token).', done: state !== 'NOT_CONFIGURED' });
      cSteps.push({ label: 'Switched on', where: 'The capability\'s own form (Audiences, Spend or Offline sales page).', done: !!cap.row?.enabled });
      items.push({ key: cap.capability, title: cap.name, status: cap.state, detail: cap.gap ? `Not configured: ${cap.gap}.` : cap.what, steps: cSteps });
    }
    return { platform: d.key, name: d.name, status: state, items };
  });
}

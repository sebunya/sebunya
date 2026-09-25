/**
 * View helpers for /admin/measurement/channel-report. The model list mirrors
 * REPORT_MODELS / MODEL_LABELS in apps/api/src/domain/measurement/ChannelReport.ts
 * (tests/unit/ChannelAttribution.test.ts holds the two together).
 */
export const CHANNEL_REPORT_MODELS: ReadonlyArray<{ value: string; label: string; help: string }> = [
  { value: 'last_click', label: 'Last click', help: 'All credit to the last recorded source before the order.' },
  { value: 'first_touch', label: 'First touch', help: 'All credit to the first recorded source in the 30 days before the order.' },
  { value: 'linear', label: 'Linear', help: 'Credit shared equally across the recorded sources.' },
  { value: 'time_decay', label: 'Time decay', help: 'Recent sources count more; weight halves every 7 days.' },
  { value: 'position_based', label: 'Position-based', help: '40% first, 40% last, 20% shared by the middle.' },
  { value: 'self_reported', label: 'Customer said', help: 'Only what the customer (or staff for them) answered to "How did you hear about us?".' },
];

/**
 * Polyline points for a small trend line, or null when every value is zero (a
 * flat line at the bottom would read as a measured zero trend; the page says
 * "No revenue" instead).
 */
export function sparklinePoints(values: number[], width: number, height: number): string | null {
  if (!values.length || values.every((v) => !(v > 0))) return null;
  const max = Math.max(...values.map((v) => (v > 0 ? v : 0)));
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 2;
  return values
    .map((v, i) => {
      const x = values.length > 1 ? i * step : width / 2;
      const y = height - pad - ((v > 0 ? v : 0) / max) * (height - pad * 2);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}

/** "22 Sep 2026" for a week-start date (YYYY-MM-DD). */
export function weekLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Credited orders: whole numbers stay whole; a shared sale shows one decimal. */
export function formatOrders(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

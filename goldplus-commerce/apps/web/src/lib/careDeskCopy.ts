/** Plain words for the Care Desk (shop attendants and the care team). */
export const KIND: Record<string, { label: string; tone: string }> = {
  urgent: { label: 'Urgent', tone: 'bg-red-600 text-white' },
  callback: { label: 'Call back', tone: 'bg-amber-100 text-amber-900' },
  order_problem: { label: 'Order problem', tone: 'bg-orange-100 text-orange-900' },
  order_change: { label: 'Approve a change', tone: 'bg-indigo-100 text-indigo-900' },
  bulk_lead: { label: 'Bulk buyer', tone: 'bg-lime-100 text-lime-900' },
  follow_up: { label: 'Follow up', tone: 'bg-sky-100 text-sky-900' },
};
export const CHANGE: Record<string, string> = { cancel: 'Cancel the order', delivery_address: 'Change the delivery address', delivery_time: 'Change the delivery time', items: 'Change the items', other: 'Change the order' };

/** "5 min ago", "2 h ago", "yesterday": how long the customer has waited. */
export function waited(iso: string, now: Date = new Date()): string {
  const m = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return h < 48 ? 'yesterday' : `${Math.round(h / 24)} days ago`;
}

/** A Ugandan number in the form wa.me and tel: links want. */
export const intl = (phone: string | null | undefined) => { const d = String(phone ?? '').replace(/\D/g, ''); return d.startsWith('0') ? `256${d.slice(1)}` : d; };

export function greeting(now: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

import type { AvailabilityRow, IInventoryRepository } from '../../ports/IInventoryRepository';
import type { OpenTaskInput } from '../assistant/CareDeskUseCases';

/** Fewer days of stock than this, at the last 30 days' pace, counts as running out. */
export const LOW_STOCK_COVER_DAYS = 7;
export const LOW_STOCK_TITLE = 'Reorder stock:';

const kampalaDay = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const kampalaHour = (d: Date) => (d.getUTCHours() + 3) % 24;

/** One line per product, plain words for whoever does the buying. */
export function lowStockLine(r: AvailabilityRow): string {
  const left = r.available <= 0 ? 'OUT OF STOCK' : `${r.available} left`;
  const pace = r.unitsSold30d ? `, sold ${r.unitsSold30d} in 30 days${r.daysOfCover != null && r.available > 0 ? ` (about ${Math.max(1, Math.floor(r.daysOfCover))} days left)` : ''}` : '';
  const point = r.reorderPoint > 0 ? `, reorder point ${r.reorderPoint}` : '';
  return `${r.sku} ${r.name}: ${left}${pace}${point}`;
}

/**
 * The daily stock alert (2026-10-31). Before this the low-stock list existed only on the admin inventory page, so
 * the shop found out it was out of a product when a customer did. Once a Kampala day, during working hours, the
 * products that need reordering go to the Care Desk as one task; the team's alert phones and inboxes hear about it
 * the way they hear about any urgent task when a selling product is out or within 3 days of it.
 *
 * One task at a time: while the last one is open nothing new is opened (it is the list to work from), and a closed
 * one is replaced at most once a day.
 */
export class LowStockAlertUseCase {
  constructor(
    private readonly inventory: Pick<IInventoryRepository, 'listRunningOut'>,
    private readonly care: {
      lastTitled(prefix: string): Promise<{ status: string; createdAt: Date } | null>;
      openTask(input: OpenTaskInput): Promise<unknown>;
    },
  ) {}

  async execute(now = new Date()): Promise<{ status: 'OUTSIDE_HOURS' | 'NOTHING_LOW' | 'ALREADY_OPEN' | 'ALREADY_TODAY' | 'OPENED'; items: number }> {
    const hour = kampalaHour(now);
    if (hour < 8 || hour >= 18) return { status: 'OUTSIDE_HOURS', items: 0 };
    const last = await this.care.lastTitled(LOW_STOCK_TITLE);
    if (last?.status === 'open') return { status: 'ALREADY_OPEN', items: 0 };
    if (last && kampalaDay(last.createdAt) === kampalaDay(now)) return { status: 'ALREADY_TODAY', items: 0 };
    const rows = await this.inventory.listRunningOut(LOW_STOCK_COVER_DAYS, 60);
    if (rows.length === 0) return { status: 'NOTHING_LOW', items: 0 };
    const out = rows.filter((r) => r.available <= 0).length;
    await this.care.openTask({
      kind: 'follow_up',
      title: `${LOW_STOCK_TITLE} ${rows.length} product${rows.length === 1 ? '' : 's'}${out ? `, ${out} already out` : ''} (${kampalaDay(now)})`,
      detail: [
        `Products that are out, at their reorder point, or will run out within ${LOW_STOCK_COVER_DAYS} days at the last 30 days' pace:`,
        ...rows.map(lowStockLine),
        'Update stock on Admin > Inventory once it arrives, then close this task.',
      ].join('\n').slice(0, 4000),
      // Only urgent tasks page people (CareDesk.shouldAlert): a seller already out, or out within 3 days, pages; a
      // slower list waits on the desk.
      urgent: rows.some((r) => (r.unitsSold30d ?? 0) > 0 && (r.available <= 0 || (r.daysOfCover != null && r.daysOfCover <= 3))),
      openedBy: 'stock-check',
    });
    return { status: 'OPENED', items: rows.length };
  }
}

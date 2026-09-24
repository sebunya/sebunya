import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import { quoteRequestLines, quoteRequests } from '../schema/governance';
import type {
  CreateBulkQuoteOutcome,
  IBulkQuoteRepository,
  NewBulkQuoteRecord,
  QuoteRequestView,
} from '../../../application/ports/IBulkQuoteRepository';
import {
  totalsOf,
  type BulkQuoteLine,
  type LineAvailability,
  type QuoteRequestStatus,
} from '../../../domain/quotes/BulkQuoteRequest';

type HeaderRow = typeof quoteRequests.$inferSelect;
type LineRow = typeof quoteRequestLines.$inferSelect;

/** Postgres unique_violation, however the driver or Drizzle wraps it. */
function uniqueViolation(err: unknown): { constraint: string } | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth++) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (e.code === '23505') {
      const constraint = String(e.constraint_name ?? e.constraint ?? e.message ?? '');
      return { constraint };
    }
    current = e.cause;
  }
  return null;
}

function availabilityOf(value: string): LineAvailability {
  return value === 'in_stock' || value === 'out_of_stock' || value === 'pre_order' ? value : 'unknown';
}

function toLine(row: LineRow): BulkQuoteLine {
  return {
    lineNo: row.lineNo,
    productId: row.productId,
    productCode: row.productCode,
    productName: row.productName,
    quantity: row.quantity,
    unitPriceUgx: row.unitPriceUgx === null ? null : Number(row.unitPriceUgx),
    lineTotalUgx: row.lineTotalUgx === null ? null : Number(row.lineTotalUgx),
    availability: availabilityOf(row.availability),
  };
}

function toView(header: HeaderRow, lines: LineRow[]): QuoteRequestView {
  const mapped = lines.sort((a, b) => a.lineNo - b.lineNo).map(toLine);
  const computed = totalsOf(mapped);
  return {
    id: header.id,
    reference: header.reference,
    source: header.source === 'bulk_builder' ? 'bulk_builder' : 'form',
    status: header.status,
    customerName: header.customerName,
    businessName: header.businessName,
    phone: header.phone,
    email: header.email,
    buyerType: header.buyerType,
    deliveryDistrict: header.deliveryDistrict,
    neededBy: header.neededBy,
    notes: header.message ?? '',
    productName: header.productName,
    quantity: header.quantity,
    requestFingerprint: header.requestFingerprint,
    lines: mapped,
    // Recomputed from the lines, which are the record; the header copy is for SQL reporting.
    totals: mapped.length > 0 ? computed : { lineCount: 0, totalUnits: 0, estimatedTotalUgx: 0, pricedLineCount: 0 },
    createdAt: header.createdAt,
    updatedAt: header.updatedAt ?? null,
  };
}

export class DrizzleBulkQuoteRepository implements IBulkQuoteRepository {
  async create(record: NewBulkQuoteRecord): Promise<CreateBulkQuoteOutcome> {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(quoteRequests).values({
          id: record.id,
          customerName: record.customerName,
          email: record.email,
          phone: record.phone,
          productName: record.productName,
          quantity: record.quantity,
          message: record.notes,
          status: 'new',
          createdAt: record.createdAt,
          reference: record.reference,
          idempotencyKey: record.idempotencyKey,
          requestFingerprint: record.requestFingerprint,
          source: 'bulk_builder',
          buyerType: record.buyerType,
          businessName: record.businessName,
          deliveryDistrict: record.deliveryDistrict,
          neededBy: record.neededBy,
          lineCount: record.totals.lineCount,
          totalUnits: record.totals.totalUnits,
          estimatedTotalUgx: record.totals.estimatedTotalUgx,
          pricedLineCount: record.totals.pricedLineCount,
        });
        await tx.insert(quoteRequestLines).values(
          record.lines.map((line) => ({
            quoteRequestId: record.id,
            lineNo: line.lineNo,
            productId: line.productId,
            productCode: line.productCode,
            productName: line.productName,
            quantity: line.quantity,
            unitPriceUgx: line.unitPriceUgx,
            lineTotalUgx: line.lineTotalUgx,
            availability: line.availability,
            createdAt: record.createdAt,
          })),
        );
      });
      return 'created';
    } catch (err) {
      const clash = uniqueViolation(err);
      if (!clash) throw err;
      if (clash.constraint.includes('idempotency')) return 'duplicate_idempotency_key';
      if (clash.constraint.includes('reference')) return 'duplicate_reference';
      throw err;
    }
  }

  private async withLines(headers: HeaderRow[]): Promise<QuoteRequestView[]> {
    if (headers.length === 0) return [];
    const ids = headers.map((h) => h.id);
    const lines = await db
      .select()
      .from(quoteRequestLines)
      .where(inArray(quoteRequestLines.quoteRequestId, ids))
      .orderBy(asc(quoteRequestLines.lineNo));
    const byRequest = new Map<string, LineRow[]>();
    for (const line of lines) {
      const group = byRequest.get(line.quoteRequestId) ?? [];
      group.push(line);
      byRequest.set(line.quoteRequestId, group);
    }
    return headers.map((h) => toView(h, byRequest.get(h.id) ?? []));
  }

  private async one(where: ReturnType<typeof eq>): Promise<QuoteRequestView | null> {
    const rows = await db.select().from(quoteRequests).where(where).limit(1);
    const [view] = await this.withLines(rows);
    return view ?? null;
  }

  findByIdempotencyKey(key: string): Promise<QuoteRequestView | null> {
    return this.one(eq(quoteRequests.idempotencyKey, key));
  }

  findByReference(reference: string): Promise<QuoteRequestView | null> {
    return this.one(eq(quoteRequests.reference, reference));
  }

  findById(id: string): Promise<QuoteRequestView | null> {
    return this.one(eq(quoteRequests.id, id));
  }

  async list(opts: { limit: number }): Promise<QuoteRequestView[]> {
    const rows = await db
      .select()
      .from(quoteRequests)
      .orderBy(desc(quoteRequests.createdAt), asc(quoteRequests.id))
      .limit(Math.max(1, Math.min(opts.limit, 1000)));
    return this.withLines(rows);
  }

  async updateStatus(id: string, from: string, to: QuoteRequestStatus, at: Date): Promise<boolean> {
    const updated = await db
      .update(quoteRequests)
      .set({ status: to, updatedAt: at })
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.status, from)))
      .returning({ id: quoteRequests.id });
    return updated.length === 1;
  }
}

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { normalizeUgandaDistrict } from '@goldplus/shared';
import type { IProductRepository } from '../../ports/IProductRepository';
import type { IBulkQuoteRepository, QuoteRequestView } from '../../ports/IBulkQuoteRepository';
import type { IBulkTermsRepository } from '../../ports/IBulkTermsRepository';
import { toProductPublicDto } from '../../mappers/toProductPublicDto';
import {
  BULK_BUYER_TYPES,
  MAX_BULK_LINES,
  buyerStatusCopy,
  canTransitionQuoteRequest,
  describeLineCount,
  fingerprintSource,
  isQuoteRequestStatus,
  isValidIdempotencyKey,
  legacySummary,
  makeBulkReference,
  normaliseBulkReference,
  parseBudget,
  parseNeededBy,
  snapshotBulkLines,
  validateBulkLines,
  type BulkBuyerType,
  type BulkQuoteLine,
  type BulkQuoteTotals,
  type BulkUnit,
  type CatalogueEntry,
  type LineAvailability,
  type QuoteRequestStatus,
} from '../../../domain/quotes/BulkQuoteRequest';
import {
  isMaxLength,
  isValidEmail,
  isValidUgandanPhone,
  normalizeEmail,
  normalizePhone,
  text,
} from '../../services/validationHelpers';

/** The acknowledgement path every public form shares (SendPublicFormAcknowledgementUseCase). */
export interface BulkQuoteAcknowledger {
  execute(input: {
    kind: string;
    eventType: string;
    template: string;
    phone: unknown;
    email: unknown;
    data: Record<string, unknown>;
    entityId: string;
    relatedEntity: string;
  }): Promise<unknown>;
}

/**
 * What a buyer may see about their own request. No email, no notes, nothing
 * internal, no stock: bulk is supplied to order. Bulk prices appear only when
 * this request's phone was verified when it was sent (pricesShown); lines from
 * before cartons (priceBasis 'list') carry the public retail price.
 */
export interface BuyerQuoteView {
  reference: string;
  status: string;
  statusLabel: string;
  statusDetail: string;
  createdAt: string;
  businessName: string | null;
  deliveryDistrict: string | null;
  neededBy: string | null;
  budgetUgx: number | null;
  pricesShown: boolean;
  lines: Array<{
    lineNo: number;
    productCode: string | null;
    productName: string;
    unitKind: BulkUnit;
    unitCount: number | null;
    unitsPerCarton: number | null;
    quantity: number | null;
    /** "12 cartons (600 pieces)". */
    countLabel: string;
    aboveSelfServe: boolean;
    unitPriceUgx: number | null;
    lineTotalUgx: number | null;
  }>;
  totals: BulkQuoteTotals;
}

export function toBuyerView(view: QuoteRequestView): BuyerQuoteView {
  const copy = buyerStatusCopy(String(view.status));
  const showPrice = (basis: string) => basis === 'list' || view.pricesShown;
  const anyHidden = view.lines.some((line) => !showPrice(line.priceBasis));
  return {
    reference: view.reference ?? '',
    status: String(view.status),
    statusLabel: copy.label,
    statusDetail: copy.detail,
    createdAt: view.createdAt.toISOString(),
    businessName: view.businessName,
    deliveryDistrict: view.deliveryDistrict,
    neededBy: view.neededBy,
    budgetUgx: view.budgetUgx,
    pricesShown: !anyHidden && view.totals.pricedLineCount > 0,
    lines: view.lines.map((line) => ({
      lineNo: line.lineNo,
      productCode: line.productCode,
      productName: line.productName,
      unitKind: line.unitKind,
      unitCount: line.unitCount,
      unitsPerCarton: line.unitsPerCarton,
      quantity: line.quantity,
      countLabel: describeLineCount(line),
      aboveSelfServe: line.aboveSelfServe,
      unitPriceUgx: showPrice(line.priceBasis) ? line.unitPriceUgx : null,
      lineTotalUgx: showPrice(line.priceBasis) ? line.lineTotalUgx : null,
    })),
    totals: anyHidden ? { ...view.totals, estimatedTotalUgx: 0, pricedLineCount: 0 } : view.totals,
  };
}

function availabilityOf(kind: string | undefined): LineAvailability {
  return kind === 'in_stock' || kind === 'out_of_stock' || kind === 'pre_order' ? kind : 'unknown';
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Kampala is UTC+3 all year; "today" for a needed-by date is the buyer's today. */
const kampalaToday = (now: Date) => new Date(now.getTime() + 3 * 60 * 60 * 1000);

export type SubmitBulkQuoteResult =
  /** contactPhone: the number the team will call, for the submitter's own receipt (it may come from the verified code). */
  | { ok: true; replayed: boolean; quoteId: string; contactPhone: string; request: BuyerQuoteView }
  | { ok: false; code: 'BAD_INPUT' | 'NO_LINES' | 'TOO_MANY_LINES' | 'BAD_LINE'; message: string; field?: string }
  | { ok: false; code: 'PRODUCTS_UNAVAILABLE' | 'COUNT_TOO_LARGE'; message: string; productIds: string[] }
  | { ok: false; code: 'IDEMPOTENCY_CONFLICT'; message: string };

export class SubmitBulkQuoteUseCase {
  constructor(
    private readonly quotes: IBulkQuoteRepository,
    private readonly products: IProductRepository,
    private readonly terms: IBulkTermsRepository,
    private readonly acknowledger: BulkQuoteAcknowledger | null,
    /** The phone a price-access token proves (GetBulkTermsUseCase.phoneFor), or null. */
    private readonly verifiedPhoneFor: (token: unknown) => string | null,
    private readonly clock: () => Date = () => new Date(),
    private readonly randomIndex: (n: number) => number = (n) => randomInt(n),
    private readonly newId: () => string = () => randomUUID(),
  ) {}

  async execute(input: Record<string, unknown>): Promise<SubmitBulkQuoteResult> {
    const bad = (message: string, field?: string): SubmitBulkQuoteResult => ({ ok: false, code: 'BAD_INPUT', message, field });

    const idempotencyKey = input.idempotencyKey;
    if (!isValidIdempotencyKey(idempotencyKey)) return bad('Reload the page and try again.', 'idempotencyKey');

    const customerName = text(input.customerName);
    if (customerName.length < 2) return bad('Your name must be at least 2 characters.', 'customerName');
    if (!isMaxLength(customerName, 100)) return bad('Your name is too long.', 'customerName');

    const businessName = text(input.businessName);
    if (!isMaxLength(businessName, 160)) return bad('Business name is too long.', 'businessName');

    // A buyer who proved their phone with the texted code is not asked for it again.
    const verifiedPhone = this.verifiedPhoneFor(input.priceAccessToken);
    const phoneGiven = text(input.phone) !== '';
    if (phoneGiven && !isValidUgandanPhone(input.phone)) return bad('A valid Ugandan phone number is required.', 'phone');
    if (!phoneGiven && !verifiedPhone) return bad('A valid Ugandan phone number is required.', 'phone');
    const phone = phoneGiven ? normalizePhone(input.phone) : (verifiedPhone as string);

    const email = normalizeEmail(input.email);
    if (email && (!isValidEmail(email) || !isMaxLength(email, 255))) {
      return bad('That email address does not look right. Check it, or leave it blank.', 'email');
    }

    // Not asked on the page any more; a dealer link still says so (?buyer=dealer).
    const buyerTypeRaw = text(input.buyerType) || 'wholesale';
    if (!(BULK_BUYER_TYPES as readonly string[]).includes(buyerTypeRaw)) return bad('Choose what best describes you.', 'buyerType');
    const buyerType = buyerTypeRaw as BulkBuyerType;

    const districtRaw = text(input.deliveryDistrict);
    const deliveryDistrict = districtRaw ? normalizeUgandaDistrict(districtRaw) : null;
    if (districtRaw && !deliveryDistrict) return bad('Choose a district from the list.', 'deliveryDistrict');

    const now = this.clock();
    const neededBy = parseNeededBy(input.neededBy, kampalaToday(now));
    if (neededBy === 'INVALID') return bad('The needed-by date must be today or later, within a year.', 'neededBy');

    const notes = text(input.notes);
    if (!isMaxLength(notes, 2000)) return bad('Notes are limited to 2,000 characters.', 'notes');

    const budgetUgx = parseBudget(input.budgetUgx);
    if (budgetUgx === 'INVALID') return bad('Write the budget in shillings, for example 5,000,000.', 'budgetUgx');

    // A buyer with only a budget sends no products: the team builds the list.
    const validated = validateBulkLines(input.lines, { allowEmpty: budgetUgx !== null });
    if (!validated.ok) return { ok: false, code: validated.code, message: validated.message };
    if (validated.lines.length === 0 && notes.length < 5) {
      return bad('Tell us what you sell or need, so we can build the list for your budget.', 'notes');
    }

    // Prices were shown only if this phone proved itself with the SMS code.
    const pricesShown = verifiedPhone === phone;

    const requestFingerprint = sha256(fingerprintSource(phone, validated.lines, budgetUgx));

    // A retry of a submission that already landed answers with the first result.
    const prior = await this.quotes.findByIdempotencyKey(idempotencyKey);
    if (prior) return this.replay(prior, requestFingerprint);

    // Names, codes, carton sizes and prices come from the server, never the client.
    const ids = validated.lines.map((line) => line.productId);
    const [rows, termRows] = ids.length === 0
      ? [[], []]
      : await Promise.all([
          this.products.findPublicViewList({ ids, limit: MAX_BULK_LINES }),
          this.terms.findOnSale(ids),
        ]);
    const termsById = new Map(termRows.map((t) => [t.productId.toLowerCase(), t]));
    const catalogue: CatalogueEntry[] = rows.flatMap((row) => {
      const dto = toProductPublicDto(row);
      const terms = termsById.get(dto.id.toLowerCase());
      if (!terms) return [];
      return [{
        productId: dto.id,
        name: dto.name,
        code: dto.sku ?? dto.modelNumber ?? null,
        bulkUnit: terms.bulkUnit,
        unitsPerCarton: terms.unitsPerCarton,
        bulkPriceUgx: terms.dealerPriceUgx,
        availability: availabilityOf(dto.availability?.kind),
      }];
    });
    const snapshot = snapshotBulkLines(validated.lines, catalogue);
    if (!snapshot.ok) {
      return snapshot.code === 'PRODUCTS_UNAVAILABLE'
        ? {
            ok: false,
            code: 'PRODUCTS_UNAVAILABLE',
            message: 'Some products in your list are no longer on sale. Remove them and send the list again.',
            productIds: snapshot.productIds,
          }
        : {
            ok: false,
            code: 'COUNT_TOO_LARGE',
            message: 'A line is larger than we can take from this page. Lower it, and tell us the full amount in the notes.',
            productIds: snapshot.productIds,
          };
    }

    const summary = legacySummary(snapshot.lines);
    const id = this.newId();
    let reference = '';
    // A clash on a 31^6 reference space is rare; three tries, then a clean failure.
    for (let attempt = 0; attempt < 3; attempt++) {
      reference = makeBulkReference(this.randomIndex);
      const outcome = await this.quotes.create({
        id,
        reference,
        idempotencyKey,
        requestFingerprint,
        customerName,
        businessName: businessName || null,
        phone,
        email,
        buyerType,
        deliveryDistrict,
        neededBy,
        notes,
        productName: summary.productName,
        quantity: summary.quantity,
        lines: snapshot.lines,
        totals: snapshot.totals,
        budgetUgx,
        pricesShown,
        createdAt: now,
      });
      if (outcome === 'created') {
        await this.acknowledge({ id, reference, customerName, phone, email, lines: snapshot.lines, totals: snapshot.totals });
        return {
          ok: true,
          replayed: false,
          quoteId: id,
          contactPhone: phone,
          request: toBuyerView({
            id,
            reference,
            source: 'bulk_builder',
            status: 'new',
            customerName,
            businessName: businessName || null,
            phone,
            email,
            buyerType,
            deliveryDistrict,
            neededBy,
            notes,
            productName: summary.productName,
            quantity: summary.quantity,
            requestFingerprint,
            lines: snapshot.lines,
            totals: snapshot.totals,
            budgetUgx,
            pricesShown,
            createdAt: now,
            updatedAt: null,
          }),
        };
      }
      if (outcome === 'duplicate_idempotency_key') {
        // Two submissions with one key raced; the other one won.
        const winner = await this.quotes.findByIdempotencyKey(idempotencyKey);
        if (winner) return this.replay(winner, requestFingerprint);
      }
    }
    throw new Error('BULK_QUOTE_REFERENCE_EXHAUSTED');
  }

  private replay(prior: QuoteRequestView, fingerprint: string): SubmitBulkQuoteResult {
    if (prior.requestFingerprint !== fingerprint) {
      return {
        ok: false,
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Your list changed while it was being sent. Check it and send it again.',
      };
    }
    return { ok: true, replayed: true, quoteId: prior.id, contactPhone: prior.phone, request: toBuyerView(prior) };
  }

  private async acknowledge(input: {
    id: string;
    reference: string;
    customerName: string;
    phone: string;
    email: string;
    lines: BulkQuoteLine[];
    totals: BulkQuoteTotals;
  }): Promise<void> {
    if (!this.acknowledger) return;
    // A messaging failure never fails the request: the row is saved and the team sees it.
    await this.acknowledger
      .execute({
        kind: 'quote_request',
        eventType: 'QUOTE_REQUEST_RECEIVED',
        template: 'QUOTE_REQUEST_RECEIVED',
        phone: input.phone,
        email: input.email || null,
        data: {
          customerName: input.customerName,
          reference: input.reference,
          lineCount: input.totals.lineCount,
          totalUnits: input.totals.totalUnits,
        },
        entityId: input.id,
        relatedEntity: 'quote_request',
      })
      .catch(() => undefined);
  }
}

export type LookupBulkQuoteResult =
  | { ok: true; request: BuyerQuoteView }
  | { ok: false; code: 'NOT_FOUND'; message: string };

/**
 * A buyer checks their request with the reference and the phone they gave, the
 * way /track-order works. Every miss is the same answer, so the endpoint never
 * says which references exist.
 */
export class LookupBulkQuoteUseCase {
  constructor(private readonly quotes: IBulkQuoteRepository) {}

  async execute(input: { reference: unknown; phone: unknown }): Promise<LookupBulkQuoteResult> {
    const notFound: LookupBulkQuoteResult = {
      ok: false,
      code: 'NOT_FOUND',
      message: 'We could not find a request with that reference and phone number. Check both and try again.',
    };
    const reference = normaliseBulkReference(input.reference);
    if (!reference || !isValidUgandanPhone(input.phone)) return notFound;
    const phone = normalizePhone(input.phone);
    const found = await this.quotes.findByReference(reference);
    if (!found || normalizePhone(found.phone) !== phone) return notFound;
    return { ok: true, request: toBuyerView(found) };
  }
}

/* ------------------------------------------------------------------------ */
/* Admin                                                                      */
/* ------------------------------------------------------------------------ */

export const ADMIN_QUOTE_LIST_LIMIT = 500;

export class ListQuoteRequestsUseCase {
  constructor(private readonly quotes: IBulkQuoteRepository) {}
  execute(): Promise<QuoteRequestView[]> {
    return this.quotes.list({ limit: ADMIN_QUOTE_LIST_LIMIT });
  }
}

export class GetQuoteRequestUseCase {
  constructor(private readonly quotes: IBulkQuoteRepository) {}
  async execute(id: string): Promise<QuoteRequestView | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return this.quotes.findById(id);
  }
}

export type UpdateQuoteStatusResult =
  | { ok: true; id: string; from: string; to: QuoteRequestStatus }
  | { ok: false; code: 'NOT_FOUND' | 'BAD_STATUS' | 'TRANSITION_BLOCKED' | 'CONFLICT'; message: string };

export class UpdateQuoteRequestStatusUseCase {
  constructor(
    private readonly quotes: IBulkQuoteRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(input: { id: string; status: unknown }): Promise<UpdateQuoteStatusResult> {
    if (!isQuoteRequestStatus(input.status)) {
      return { ok: false, code: 'BAD_STATUS', message: 'Status must be new, quoted, won, lost or expired.' };
    }
    const to = input.status;
    const current = await new GetQuoteRequestUseCase(this.quotes).execute(input.id);
    if (!current) return { ok: false, code: 'NOT_FOUND', message: 'Quote request not found.' };
    const from = String(current.status);
    if (!canTransitionQuoteRequest(from, to)) {
      return { ok: false, code: 'TRANSITION_BLOCKED', message: `A ${from} request cannot become ${to}.` };
    }
    const moved = await this.quotes.updateStatus(current.id, from, to, this.clock());
    if (!moved) return { ok: false, code: 'CONFLICT', message: 'Someone else changed this request. Reload and try again.' };
    return { ok: true, id: current.id, from, to };
  }
}

export const QUOTE_LINES_CSV_HEADER = [
  'reference',
  'submitted_at',
  'status',
  'customer_name',
  'business_name',
  'phone',
  'email',
  'buyer_type',
  'delivery_district',
  'needed_by',
  'budget_ugx',
  'prices_shown_to_buyer',
  'line_no',
  'product_code',
  'product_name',
  'sold_by',
  'count',
  'pieces_per_carton',
  'pieces',
  'above_500_cartons',
  'unit_price_ugx',
  'price_basis',
  'line_total_ugx',
  'in_shop_stock_at_request',
] as const;

/** One row per line of every bulk request (legacy single-product rows have no lines). */
export function quoteLinesCsvRows(views: QuoteRequestView[]): Array<Array<string | number | null>> {
  const rows: Array<Array<string | number | null>> = [];
  for (const view of views) {
    for (const line of view.lines) {
      rows.push([
        view.reference,
        view.createdAt.toISOString(),
        String(view.status),
        view.customerName,
        view.businessName,
        view.phone,
        view.email || null,
        view.buyerType,
        view.deliveryDistrict,
        view.neededBy,
        view.budgetUgx,
        view.pricesShown ? 'yes' : 'no',
        line.lineNo,
        line.productCode,
        line.productName,
        line.unitKind,
        line.unitCount,
        line.unitsPerCarton,
        line.quantity,
        line.aboveSelfServe ? 'yes' : 'no',
        line.unitPriceUgx,
        line.priceBasis,
        line.lineTotalUgx,
        line.availability,
      ]);
    }
  }
  return rows;
}

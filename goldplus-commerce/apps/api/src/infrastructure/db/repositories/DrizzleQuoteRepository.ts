import { db } from '../client';
import { quoteRequests } from '../schema/governance';
import { eq } from 'drizzle-orm';
import { Quote } from '../../../domain/quotes/Quote';

export class DrizzleQuoteRepository {
  async save(quote: Quote): Promise<void> {
    await db.insert(quoteRequests).values({
      id: quote.id,
      customerName: quote.customerName,
      email: quote.email,
      phone: quote.phone,
      productName: quote.productName,
      quantity: quote.quantity.toString(),
      message: quote.message,
      status: quote.status,
      createdAt: quote.createdAt,
    }).onConflictDoUpdate({
      target: quoteRequests.id,
      set: {
        status: quote.status,
      }
    });
  }

  async findById(id: string): Promise<Quote | null> {
    const result = await db.query.quoteRequests.findFirst({
      where: eq(quoteRequests.id, id),
    });

    if (!result) return null;

    return new Quote(
      result.id,
      result.customerName,
      result.email,
      result.phone,
      result.productName,
      parseInt(result.quantity, 10),
      result.message || '',
      result.status as any,
      result.createdAt
    );
  }

  async findAll(): Promise<Quote[]> {
    const results = await db.query.quoteRequests.findMany();
    return results.map(r => new Quote(
      r.id,
      r.customerName,
      r.email,
      r.phone,
      r.productName,
      parseInt(r.quantity, 10),
      r.message || '',
      r.status as any,
      r.createdAt
    ));
  }
}

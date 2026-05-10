import { db } from '../client';
import { dealerApplications } from '../schema/governance';
import { eq } from 'drizzle-orm';
import { Dealer } from '../../../domain/dealers/Dealer';

export class DrizzleDealerRepository {
  async findById(id: string): Promise<Dealer | null> {
    const result = await db.query.dealerApplications.findFirst({
      where: eq(dealerApplications.id, id),
    });

    if (!result) return null;

    return new Dealer(
      result.id,
      result.businessName,
      result.contactName,
      result.email,
      result.phone,
      result.tinNumber,
      result.location,
      result.status as any,
      result.createdAt,
      result.updatedAt || undefined
    );
  }

  async save(dealer: Dealer): Promise<void> {
    await db.insert(dealerApplications).values({
      id: dealer.id,
      businessName: dealer.businessName,
      contactName: dealer.contactName,
      email: dealer.email,
      phone: dealer.phone,
      tinNumber: dealer.tinNumber,
      location: dealer.location,
      status: dealer.status,
      createdAt: dealer.appliedAt,
      updatedAt: dealer.approvedAt || new Date(),
    }).onConflictDoUpdate({
      target: dealerApplications.id,
      set: {
        status: dealer.status,
        updatedAt: dealer.approvedAt || new Date(),
      }
    });
  }

  async findAll(): Promise<Dealer[]> {
    const results = await db.query.dealerApplications.findMany();
    return results.map(r => new Dealer(
      r.id,
      r.businessName,
      r.contactName,
      r.email,
      r.phone,
      r.tinNumber,
      r.location,
      r.status as any,
      r.createdAt,
      r.updatedAt || undefined
    ));
  }
}

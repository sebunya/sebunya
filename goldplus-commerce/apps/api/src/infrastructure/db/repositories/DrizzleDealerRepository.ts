import { db } from '../client';
import { dealerApplications } from '../schema/governance';
import { and, asc, eq } from 'drizzle-orm';
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

  /** Listing fields per application, for the admin table. */
  async listingById(): Promise<Map<string, { listedPublicly: boolean; publicTown: string | null; publicAddress: string | null; publicPhone: string | null; country: string }>> {
    const rows = await db.select({ id: dealerApplications.id, listedPublicly: dealerApplications.listedPublicly, publicTown: dealerApplications.publicTown, publicAddress: dealerApplications.publicAddress, publicPhone: dealerApplications.publicPhone, country: dealerApplications.country }).from(dealerApplications);
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** The public dealer list: listed by staff, never the private application fields (email, TIN, contact name). */
  async listPublic(country?: string): Promise<{ id: string; name: string; town: string; address: string | null; phone: string | null; country: string }[]> {
    const rows = await db.select({ id: dealerApplications.id, name: dealerApplications.businessName, town: dealerApplications.publicTown, address: dealerApplications.publicAddress, phone: dealerApplications.publicPhone, country: dealerApplications.country })
      .from(dealerApplications)
      .where(country ? and(eq(dealerApplications.listedPublicly, true), eq(dealerApplications.country, country)) : eq(dealerApplications.listedPublicly, true))
      .orderBy(asc(dealerApplications.country), asc(dealerApplications.publicTown), asc(dealerApplications.businessName));
    return rows.filter((r) => r.town).map((r) => ({ ...r, town: r.town as string }));
  }

  /** List or unlist an application. Listing approves it; unlisting leaves the status alone. */
  async setListing(id: string, input: { listed: boolean; town: string | null; address: string | null; phone: string | null; country: string }, now: Date): Promise<boolean> {
    const set = input.listed
      ? { listedPublicly: true, publicTown: input.town, publicAddress: input.address, publicPhone: input.phone, country: input.country, listedAt: now, status: 'approved', updatedAt: now }
      : { listedPublicly: false, updatedAt: now };
    const out = await db.update(dealerApplications).set(set).where(eq(dealerApplications.id, id)).returning({ id: dealerApplications.id });
    return out.length > 0;
  }
}

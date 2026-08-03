import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { legalPolicies, legalPolicyVersions } from '../schema/legal';
import {
  ILegalCmsRepository,
  LegalPolicyRecord,
  LegalVersionRecord,
  LegalVersionStatus,
} from '../../../application/use-cases/legal/LegalCmsUseCase';

type VersionRow = typeof legalPolicyVersions.$inferSelect;

export class DrizzleLegalCmsRepository implements ILegalCmsRepository {
  private policyKeyById = new Map<string, string>();

  private toRecord(row: VersionRow, policyKey: string): LegalVersionRecord {
    return {
      id: row.id,
      policyId: row.policyId,
      policyKey,
      version: row.version,
      title: row.title,
      bodyMarkdown: row.bodyMarkdown,
      changeNote: row.changeNote,
      status: row.status as LegalVersionStatus,
      effectiveAt: row.effectiveAt,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
    };
  }

  private async keyFor(policyId: string): Promise<string> {
    const cached = this.policyKeyById.get(policyId);
    if (cached) return cached;
    const [row] = await db.select({ key: legalPolicies.key }).from(legalPolicies).where(eq(legalPolicies.id, policyId)).limit(1);
    const key = row?.key ?? 'unknown';
    this.policyKeyById.set(policyId, key);
    return key;
  }

  async ensurePolicies(defs: Array<{ key: string; title: string }>): Promise<void> {
    await db
      .insert(legalPolicies)
      .values(defs.map((d) => ({ key: d.key, title: d.title })))
      .onConflictDoNothing();
  }

  async listPoliciesWithVersions() {
    const policies = await db.select().from(legalPolicies).orderBy(legalPolicies.key);
    const versions = await db.select().from(legalPolicyVersions).orderBy(desc(legalPolicyVersions.version));
    return policies.map((p) => ({
      id: p.id,
      key: p.key,
      title: p.title,
      currentVersionId: p.currentVersionId,
      versions: versions.filter((v) => v.policyId === p.id).map((v) => this.toRecord(v, p.key)),
    }));
  }

  async findPolicyByKey(key: string): Promise<LegalPolicyRecord | null> {
    const [row] = await db.select().from(legalPolicies).where(eq(legalPolicies.key, key)).limit(1);
    return row ? { id: row.id, key: row.key, title: row.title, currentVersionId: row.currentVersionId } : null;
  }

  async findVersion(id: string): Promise<LegalVersionRecord | null> {
    const [row] = await db.select().from(legalPolicyVersions).where(eq(legalPolicyVersions.id, id)).limit(1);
    return row ? this.toRecord(row, await this.keyFor(row.policyId)) : null;
  }

  async nextVersionNumber(policyId: string): Promise<number> {
    const [row] = await db
      .select({ max: sql<number>`coalesce(max(${legalPolicyVersions.version}), 0)::int` })
      .from(legalPolicyVersions)
      .where(eq(legalPolicyVersions.policyId, policyId));
    return (row?.max ?? 0) + 1;
  }

  async createVersion(v: Parameters<ILegalCmsRepository['createVersion']>[0]): Promise<LegalVersionRecord> {
    const [row] = await db.insert(legalPolicyVersions).values(v).returning();
    return this.toRecord(row, await this.keyFor(row.policyId));
  }

  async updateVersion(id: string, patch: Parameters<ILegalCmsRepository['updateVersion']>[1]) {
    const [row] = await db
      .update(legalPolicyVersions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(legalPolicyVersions.id, id))
      .returning();
    return row ? this.toRecord(row, await this.keyFor(row.policyId)) : null;
  }

  async setVersionStatus(id: string, fields: Parameters<ILegalCmsRepository['setVersionStatus']>[1]) {
    const [row] = await db
      .update(legalPolicyVersions)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(legalPolicyVersions.id, id))
      .returning();
    return row ? this.toRecord(row, await this.keyFor(row.policyId)) : null;
  }

  async setCurrentVersion(policyId: string, versionId: string): Promise<void> {
    await db
      .update(legalPolicies)
      .set({ currentVersionId: versionId, updatedAt: new Date() })
      .where(eq(legalPolicies.id, policyId));
  }
}

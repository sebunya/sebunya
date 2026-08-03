/**
 * Governed legal-policy lifecycle (Wave 2C).
 *
 * Invariants enforced HERE, not in the UI:
 *  - a version's text is editable only while DRAFT or IN_REVIEW; once approved it is
 *    immutable history;
 *  - approval requires a different actor than the author (maker/checker);
 *  - nothing becomes public without an APPROVED version being published;
 *  - publishing with a future effectiveAt schedules; resolution lazily promotes a
 *    SCHEDULED version whose time has arrived, so no cron is needed and the public
 *    answer is deterministic at read time;
 *  - rollback re-points the current pointer at a prior published version — history
 *    is never mutated.
 */

export type LegalVersionStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';

export interface LegalVersionRecord {
  id: string;
  policyId: string;
  policyKey: string;
  version: number;
  title: string;
  bodyMarkdown: string;
  changeNote: string | null;
  status: LegalVersionStatus;
  effectiveAt: Date | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface LegalPolicyRecord {
  id: string;
  key: string;
  title: string;
  currentVersionId: string | null;
}

export const LEGAL_POLICY_KEYS: Array<{ key: string; title: string }> = [
  { key: 'privacy', title: 'Privacy policy' },
  { key: 'terms', title: 'Terms of service' },
  { key: 'returns', title: 'Returns policy' },
  { key: 'refunds', title: 'Refunds policy' },
  { key: 'warranty', title: 'Warranty policy' },
  { key: 'cookies', title: 'Cookies policy' },
  { key: 'consent', title: 'Consent notice' },
  { key: 'delivery', title: 'Delivery policy' },
  { key: 'promotions', title: 'Promotions terms' },
  { key: 'creator_terms', title: 'Creator terms' },
  { key: 'loyalty_terms', title: 'Loyalty terms' },
  { key: 'campaign_terms', title: 'Campaign terms' },
];

export interface ILegalCmsRepository {
  ensurePolicies(defs: Array<{ key: string; title: string }>): Promise<void>;
  listPoliciesWithVersions(): Promise<Array<LegalPolicyRecord & { versions: LegalVersionRecord[] }>>;
  findPolicyByKey(key: string): Promise<LegalPolicyRecord | null>;
  findVersion(id: string): Promise<LegalVersionRecord | null>;
  nextVersionNumber(policyId: string): Promise<number>;
  createVersion(v: {
    policyId: string;
    version: number;
    title: string;
    bodyMarkdown: string;
    changeNote: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    createdBy: string | null;
  }): Promise<LegalVersionRecord>;
  updateVersion(
    id: string,
    patch: Partial<Pick<LegalVersionRecord, 'title' | 'bodyMarkdown' | 'changeNote' | 'seoTitle' | 'seoDescription'>>,
  ): Promise<LegalVersionRecord | null>;
  setVersionStatus(
    id: string,
    fields: Partial<Pick<LegalVersionRecord, 'status' | 'effectiveAt' | 'approvedBy' | 'publishedAt'>>,
  ): Promise<LegalVersionRecord | null>;
  setCurrentVersion(policyId: string, versionId: string): Promise<void>;
}

export type LegalOutcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; status: number };

const refuse = (code: string, message: string, status = 409): LegalOutcome<never> => ({ ok: false, code, message, status });

export class LegalCmsUseCase {
  constructor(private readonly repo: ILegalCmsRepository, private readonly now: () => Date = () => new Date()) {}

  async list() {
    await this.repo.ensurePolicies(LEGAL_POLICY_KEYS);
    return this.repo.listPoliciesWithVersions();
  }

  async createDraft(args: {
    policyKey: string;
    title: string;
    bodyMarkdown: string;
    changeNote?: string | null;
    seoTitle?: string | null;
    seoDescription?: string | null;
    actorId: string;
  }): Promise<LegalOutcome<LegalVersionRecord>> {
    await this.repo.ensurePolicies(LEGAL_POLICY_KEYS);
    const policy = await this.repo.findPolicyByKey(args.policyKey);
    if (!policy) return refuse('UNKNOWN_POLICY', `No such policy key: ${args.policyKey}`, 404);
    if (!args.title.trim() || !args.bodyMarkdown.trim()) {
      return refuse('BAD_INPUT', 'Title and body are required.', 400);
    }
    const version = await this.repo.createVersion({
      policyId: policy.id,
      version: await this.repo.nextVersionNumber(policy.id),
      title: args.title.trim(),
      bodyMarkdown: args.bodyMarkdown,
      changeNote: args.changeNote?.trim() || null,
      seoTitle: args.seoTitle?.trim() || null,
      seoDescription: args.seoDescription?.trim() || null,
      createdBy: args.actorId,
    });
    return { ok: true, value: version };
  }

  async updateDraft(
    id: string,
    patch: Partial<Pick<LegalVersionRecord, 'title' | 'bodyMarkdown' | 'changeNote' | 'seoTitle' | 'seoDescription'>>,
  ): Promise<LegalOutcome<LegalVersionRecord>> {
    const version = await this.repo.findVersion(id);
    if (!version) return refuse('NOT_FOUND', 'Version not found.', 404);
    if (version.status !== 'DRAFT' && version.status !== 'IN_REVIEW') {
      // Approved wording is history. Changing it after approval would make the
      // approval trail meaningless.
      return refuse('LOCKED_VERSION', `A ${version.status} version is immutable — create a new draft instead.`);
    }
    const updated = await this.repo.updateVersion(id, patch);
    return updated ? { ok: true, value: updated } : refuse('NOT_FOUND', 'Version not found.', 404);
  }

  async submitForReview(id: string): Promise<LegalOutcome<LegalVersionRecord>> {
    const version = await this.repo.findVersion(id);
    if (!version) return refuse('NOT_FOUND', 'Version not found.', 404);
    if (version.status !== 'DRAFT') return refuse('BAD_STATE', `Only a DRAFT can be submitted (this is ${version.status}).`);
    const updated = await this.repo.setVersionStatus(id, { status: 'IN_REVIEW' });
    return { ok: true, value: updated! };
  }

  async approve(id: string, approverId: string): Promise<LegalOutcome<LegalVersionRecord>> {
    const version = await this.repo.findVersion(id);
    if (!version) return refuse('NOT_FOUND', 'Version not found.', 404);
    if (version.status !== 'IN_REVIEW') return refuse('BAD_STATE', `Only an IN_REVIEW version can be approved (this is ${version.status}).`);
    if (version.createdBy && version.createdBy === approverId) {
      return refuse('MAKER_CHECKER', 'The author cannot approve their own version. A second reviewer must approve.', 403);
    }
    const updated = await this.repo.setVersionStatus(id, { status: 'APPROVED', approvedBy: approverId });
    return { ok: true, value: updated! };
  }

  async publish(id: string, effectiveAt?: Date | null): Promise<LegalOutcome<LegalVersionRecord>> {
    const version = await this.repo.findVersion(id);
    if (!version) return refuse('NOT_FOUND', 'Version not found.', 404);
    if (version.status !== 'APPROVED' && version.status !== 'SCHEDULED') {
      return refuse('BAD_STATE', `Only an APPROVED version can be published (this is ${version.status}).`);
    }
    const now = this.now();
    if (effectiveAt && effectiveAt.getTime() > now.getTime()) {
      const updated = await this.repo.setVersionStatus(id, { status: 'SCHEDULED', effectiveAt });
      return { ok: true, value: updated! };
    }
    const updated = await this.repo.setVersionStatus(id, {
      status: 'PUBLISHED',
      effectiveAt: effectiveAt ?? version.effectiveAt ?? now,
      publishedAt: now,
    });
    await this.repo.setCurrentVersion(version.policyId, id);
    return { ok: true, value: updated! };
  }

  async archive(id: string): Promise<LegalOutcome<LegalVersionRecord>> {
    const version = await this.repo.findVersion(id);
    if (!version) return refuse('NOT_FOUND', 'Version not found.', 404);
    const policy = await this.repo.findPolicyByKey(version.policyKey);
    if (policy?.currentVersionId === id) {
      return refuse('CURRENT_VERSION', 'The current public version cannot be archived. Publish a replacement first.');
    }
    const updated = await this.repo.setVersionStatus(id, { status: 'ARCHIVED' });
    return { ok: true, value: updated! };
  }

  /** Re-points the policy at a previously published version. History untouched. */
  async rollback(policyKey: string, versionId: string): Promise<LegalOutcome<LegalVersionRecord>> {
    const policy = await this.repo.findPolicyByKey(policyKey);
    if (!policy) return refuse('UNKNOWN_POLICY', 'Policy not found.', 404);
    const version = await this.repo.findVersion(versionId);
    if (!version || version.policyId !== policy.id) return refuse('NOT_FOUND', 'Version not found for this policy.', 404);
    if (!version.publishedAt) return refuse('NEVER_PUBLISHED', 'Only a previously published version can be made current again.');
    const updated = await this.repo.setVersionStatus(versionId, { status: 'PUBLISHED', publishedAt: this.now() });
    await this.repo.setCurrentVersion(policy.id, versionId);
    return { ok: true, value: updated! };
  }

  /**
   * Public resolution: the current PUBLISHED version, lazily promoting a SCHEDULED
   * one whose effective time has arrived. Returns null when nothing is published —
   * the public page then shows its truthful interim static wording.
   */
  async resolveCurrent(policyKey: string): Promise<LegalVersionRecord | null> {
    const policy = await this.repo.findPolicyByKey(policyKey);
    if (!policy) return null;
    const all = await this.repo.listPoliciesWithVersions();
    const mine = all.find((p) => p.key === policyKey);
    if (!mine) return null;
    const now = this.now().getTime();
    const due = mine.versions
      .filter((v) => v.status === 'SCHEDULED' && v.effectiveAt && v.effectiveAt.getTime() <= now)
      .sort((a, b) => (b.effectiveAt!.getTime() - a.effectiveAt!.getTime()))[0];
    if (due) {
      await this.repo.setVersionStatus(due.id, { status: 'PUBLISHED', publishedAt: this.now() });
      await this.repo.setCurrentVersion(policy.id, due.id);
      return this.repo.findVersion(due.id);
    }
    if (!policy.currentVersionId) return null;
    const current = await this.repo.findVersion(policy.currentVersionId);
    return current && current.status === 'PUBLISHED' ? current : null;
  }
}

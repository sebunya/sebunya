import { describe, expect, it } from 'vitest';
import {
  ILegalCmsRepository,
  LEGAL_POLICY_KEYS,
  LegalCmsUseCase,
  LegalPolicyRecord,
  LegalVersionRecord,
} from '../../apps/api/src/application/use-cases/legal/LegalCmsUseCase';

/**
 * Wave 2C governance invariants: maker/checker on approval, immutability once a
 * version leaves review, scheduled publication resolving lazily at its effective
 * time, rollback re-pointing without mutating history, and public resolution never
 * serving an unpublished draft.
 */

class FakeLegalRepo implements ILegalCmsRepository {
  policies = new Map<string, LegalPolicyRecord>();
  versions = new Map<string, LegalVersionRecord>();
  private seq = 0;

  async ensurePolicies(defs: Array<{ key: string; title: string }>) {
    for (const d of defs) {
      if (![...this.policies.values()].some((p) => p.key === d.key)) {
        const id = `pol-${d.key}`;
        this.policies.set(id, { id, key: d.key, title: d.title, currentVersionId: null });
      }
    }
  }
  async listPoliciesWithVersions() {
    return [...this.policies.values()].map((p) => ({
      ...p,
      versions: [...this.versions.values()].filter((v) => v.policyId === p.id).sort((a, b) => b.version - a.version),
    }));
  }
  async findPolicyByKey(key: string) {
    return [...this.policies.values()].find((p) => p.key === key) ?? null;
  }
  async findVersion(id: string) {
    return this.versions.get(id) ?? null;
  }
  async nextVersionNumber(policyId: string) {
    return [...this.versions.values()].filter((v) => v.policyId === policyId).length + 1;
  }
  async createVersion(v: Parameters<ILegalCmsRepository['createVersion']>[0]) {
    const policy = [...this.policies.values()].find((p) => p.id === v.policyId)!;
    const rec: LegalVersionRecord = {
      id: `ver-${++this.seq}`,
      policyId: v.policyId,
      policyKey: policy.key,
      version: v.version,
      title: v.title,
      bodyMarkdown: v.bodyMarkdown,
      changeNote: v.changeNote,
      status: 'DRAFT',
      effectiveAt: null,
      seoTitle: v.seoTitle,
      seoDescription: v.seoDescription,
      createdBy: v.createdBy,
      approvedBy: null,
      publishedAt: null,
      createdAt: new Date(0),
    };
    this.versions.set(rec.id, rec);
    return rec;
  }
  async updateVersion(id: string, patch: Parameters<ILegalCmsRepository['updateVersion']>[1]) {
    const v = this.versions.get(id);
    if (!v) return null;
    const next = { ...v, ...patch } as LegalVersionRecord;
    this.versions.set(id, next);
    return next;
  }
  async setVersionStatus(id: string, fields: Parameters<ILegalCmsRepository['setVersionStatus']>[1]) {
    const v = this.versions.get(id);
    if (!v) return null;
    const next = { ...v, ...fields } as LegalVersionRecord;
    this.versions.set(id, next);
    return next;
  }
  async setCurrentVersion(policyId: string, versionId: string) {
    const p = [...this.policies.values()].find((x) => x.id === policyId)!;
    this.policies.set(p.id, { ...p, currentVersionId: versionId });
  }
}

const setup = (now: () => Date = () => new Date('2026-08-03T12:00:00Z')) => {
  const repo = new FakeLegalRepo();
  return { repo, useCase: new LegalCmsUseCase(repo, now) };
};

const draft = async (useCase: LegalCmsUseCase, author = 'author-1') => {
  const outcome = await useCase.createDraft({
    policyKey: 'privacy',
    title: 'Privacy policy',
    bodyMarkdown: 'We respect your data.',
    actorId: author,
  });
  if (!outcome.ok) throw new Error('draft failed');
  return outcome.value;
};

describe('LegalCmsUseCase governance', () => {
  it('covers all twelve required policy keys', () => {
    expect(LEGAL_POLICY_KEYS).toHaveLength(12);
  });

  it('maker/checker: the author cannot approve their own version', async () => {
    const { useCase } = setup();
    const v = await draft(useCase, 'author-1');
    await useCase.submitForReview(v.id);
    const refused = await useCase.approve(v.id, 'author-1');
    expect(refused).toMatchObject({ ok: false, code: 'MAKER_CHECKER', status: 403 });
    const approved = await useCase.approve(v.id, 'reviewer-2');
    expect(approved.ok).toBe(true);
  });

  it('a version is immutable once approved', async () => {
    const { useCase } = setup();
    const v = await draft(useCase);
    await useCase.submitForReview(v.id);
    await useCase.approve(v.id, 'reviewer-2');
    const refused = await useCase.updateDraft(v.id, { bodyMarkdown: 'sneaky edit' });
    expect(refused).toMatchObject({ ok: false, code: 'LOCKED_VERSION' });
  });

  it('publishing with a future effectiveAt schedules; resolution promotes it when due', async () => {
    let clock = new Date('2026-08-03T12:00:00Z');
    const { useCase, repo } = setup(() => clock);
    const v = await draft(useCase);
    await useCase.submitForReview(v.id);
    await useCase.approve(v.id, 'reviewer-2');
    const scheduled = await useCase.publish(v.id, new Date('2026-08-04T00:00:00Z'));
    expect(scheduled.ok && scheduled.value.status).toBe('SCHEDULED');
    // Before the effective time: nothing published, public page falls back.
    expect(await useCase.resolveCurrent('privacy')).toBeNull();
    // At the effective time: lazily promoted and becomes current.
    clock = new Date('2026-08-04T00:00:01Z');
    const resolved = await useCase.resolveCurrent('privacy');
    expect(resolved?.status).toBe('PUBLISHED');
    expect([...repo.policies.values()].find((p) => p.key === 'privacy')?.currentVersionId).toBe(v.id);
  });

  it('rollback re-points at a previously published version without rewriting history', async () => {
    const { useCase, repo } = setup();
    const v1 = await draft(useCase);
    await useCase.submitForReview(v1.id);
    await useCase.approve(v1.id, 'reviewer-2');
    await useCase.publish(v1.id);
    const v2 = await draft(useCase);
    await useCase.submitForReview(v2.id);
    await useCase.approve(v2.id, 'reviewer-2');
    await useCase.publish(v2.id);
    expect((await useCase.resolveCurrent('privacy'))?.id).toBe(v2.id);
    const rolled = await useCase.rollback('privacy', v1.id);
    expect(rolled.ok).toBe(true);
    expect((await useCase.resolveCurrent('privacy'))?.id).toBe(v1.id);
    // v2 still exists in history, untouched in content.
    expect(repo.versions.get(v2.id)?.bodyMarkdown).toBe('We respect your data.');
    // A never-published draft cannot be rolled back to.
    const v3 = await draft(useCase);
    expect(await useCase.rollback('privacy', v3.id)).toMatchObject({ ok: false, code: 'NEVER_PUBLISHED' });
  });

  it('resolveCurrent never serves drafts and the current version cannot be archived', async () => {
    const { useCase } = setup();
    const v = await draft(useCase);
    expect(await useCase.resolveCurrent('privacy')).toBeNull();
    await useCase.submitForReview(v.id);
    await useCase.approve(v.id, 'reviewer-2');
    await useCase.publish(v.id);
    expect(await useCase.archive(v.id)).toMatchObject({ ok: false, code: 'CURRENT_VERSION' });
  });
});

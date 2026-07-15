import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_POLICIES, policyBySlug } from '../../apps/web/src/lib/legal-policies';

const root = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');

describe('Slice 12 legal policy registry', () => {
  it('covers privacy, terms, returns, warranty, and cookies', () => {
    expect(LEGAL_POLICIES.map((p) => p.slug).sort()).toEqual(['cookies', 'privacy', 'returns', 'terms', 'warranty']);
  });

  it('never invents an effective date before legal review', () => {
    for (const p of LEGAL_POLICIES) {
      if (p.status !== 'interim_guidance' && p.status !== 'draft_pending_legal_review') continue;
      expect(p.effectiveDate, `${p.slug} must not carry an invented effective date`).toBeNull();
    }
  });

  it('every registered policy has a live page that shows its status and version', () => {
    for (const p of LEGAL_POLICIES) {
      const source = read(`apps/web/src/pages/${p.slug}.astro`);
      expect(source, `${p.slug} page must read the registry`).toContain("policyBySlug('" + p.slug + "')");
      expect(source, `${p.slug} page must show status`).toContain('POLICY_STATUS_LABEL[policy.status]');
      expect(source, `${p.slug} page must show version`).toContain('policy.version');
    }
    expect(policyBySlug('returns')?.status).toBe('draft_pending_legal_review');
  });

  it('returns and warranty route claims through existing support, not a new model', () => {
    for (const slug of ['returns', 'warranty']) {
      const source = read(`apps/web/src/pages/${slug}.astro`);
      expect(source).toContain('href="/support"');
    }
  });

  it('the footer links every policy page', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    for (const p of LEGAL_POLICIES) {
      expect(layout, `footer must link ${p.path}`).toContain(`href="${p.path}"`);
    }
  });

  it('draft pages carry no invented concrete commitments', () => {
    for (const slug of ['returns', 'warranty', 'cookies']) {
      const source = read(`apps/web/src/pages/${slug}.astro`);
      expect(source, `${slug} must not state concrete day-windows before review`).not.toMatch(/\b\d+[- ]day\b/i);
      expect(source, `${slug} must not promise refunds unconditionally`).not.toMatch(/guaranteed refund|full refund within/i);
    }
  });
});

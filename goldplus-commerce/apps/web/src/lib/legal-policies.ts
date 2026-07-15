/**
 * Slice 12: legal policy registry — the single source of truth for policy
 * versioning and review status. Truthfulness rules:
 *  - No invented legal commitments: draft policies say so plainly.
 *  - No invented effective dates: drafts carry null until legal review sets one.
 */

export type PolicyStatus = 'interim_guidance' | 'draft_pending_legal_review';

export interface LegalPolicy {
  slug: string;
  path: string;
  title: string;
  version: string;
  status: PolicyStatus;
  /** Set only after formal legal review — never invented. */
  effectiveDate: string | null;
  summary: string;
}

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  interim_guidance: 'Interim public guidance',
  draft_pending_legal_review: 'Draft — pending legal review',
};

export const LEGAL_POLICIES: LegalPolicy[] = [
  {
    slug: 'privacy',
    path: '/privacy',
    title: 'Privacy policy',
    version: '0.9-interim',
    status: 'interim_guidance',
    effectiveDate: null,
    summary: 'How customer information may be used while formal policy wording is reviewed.',
  },
  {
    slug: 'terms',
    path: '/terms',
    title: 'Terms of service',
    version: '0.9-interim',
    status: 'interim_guidance',
    effectiveDate: null,
    summary: 'Practical terms for using the GoldPlus website and placing orders.',
  },
  {
    slug: 'returns',
    path: '/returns',
    title: 'Returns policy',
    version: '0.1-draft',
    status: 'draft_pending_legal_review',
    effectiveDate: null,
    summary: 'How to start a return and what to expect while the formal policy is finalised.',
  },
  {
    slug: 'warranty',
    path: '/warranty',
    title: 'Warranty policy',
    version: '0.1-draft',
    status: 'draft_pending_legal_review',
    effectiveDate: null,
    summary: 'How warranty claims are handled; product-specific terms come from the product listing and receipt.',
  },
  {
    slug: 'cookies',
    path: '/cookies',
    title: 'Cookies & consent',
    version: '0.1-draft',
    status: 'draft_pending_legal_review',
    effectiveDate: null,
    summary: 'Which first-party cookies the site uses and how to control preferences.',
  },
];

export function policyBySlug(slug: string): LegalPolicy | undefined {
  return LEGAL_POLICIES.find((p) => p.slug === slug);
}

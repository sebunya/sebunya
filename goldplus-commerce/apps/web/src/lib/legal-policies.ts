/**
 * Slice 12: legal policy registry — the single source of truth for policy
 * versioning and review status. Truthfulness rules:
 *  - No invented legal commitments: a policy states only what is actually done.
 *  - No invented effective dates: a date appears only once the policy is
 *    approved and in force.
 *
 * 2026-08-13: the owner approved all previously interim/draft policies for
 * production. They are now IN FORCE with a real effective date. This was a
 * prerequisite for Google OAuth verification, which requires the published
 * privacy policy to accurately describe the application's handling of user
 * data — a policy that describes itself as unfinished cannot do that.
 *
 * The `draft_pending_legal_review` status is retained for future policies, not
 * because anything currently uses it.
 */

export type PolicyStatus = 'in_force' | 'interim_guidance' | 'draft_pending_legal_review';

export interface LegalPolicy {
  slug: string;
  path: string;
  title: string;
  version: string;
  status: PolicyStatus;
  /** Set only once the policy is approved and in force — never invented. */
  effectiveDate: string | null;
  summary: string;
}

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  in_force: 'In force',
  interim_guidance: 'Interim public guidance',
  draft_pending_legal_review: 'Draft. Pending legal review',
};

/** The date the owner approved every policy below for production. */
export const POLICY_EFFECTIVE_DATE = '2026-08-13';

export const LEGAL_POLICIES: LegalPolicy[] = [
  {
    slug: 'privacy',
    path: '/privacy',
    title: 'Privacy policy',
    version: '1.0',
    status: 'in_force',
    effectiveDate: POLICY_EFFECTIVE_DATE,
    summary: 'How GoldPlus handles customer information, and how connected Google account data is used and protected.',
  },
  {
    slug: 'terms',
    path: '/terms',
    title: 'Terms of service',
    version: '1.0',
    status: 'in_force',
    effectiveDate: POLICY_EFFECTIVE_DATE,
    summary: 'Terms for using the GoldPlus website and placing orders.',
  },
  {
    slug: 'returns',
    path: '/returns',
    title: 'Returns policy',
    version: '1.0',
    status: 'in_force',
    effectiveDate: POLICY_EFFECTIVE_DATE,
    summary: 'How to start a return and what to expect.',
  },
  {
    slug: 'warranty',
    path: '/warranty',
    title: 'Warranty policy',
    version: '1.0',
    status: 'in_force',
    effectiveDate: POLICY_EFFECTIVE_DATE,
    summary: 'How warranty claims are handled; product-specific terms come from the product listing and receipt.',
  },
  {
    slug: 'cookies',
    path: '/cookies',
    title: 'Cookies & consent',
    version: '1.0',
    status: 'in_force',
    effectiveDate: POLICY_EFFECTIVE_DATE,
    summary: 'Which first-party cookies the site uses and how to control preferences.',
  },
];

export function policyBySlug(slug: string): LegalPolicy | undefined {
  return LEGAL_POLICIES.find((p) => p.slug === slug);
}

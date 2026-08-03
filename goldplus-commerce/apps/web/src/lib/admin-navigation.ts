export interface NavItem {
  label: string;
  href: string;
  group: 'Dashboard' | 'Commerce' | 'Recommendations' | 'Merchandising' | 'Measurement' | 'System' | 'Other';
  status: 'working' | 'read_only' | 'diagnostic' | 'hidden';
  description: string;
  reason?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const ADMIN_NAVIGATION_ITEMS: NavItem[] = [
  {
    label: 'Control Centre',
    href: '/admin',
    group: 'Dashboard',
    status: 'working',
    description: 'Unified administration oversight and system-wide statuses.'
  },
  {
    label: 'Commerce Analytics',
    href: '/admin/analytics',
    group: 'Dashboard',
    status: 'working',
    description: 'Decision-grade business metrics, trends, actions and data quality from the canonical metric catalogue.'
  },
  {
    label: 'Products',
    href: '/admin/products',
    group: 'Commerce',
    status: 'working',
    description: 'Manage physical catalogue items, definitions and specs.'
  },
  {
    label: 'Platform Modules',
    href: '/admin/platform-modules',
    group: 'Commerce',
    status: 'working',
    description: 'P0–U6 modules live: coupons/promotions, device catalogue, review moderation, creator platform, flash sales and SEO/redirects.'
  },
  {
    label: 'PIM Imports',
    href: '/admin/pim-imports',
    group: 'Commerce',
    status: 'working',
    description: 'Stage, validate, approve, apply and safely roll back catalogue imports.'
  },
  {
    label: 'Carts',
    href: '/admin/carts',
    group: 'Commerce',
    status: 'working',
    description: 'Inspect active shopping baskets, sessions and diagnostics.'
  },
  {
    label: 'Orders',
    href: '/admin/orders',
    group: 'Commerce',
    status: 'read_only',
    description: 'Read-only relational query of active buyer records.',
    reason: 'Operational lifecycle actions live on the Fulfilment queue.'
  },
  {
    label: 'Fraud Triage',
    href: '/admin/fraud',
    group: 'Commerce',
    status: 'working',
    description: 'Review risk signals, assignments, evidence and governed operator decisions.'
  },
  {
    label: 'Fulfilment',
    href: '/admin/fulfilment',
    group: 'Commerce',
    status: 'working',
    description: 'Actionable New Orders queue: products, payment status and lifecycle transitions.'
  },
  {
    label: 'Order Emails',
    href: '/admin/notifications/order-emails',
    group: 'Commerce',
    status: 'working',
    description: 'Transactional admin order-email intents: delivery status, dead-letter and manual replay.'
  },
  {
    label: 'Recommendations',
    href: '/admin/recommendations',
    group: 'Recommendations',
    status: 'working',
    description: 'Manage product recommendations shown across the store.'
  },
  {
    label: 'Recommendation Analytics',
    href: '/admin/recommendations/analytics',
    group: 'Recommendations',
    status: 'working',
    description: 'Track recommendation performance, CTR and conversion signals.'
  },
  {
    label: 'Rules',
    href: '/admin/recommendations/rules',
    group: 'Recommendations',
    status: 'working',
    description: 'Rules that boost, suppress or pin specific products.'
  },
  {
    label: 'Create rule',
    href: '/admin/recommendations/rules/new',
    group: 'Recommendations',
    status: 'working',
    description: 'Create a new recommendation rule.'
  },
  {
    label: 'Preview',
    href: '/admin/recommendations/preview',
    group: 'Recommendations',
    status: 'working',
    description: 'Test and preview rules before activation.'
  },
  {
    label: 'Merchandising',
    href: '/admin/merchandising',
    group: 'Merchandising',
    status: 'read_only',
    description: 'Manage sections on the homepage.'
  },
  {
    label: 'Customer DNA',
    href: '/admin/customer-dna',
    group: 'Merchandising',
    status: 'read_only',
    description: 'Canonical customer profiles, lifecycle and next-best action.'
  },
  {
    label: 'Decision Intelligence',
    href: '/admin/decision-intelligence',
    group: 'Merchandising',
    status: 'read_only',
    description: 'Explainable, evidence-backed operational insights and workflow.'
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    group: 'System',
    status: 'diagnostic',
    description: 'Review app configuration values.',
    reason: 'Read-only view.'
  },
  {
    label: 'System status',
    href: '/admin/system',
    group: 'System',
    status: 'diagnostic',
    description: 'Check service and route availability.',
    reason: 'Diagnostic tools.'
  },
  {
    label: 'Measurement Tower',
    href: '/admin/measurement',
    group: 'Measurement',
    status: 'working',
    description: 'Measurement Control Tower — consent governance, sGTM routing, attribution intelligence.'
  },
  {
    label: 'Consent Audit',
    href: '/admin/measurement/consent',
    group: 'Measurement',
    status: 'working',
    description: 'GDPR Article 7(1) consent audit trail — all grant and withdrawal decisions.'
  },
  {
    label: 'Consent Operations',
    href: '/admin/consent-operating',
    group: 'Measurement',
    status: 'working',
    description: 'Protected consent workflows, suppression intake, dry-runs and no-send readiness.'
  },
  {
    label: 'Consent Control Room',
    href: '/admin/consent-operations',
    group: 'Measurement',
    status: 'read_only',
    description: 'Read-only consent incident classification, no-send sentinels and operator runbooks.'
  },
  {
    label: 'Automation',
    href: '/admin/automation',
    group: 'Measurement',
    status: 'working',
    description: 'Govern immutable automations, approvals, executions, delivery evidence and ambiguous outcomes.'
  },
  {
    label: 'Attribution',
    href: '/admin/measurement/attribution',
    group: 'Measurement',
    status: 'working',
    description: 'Multi-touch attribution analysis and match quality monitoring.'
  },
  {
    label: 'Dead Letter Queue',
    href: '/admin/measurement/dlq',
    group: 'Measurement',
    status: 'working',
    description: 'Manage and replay failed conversion dispatch events.'
  },
  {
    label: 'Access',
    href: '/admin/governance',
    group: 'System',
    status: 'hidden',
    description: 'Permissions and role definitions.'
  },
  // Hidden Modules
  {
    label: 'Categories',
    href: '/admin/categories',
    group: 'Commerce',
    status: 'hidden',
    description: 'Organize inventory into customer-facing groupings.'
  },
  {
    label: 'Inventory',
    href: '/admin/inventory',
    group: 'Commerce',
    status: 'working',
    description: 'Available-to-promise, reserved stock and reorder-point low-stock alerts.'
  },
  {
    label: 'Pricing',
    href: '/admin/pricing',
    group: 'Commerce',
    status: 'working',
    description: 'Control Ugandan Shilling rates, currencies and wholesale levels.'
  },
  {
    label: 'Authenticity Check',
    href: '/admin/verification',
    group: 'Other',
    status: 'hidden',
    description: 'Lookup holographic sequence status and scans.'
  },
  {
    label: 'Dealer Requests',
    href: '/admin/dealers',
    group: 'Other',
    status: 'hidden',
    description: 'Assess retail applications for wholesale credentials.'
  },
  {
    label: 'Price Quotes',
    href: '/admin/quotes',
    group: 'Other',
    status: 'hidden',
    description: 'Formulate responses to corporate procurement enquiries.'
  },
  {
    label: 'Support Tickets',
    href: '/admin/support',
    group: 'Other',
    status: 'working',
    description: 'Assist users with technical difficulties and support cases.'
  },
  {
    label: 'Commerce OS',
    href: '/admin/commerce-os',
    group: 'Dashboard',
    status: 'working',
    description: 'Operational directory and live readiness for every commerce module.'
  },
  {
    label: 'Module approvals',
    href: '/admin/control-centre-approvals',
    group: 'System',
    status: 'working',
    description: 'Governed activation approvals for approval-gated modules.'
  }
];

// Group helper to replicate traditional display grouping without duplicate data
export const ADMIN_NAVIGATION: NavGroup[] = [
  {
    title: 'Dashboard',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Dashboard' && item.status !== 'hidden')
  },
  {
    title: 'Commerce',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Commerce' && item.status !== 'hidden')
  },
  {
    title: 'Recommendations',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Recommendations' && item.status !== 'hidden')
  },
  {
    title: 'Merchandising',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Merchandising' && item.status !== 'hidden')
  },
  {
    title: 'Measurement',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Measurement' && item.status !== 'hidden')
  },
  {
    title: 'System',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'System' && item.status !== 'hidden')
  }
];

export interface NavItem {
  label: string;
  href: string;
  group: 'Dashboard' | 'Commerce' | 'Storefront' | 'Marketing' | 'Customers' | 'Recommendations' | 'Merchandising' | 'Measurement' | 'System' | 'Other';
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
    label: 'Categories & taxonomy',
    href: '/admin/categories',
    group: 'Storefront',
    status: 'working',
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
    label: 'Verification checks',
    href: '/admin/verification',
    group: 'Customers',
    status: 'working',
    description: 'Lookup holographic sequence status and scans.'
  },
  {
    label: 'Dealer requests',
    href: '/admin/dealers',
    group: 'Customers',
    status: 'working',
    description: 'Assess retail applications for wholesale credentials.'
  },
  {
    label: 'Quote requests',
    href: '/admin/quotes',
    group: 'Customers',
    status: 'working',
    description: 'Formulate responses to corporate procurement enquiries.'
  },
  {
    label: 'Support tickets',
    href: '/admin/support',
    group: 'Customers',
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
  },
  // ── Completed IA (2026-08-10): every operator module reachable from the nav.
  { label: 'Reports', href: '/admin/reports', group: 'Dashboard', status: 'working', description: 'Operational and commercial reports.' },
  { label: 'Product costs', href: '/admin/product-costs', group: 'Commerce', status: 'working', description: 'Enter or import effective-dated supplier costs; coverage activates profit.' },
  { label: 'Payments', href: '/admin/payments', group: 'Commerce', status: 'working', description: 'Payment attempts, reconciliation thresholds and the retry queue.' },
  { label: 'Delivery zones', href: '/admin/pricing/delivery-zones', group: 'Commerce', status: 'working', description: 'Confirmed delivery fees per district; adopt estimates into zones.' },
  { label: 'Delivery Control Centre', href: '/admin/delivery', group: 'Commerce', status: 'working', description: 'Delivery quoting model, calibration and launch controls.' },
  { label: 'Locations', href: '/admin/locations', group: 'Commerce', status: 'working', description: 'The verified Uganda location dataset behind addresses and delivery.' },
  { label: 'Compatibility', href: '/admin/compatibility', group: 'Commerce', status: 'working', description: 'Declared product compatibility used by Complete-your-setup.' },
  { label: 'Homepage hero', href: '/admin/hero', group: 'Storefront', status: 'working', description: 'The hero slide library and rotation — live with no deploy.' },
  { label: 'Header & navigation', href: '/admin/nav', group: 'Storefront', status: 'working', description: 'The header rail, featured cards, flash sale and offer figures.' },
  { label: 'Homepage content', href: '/admin/homepage', group: 'Storefront', status: 'working', description: 'The trust strip and business-pathway cards below the hero.' },
  { label: 'Storefront copy', href: '/admin/storefront-copy', group: 'Storefront', status: 'working', description: 'Support-page intro and checkout payment-method wording.' },
  { label: 'Business info', href: '/admin/business-info', group: 'Storefront', status: 'working', description: 'Address, hours, phone, WhatsApp, socials and the same-day cutoff.' },
  { label: 'Legal pages', href: '/admin/legal', group: 'Storefront', status: 'working', description: 'Privacy, terms, returns, warranty and cookies content.' },
  { label: 'Media library', href: '/admin/media', group: 'Storefront', status: 'working', description: 'Upload and manage images used across the storefront.' },
  { label: 'Copy quality', href: '/admin/copy-quality', group: 'Storefront', status: 'working', description: 'Storefront copy review against the brand voice rules.' },
  { label: 'Campaigns', href: '/admin/campaigns', group: 'Marketing', status: 'working', description: 'Marketing campaigns and their scheduling.' },
  { label: 'Media costs', href: '/admin/media-costs', group: 'Marketing', status: 'working', description: 'Import advertising spend — dry run, commit, correct; activates ROAS.' },
  { label: 'UTM builder', href: '/admin/utm-builder', group: 'Marketing', status: 'working', description: 'Build consistent campaign links for attribution.' },
  { label: 'Experiments', href: '/admin/experiments', group: 'Marketing', status: 'working', description: 'Governed A/B experiments and variants.' },
  { label: 'Product feeds', href: '/admin/feeds', group: 'Marketing', status: 'working', description: 'Catalogue feeds for external channels.' },
  { label: 'Demand signals', href: '/admin/demand', group: 'Marketing', status: 'working', description: 'Search and browse demand the catalogue does not yet serve.' },
  { label: 'Surveys', href: '/admin/surveys', group: 'Marketing', status: 'working', description: 'Customer surveys and their responses.' },
  { label: 'Notifications', href: '/admin/notifications', group: 'Marketing', status: 'working', description: 'Notification templates and wording overrides.' },
  { label: 'Loyalty & rewards', href: '/admin/loyalty', group: 'Marketing', status: 'working', description: 'Points programme, tiers, quests and gamification.' },
  { label: 'Lifecycle', href: '/admin/lifecycle', group: 'Marketing', status: 'working', description: 'Customer lifecycle stages and automations.' },
  { label: 'Behavioural interventions', href: '/admin/behavioural-interventions', group: 'Marketing', status: 'working', description: 'Governed nudges shown to customers, with guardrails.' },
  { label: 'Users', href: '/admin/users', group: 'System', status: 'working', description: 'Operator accounts.' },
  { label: 'Roles & permissions', href: '/admin/roles', group: 'System', status: 'working', description: 'Role definitions and their permission grants.' },
  { label: 'Audit log', href: '/admin/audit', group: 'System', status: 'working', description: 'Every governed mutation, actor and before/after.' },
  { label: 'Release readiness', href: '/admin/release-readiness', group: 'System', status: 'diagnostic', description: 'Release gates and evidence.' }
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
    title: 'Storefront',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Storefront' && item.status !== 'hidden')
  },
  {
    title: 'Marketing',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Marketing' && item.status !== 'hidden')
  },
  {
    title: 'Customers',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Customers' && item.status !== 'hidden')
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

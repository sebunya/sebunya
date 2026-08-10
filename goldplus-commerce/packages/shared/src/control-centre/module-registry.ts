import { PERMISSIONS } from '../permissions';
/**
 * GoldPlus Control Centre — canonical module registry.
 *
 * ONE typed source of truth for every Control Centre and Commerce OS card.
 *
 * The previous admin surface derived its badges from a hard-coded literal table
 * (`apps/web/src/lib/admin-trust-centre.ts`), so a card could read "Live" or
 * "Coming soon" with no relationship to whether the capability actually worked.
 * Nothing in this file is a status: it is *declaration only* — what a module is,
 * where it lives, what it needs. Runtime status is computed from real checks by
 * the readiness service and must never be written here.
 *
 * Three orthogonal axes, never collapsed into one badge:
 *   serviceStatus     — is the capability reachable and healthy?
 *   accessStatus      — what does the caller need in order to use it?
 *   activationStatus  — is the business capability switched on?
 *
 * A protected, healthy, switched-on module reports
 * LIVE / PROTECTED / ACTIVE — never UNAVAILABLE.
 */

/** Is the capability reachable and healthy? Computed, never declared. */
export const MODULE_SERVICE_STATUSES = ['LIVE', 'DEGRADED', 'BLOCKED', 'UNAVAILABLE'] as const;
export type ModuleServiceStatus = (typeof MODULE_SERVICE_STATUSES)[number];

/** What does the caller need in order to use it? */
export const MODULE_ACCESS_STATUSES = [
  'OPEN',
  'AUTHENTICATED',
  'PROTECTED',
  'APPROVAL_REQUIRED',
] as const;
export type ModuleAccessStatus = (typeof MODULE_ACCESS_STATUSES)[number];

/** Is the business capability switched on? */
export const MODULE_ACTIVATION_STATUSES = [
  'ACTIVE',
  'DORMANT',
  'READ_ONLY',
  'DRY_RUN',
  'NOT_CONFIGURED',
] as const;
export type ModuleActivationStatus = (typeof MODULE_ACTIVATION_STATUSES)[number];

export const MODULE_CATEGORIES = ['TRUST_CENTRE', 'COMMERCE_OS', 'READINESS'] as const;
export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

/**
 * Risk class drives how hard the activation gate is. HIGH means a real-world
 * side effect — money, a customer message, a provider delivery — so the module
 * ships operational but never self-activates.
 */
export const MODULE_RISK_CLASSES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ModuleRiskClass = (typeof MODULE_RISK_CLASSES)[number];

/**
 * How a module reaches ACTIVE.
 *   AUTOMATIC        — active as soon as its dependencies are healthy
 *   OPERATOR_CONFIG  — needs governed configuration a human must supply
 *   OPERATOR_APPROVAL— needs an explicit recorded approval
 *   PROVIDER_CONFIG  — needs external provider credentials
 */
export const MODULE_ACTIVATION_POLICIES = [
  'AUTOMATIC',
  'OPERATOR_CONFIG',
  'OPERATOR_APPROVAL',
  'PROVIDER_CONFIG',
] as const;
export type ModuleActivationPolicy = (typeof MODULE_ACTIVATION_POLICIES)[number];

/** A dependency the readiness service probes for real. */
export interface ModuleDataDependency {
  /** Logical dependency name, e.g. "postgres". */
  readonly name: string;
  /** Table that must exist and be queryable for the module to function. */
  readonly table?: string;
}

export interface ModuleAction {
  readonly key: string;
  readonly label: string;
  /** Route the button navigates to, or API endpoint it calls. */
  readonly target: string;
  /** Permission the actor needs; absent means "any authenticated admin". */
  readonly requiredPermission?: string;
  /** A read action never mutates and is safe to offer by default. */
  readonly kind: 'READ' | 'WRITE' | 'APPROVE' | 'DIAGNOSTIC';
}

export interface ControlCentreModule {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: ModuleCategory;
  /** Admin page this card deep-links to. Must resolve to a real route. */
  readonly adminRoute: string;
  /** Mounted API prefix the readiness service probes. */
  readonly apiMount: string;
  readonly primaryApiEndpoints: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly optionalPermissions: readonly string[];
  readonly dataDependencies: readonly ModuleDataDependency[];
  /** External providers. Absent credentials => DORMANT, never UNAVAILABLE. */
  readonly providerDependencies: readonly string[];
  readonly activationPolicy: ModuleActivationPolicy;
  readonly supportedActions: readonly ModuleAction[];
  readonly riskClass: ModuleRiskClass;
  /**
   * Whether the module performs real-world side effects when active. `false`
   * means it is inherently read-only and can never mutate the outside world.
   */
  readonly liveMode: boolean;
  readonly owner: string;
  readonly runbookLink: string;
}

// Canonical permission names (dotted) — the SAME vocabulary sessions carry.
// The old constant-style literals (PERMISSIONS.ORDERS_READ) never matched a session's
// 'orders.read', so every Trust Centre module read as permission-denied.
const P = {
  PRODUCTS_READ: PERMISSIONS.PRODUCTS_READ,
  ORDERS_READ: PERMISSIONS.ORDERS_READ,
  RECOMMENDATIONS_READ: PERMISSIONS.RECOMMENDATIONS_READ,
  REPORTS_READ: PERMISSIONS.REPORTS_READ,
  SETTINGS_MANAGE: PERMISSIONS.SETTINGS_MANAGE,
  CUSTOMER_DNA_READ: PERMISSIONS.CUSTOMER_DNA_READ,
  NBA_READ: PERMISSIONS.NBA_READ,
  DECISION_INTELLIGENCE_READ: PERMISSIONS.DECISION_INTELLIGENCE_READ,
  AUTOMATION_READ: PERMISSIONS.AUTOMATION_READ,
  SURVEYS_READ: PERMISSIONS.SURVEYS_READ,
  COPY_QUALITY_READ: PERMISSIONS.COPY_QUALITY_READ,
  INTERVENTIONS_READ: PERMISSIONS.INTERVENTIONS_READ,
  EXPERIMENTS_READ: PERMISSIONS.EXPERIMENTS_READ,
  PRICING_READ: PERMISSIONS.PRICING_READ,
  FRAUD_READ: PERMISSIONS.FRAUD_READ,
  PIM_READ: PERMISSIONS.PIM_READ,
  INVENTORY_READ: PERMISSIONS.INVENTORY_READ,
  AUDIT_READ: PERMISSIONS.AUDIT_READ,
  ANALYTICS_READ: PERMISSIONS.ANALYTICS_READ,
} as const;

export const CONTROL_CENTRE_MODULES: readonly ControlCentreModule[] = [
  // ─── Trust Centre ─────────────────────────────────────────────────────────
  {
    key: 'products',
    displayName: 'Products',
    description: 'Catalogue content, pricing and availability before it reaches the public shop.',
    category: 'TRUST_CENTRE',
    adminRoute: '/admin/products',
    apiMount: '/admin/products',
    primaryApiEndpoints: ['/admin/products', '/products'],
    requiredPermissions: [P.PRODUCTS_READ],
    optionalPermissions: [PERMISSIONS.PRODUCTS_WRITE, PERMISSIONS.PRODUCTS_PUBLISH],
    dataDependencies: [{ name: 'postgres', table: 'products' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open products', target: '/admin/products', kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: true,
    owner: 'catalogue',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'orders',
    displayName: 'Orders',
    description: 'Protected order records, payment evidence and fulfilment state.',
    category: 'TRUST_CENTRE',
    adminRoute: '/admin/orders',
    apiMount: '/governance',
    primaryApiEndpoints: ['/governance/admin/orders', '/governance/admin/stats'],
    requiredPermissions: [P.ORDERS_READ],
    optionalPermissions: [PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.PAYMENTS_READ],
    dataDependencies: [{ name: 'postgres', table: 'orders' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open orders', target: '/admin/orders', requiredPermission: P.ORDERS_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'commerce',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'recommendations',
    displayName: 'Recommendations',
    description: 'Deterministic catalogue recommendations, rules, exclusions and reason codes.',
    category: 'TRUST_CENTRE',
    adminRoute: '/admin/recommendations',
    apiMount: '/admin/recommendations',
    primaryApiEndpoints: ['/admin/recommendations', '/recommendations'],
    requiredPermissions: [P.RECOMMENDATIONS_READ],
    optionalPermissions: [PERMISSIONS.RECOMMENDATIONS_MANAGE],
    dataDependencies: [{ name: 'postgres', table: 'products' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'preview', label: 'Open read-only preview', target: '/admin/recommendations/preview', kind: 'READ' },
    ],
    riskClass: 'LOW',
    liveMode: false,
    owner: 'discovery',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'measurement',
    displayName: 'Measurement',
    description: 'Consent-safe measurement, attribution, reconciliation and provider routing readiness.',
    category: 'TRUST_CENTRE',
    adminRoute: '/admin/measurement-control-tower',
    apiMount: '/admin/measurement-control-tower',
    primaryApiEndpoints: ['/admin/measurement-control-tower', '/admin/measurement'],
    requiredPermissions: [P.REPORTS_READ],
    optionalPermissions: [P.SETTINGS_MANAGE],
    dataDependencies: [{ name: 'postgres', table: 'purchase_measurement_events' }],
    providerDependencies: ['meta', 'google', 'tiktok'],
    activationPolicy: 'PROVIDER_CONFIG',
    supportedActions: [
      { key: 'open', label: 'Open Control Tower', target: '/admin/measurement-control-tower', requiredPermission: P.REPORTS_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'measurement',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'support',
    displayName: 'Support operations',
    description: 'First-party support inbox, case workflow, SLA clock and audit trail.',
    category: 'TRUST_CENTRE',
    adminRoute: '/admin/support',
    apiMount: '/governance',
    primaryApiEndpoints: ['/governance/admin/support/inbox'],
    requiredPermissions: [P.REPORTS_READ],
    optionalPermissions: [P.SETTINGS_MANAGE],
    dataDependencies: [{ name: 'postgres', table: 'support_issues' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open support inbox', target: '/admin/support', requiredPermission: P.REPORTS_READ, kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: true,
    owner: 'support',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'legal',
    displayName: 'Legal and policy',
    description: 'Privacy, terms and returns policy versions with publish workflow and public-route parity.',
    category: 'TRUST_CENTRE',
    adminRoute: '/admin/legal',
    apiMount: '/governance',
    primaryApiEndpoints: ['/governance/legal/policies'],
    requiredPermissions: [P.REPORTS_READ],
    optionalPermissions: [P.SETTINGS_MANAGE],
    dataDependencies: [{ name: 'postgres', table: 'legal_policies' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open legal and policy', target: '/admin/legal', kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: false,
    owner: 'governance',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'locations',
    displayName: 'Locations and delivery addresses',
    description: 'Verified gazetteer, address capture, search learning loop, landmarks, pickup points and zone policy.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/locations',
    apiMount: '/admin/locations',
    primaryApiEndpoints: ['/admin/locations/misses', '/admin/locations/review-queue'],
    requiredPermissions: [P.REPORTS_READ],
    optionalPermissions: [P.SETTINGS_MANAGE, P.ORDERS_READ],
    dataDependencies: [{ name: 'postgres', table: 'ug_area' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open locations workspace', target: '/admin/locations', requiredPermission: P.REPORTS_READ, kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: true,
    owner: 'discovery',
    runbookLink: '/docs/location-module-brief.md',
  },
  {
    key: 'loyalty',
    displayName: 'Loyalty and rewards',
    description: 'Points ledger, earn and redemption rules, balances, liability and adjustments.',
    category: 'TRUST_CENTRE',
    adminRoute: '/admin/loyalty',
    apiMount: '/admin/loyalty',
    primaryApiEndpoints: ['/admin/loyalty/operations'],
    requiredPermissions: [P.SETTINGS_MANAGE],
    optionalPermissions: [P.REPORTS_READ],
    dataDependencies: [{ name: 'postgres', table: 'loyalty_ledger_entries' }],
    providerDependencies: [],
    // The ledger is operational; the commercial programme needs a governed,
    // approved policy before any value is issued. LIVE + DORMANT, not COMING SOON.
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open loyalty operations', target: '/admin/loyalty', requiredPermission: P.SETTINGS_MANAGE, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'loyalty',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },

  // ─── Commerce OS ──────────────────────────────────────────────────────────
  {
    key: 'commerce-analytics',
    displayName: 'Commerce Analytics',
    description: 'Decision-grade business metrics, trends, comparisons, actions and data quality from the canonical metric catalogue.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/analytics',
    apiMount: '/admin/analytics',
    primaryApiEndpoints: ['/admin/analytics/overview', '/admin/analytics/quality', '/admin/analytics/actions', '/admin/analytics/catalogue'],
    requiredPermissions: [P.ANALYTICS_READ],
    optionalPermissions: [],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open commerce analytics', target: '/admin/analytics', requiredPermission: P.ANALYTICS_READ, kind: 'READ' },
    ],
    riskClass: 'LOW',
    liveMode: false,
    owner: 'intelligence',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'decision-intelligence',
    displayName: 'Decision Intelligence',
    description: 'Decision requests, outputs, reason codes, input snapshots and manual review.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/decision-intelligence',
    apiMount: '/admin/decision-intelligence',
    primaryApiEndpoints: ['/admin/decision-intelligence'],
    requiredPermissions: [P.DECISION_INTELLIGENCE_READ],
    optionalPermissions: [PERMISSIONS.DECISION_INTELLIGENCE_EVALUATE, PERMISSIONS.DECISION_INTELLIGENCE_MANAGE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open decision intelligence', target: '/admin/decision-intelligence', requiredPermission: P.DECISION_INTELLIGENCE_READ, kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: false,
    owner: 'intelligence',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'customer-dna',
    displayName: 'Customer DNA & NBA',
    description: 'Consent-aware profiles, lifecycle stage, segments and next-best-action candidates.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/customer-dna',
    apiMount: '/admin/customer-dna',
    primaryApiEndpoints: ['/admin/customer-dna'],
    requiredPermissions: [P.CUSTOMER_DNA_READ],
    optionalPermissions: [P.NBA_READ, PERMISSIONS.CUSTOMER_DNA_MANAGE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open customer DNA', target: '/admin/customer-dna', requiredPermission: P.CUSTOMER_DNA_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: false,
    owner: 'intelligence',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'shopping-assistant',
    displayName: 'Shopping Assistant',
    description: 'Catalogue-grounded product discovery, requirements capture and comparison.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/recommendations',
    apiMount: '/product-finder',
    primaryApiEndpoints: ['/product-finder'],
    requiredPermissions: [P.RECOMMENDATIONS_READ],
    optionalPermissions: [],
    dataDependencies: [{ name: 'postgres', table: 'products' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open shopping assistant', target: '/admin/recommendations', kind: 'READ' },
    ],
    riskClass: 'LOW',
    liveMode: false,
    owner: 'discovery',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'automation',
    displayName: 'Automation',
    description: 'Triggers, conditions, actions, caps, quiet hours, dry run and execution log.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/automation',
    apiMount: '/admin/automation',
    primaryApiEndpoints: ['/admin/automation'],
    requiredPermissions: [P.AUTOMATION_READ],
    optionalPermissions: [PERMISSIONS.AUTOMATION_APPROVE, PERMISSIONS.AUTOMATION_EXECUTE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    // The engine runs; outbound delivery stays approval-gated.
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open automation', target: '/admin/automation', requiredPermission: P.AUTOMATION_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'automation',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'surveys',
    displayName: 'Surveys',
    description: 'NPS, CSAT and CES surveys with audience rules, approval and analytics.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/surveys',
    apiMount: '/admin/surveys',
    primaryApiEndpoints: ['/admin/surveys'],
    requiredPermissions: [P.SURVEYS_READ],
    optionalPermissions: [PERMISSIONS.SURVEYS_APPROVE, PERMISSIONS.SURVEYS_ACTIVATE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open surveys', target: '/admin/surveys', requiredPermission: P.SURVEYS_READ, kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: true,
    owner: 'insights',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'copy-quality',
    displayName: 'Copy Quality',
    description: 'Clarity, overclaim, disclaimer, tone and policy-risk checks with human approval.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/copy-quality',
    apiMount: '/admin/copy-quality',
    primaryApiEndpoints: ['/admin/copy-quality'],
    requiredPermissions: [P.COPY_QUALITY_READ],
    optionalPermissions: [PERMISSIONS.COPY_QUALITY_EXPORT],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open copy quality', target: '/admin/copy-quality', requiredPermission: P.COPY_QUALITY_READ, kind: 'READ' },
    ],
    riskClass: 'LOW',
    liveMode: false,
    owner: 'content',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'behavioural-interventions',
    displayName: 'Behavioural Interventions',
    description: 'Intervention design, ethical review, consent basis, risk class and stop conditions.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/behavioural-interventions',
    apiMount: '/admin/behavioural-interventions',
    primaryApiEndpoints: ['/admin/behavioural-interventions'],
    requiredPermissions: [P.INTERVENTIONS_READ],
    optionalPermissions: [PERMISSIONS.INTERVENTIONS_APPROVE, PERMISSIONS.INTERVENTIONS_ACTIVATE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open interventions', target: '/admin/behavioural-interventions', requiredPermission: P.INTERVENTIONS_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'experience',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'experiments',
    displayName: 'Experiments',
    description: 'Variants, stable assignment, exposure logging, guardrail metrics and rollback.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/experiments',
    apiMount: '/admin/experiments',
    primaryApiEndpoints: ['/admin/experiments'],
    requiredPermissions: [P.EXPERIMENTS_READ],
    optionalPermissions: [PERMISSIONS.EXPERIMENTS_MANAGE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open experiments', target: '/admin/experiments', requiredPermission: P.EXPERIMENTS_READ, kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: true,
    owner: 'experimentation',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'pricing',
    displayName: 'Pricing & Promotions',
    description: 'Price and promotion rules, floor and margin guards, checkout parity and rollback.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/pricing',
    apiMount: '/admin/pricing',
    primaryApiEndpoints: ['/admin/pricing'],
    requiredPermissions: [P.PRICING_READ],
    optionalPermissions: [PERMISSIONS.PRICING_APPROVE, PERMISSIONS.PRICING_ACTIVATE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open pricing', target: '/admin/pricing', requiredPermission: P.PRICING_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'commerce',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'fraud',
    displayName: 'Fraud Triage',
    description: 'Signals, cases, severity, assignment, evidence and decision reason codes.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/fraud',
    apiMount: '/admin/fraud',
    primaryApiEndpoints: ['/admin/fraud'],
    requiredPermissions: [P.FRAUD_READ],
    optionalPermissions: [PERMISSIONS.FRAUD_DECIDE, PERMISSIONS.FRAUD_ASSIGN],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open fraud triage', target: '/admin/fraud', requiredPermission: P.FRAUD_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'risk',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'pim-import',
    displayName: 'PIM Import',
    description: 'Upload, mapping, validation, dry-run diff, approval and transactional commit.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/pim-imports',
    apiMount: '/admin/pim-imports',
    primaryApiEndpoints: ['/admin/pim-imports'],
    requiredPermissions: [P.PIM_READ],
    optionalPermissions: [PERMISSIONS.PIM_APPROVE, PERMISSIONS.PIM_APPLY, PERMISSIONS.PIM_ROLLBACK],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open PIM import', target: '/admin/pim-imports', requiredPermission: P.PIM_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'catalogue',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'loyalty-os',
    displayName: 'Loyalty',
    description: 'Earn and redeem simulation, rule explanations, liability view and fraud flags.',
    category: 'COMMERCE_OS',
    // Deliberately the same domain and API as the Trust Centre loyalty card.
    // There is exactly one loyalty system.
    adminRoute: '/admin/loyalty',
    apiMount: '/admin/loyalty',
    primaryApiEndpoints: ['/admin/loyalty/operations'],
    requiredPermissions: [P.SETTINGS_MANAGE],
    optionalPermissions: [P.REPORTS_READ],
    dataDependencies: [{ name: 'postgres', table: 'loyalty_ledger_entries' }],
    providerDependencies: [],
    activationPolicy: 'OPERATOR_APPROVAL',
    supportedActions: [
      { key: 'open', label: 'Open loyalty operations', target: '/admin/loyalty', requiredPermission: P.SETTINGS_MANAGE, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'loyalty',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'search-insights',
    displayName: 'Search Insights',
    description: 'Search terms, no-result and low-result searches, demand gaps and trends.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/demand',
    apiMount: '/admin/search-demand',
    primaryApiEndpoints: ['/admin/search-demand'],
    requiredPermissions: [P.REPORTS_READ],
    optionalPermissions: [],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open search insights', target: '/admin/demand', requiredPermission: P.REPORTS_READ, kind: 'READ' },
    ],
    riskClass: 'LOW',
    liveMode: false,
    owner: 'discovery',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'inventory-fulfilment',
    displayName: 'Inventory & Fulfilment',
    description: 'Inventory ledger, reservations, oversell protection, packing, dispatch and SLA.',
    category: 'COMMERCE_OS',
    adminRoute: '/admin/inventory',
    apiMount: '/admin/inventory',
    primaryApiEndpoints: ['/admin/inventory', '/admin/fulfilment'],
    requiredPermissions: [P.INVENTORY_READ],
    optionalPermissions: [PERMISSIONS.INVENTORY_ADJUST],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open inventory', target: '/admin/inventory', requiredPermission: P.INVENTORY_READ, kind: 'READ' },
      { key: 'fulfilment', label: 'Open fulfilment', target: '/admin/fulfilment', requiredPermission: P.INVENTORY_READ, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'operations',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },

  // ─── Readiness entry points ───────────────────────────────────────────────
  {
    key: 'measurement-control-tower',
    displayName: 'Measurement Control Tower',
    description: 'Event intake, queue and DLQ state, consent, attribution, routing and reconciliation.',
    category: 'READINESS',
    adminRoute: '/admin/measurement-control-tower',
    apiMount: '/admin/measurement-control-tower',
    primaryApiEndpoints: ['/admin/measurement-control-tower'],
    requiredPermissions: [P.REPORTS_READ],
    optionalPermissions: [P.SETTINGS_MANAGE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open Control Tower', target: '/admin/measurement-control-tower', requiredPermission: P.REPORTS_READ, kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: false,
    owner: 'measurement',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'release-readiness',
    displayName: 'Release readiness',
    description: 'Current release-readiness checks, gate acknowledgements and decision records.',
    category: 'READINESS',
    adminRoute: '/admin/release-readiness',
    apiMount: '/admin/release-readiness',
    primaryApiEndpoints: ['/admin/release-readiness'],
    requiredPermissions: [P.REPORTS_READ],
    optionalPermissions: [P.SETTINGS_MANAGE],
    dataDependencies: [{ name: 'postgres' }],
    providerDependencies: [],
    activationPolicy: 'AUTOMATIC',
    supportedActions: [
      { key: 'open', label: 'Open release readiness', target: '/admin/release-readiness', requiredPermission: P.REPORTS_READ, kind: 'READ' },
    ],
    riskClass: 'MEDIUM',
    liveMode: false,
    owner: 'release',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
  {
    key: 'provider-readiness',
    displayName: 'WhatsApp & Google readiness',
    description: 'Credential presence, handshake state, webhook registration and delivery switch.',
    category: 'READINESS',
    adminRoute: '/admin/settings',
    apiMount: '/admin/measurement',
    primaryApiEndpoints: ['/admin/measurement/gtm'],
    requiredPermissions: [P.SETTINGS_MANAGE],
    optionalPermissions: [],
    dataDependencies: [],
    // Absent credentials make this NOT_CONFIGURED, never UNAVAILABLE: the
    // readiness capability itself is working when it can truthfully say so.
    providerDependencies: ['whatsapp', 'google'],
    activationPolicy: 'PROVIDER_CONFIG',
    supportedActions: [
      { key: 'open', label: 'Open provider settings', target: '/admin/settings', requiredPermission: P.SETTINGS_MANAGE, kind: 'READ' },
    ],
    riskClass: 'HIGH',
    liveMode: true,
    owner: 'measurement',
    runbookLink: '/docs/handover/claude/CONTROL_CENTRE_PRODUCTION_RUNBOOK.md',
  },
] as const;

export const CONTROL_CENTRE_MODULE_KEYS = CONTROL_CENTRE_MODULES.map((m) => m.key);

export function getControlCentreModule(key: string): ControlCentreModule | undefined {
  return CONTROL_CENTRE_MODULES.find((m) => m.key === key);
}

export function controlCentreModulesByCategory(
  category: ModuleCategory,
): readonly ControlCentreModule[] {
  return CONTROL_CENTRE_MODULES.filter((m) => m.category === category);
}

/** Runtime status of one module, computed by the readiness service. */
export interface ModuleReadinessResult {
  readonly moduleKey: string;
  readonly displayName: string;
  readonly category: ModuleCategory;
  readonly serviceStatus: ModuleServiceStatus;
  readonly accessStatus: ModuleAccessStatus;
  readonly activationStatus: ModuleActivationStatus;
  readonly lastCheckedAt: string;
  readonly latencyMs: number;
  readonly contractVersion: string;
  readonly requiredPermissions: readonly string[];
  readonly dependencies: readonly {
    readonly name: string;
    readonly status: 'UP' | 'DOWN' | 'UNKNOWN';
    readonly detail?: string;
  }[];
  readonly availableActions: readonly ModuleAction[];
  readonly degradedReasons: readonly string[];
  readonly deepLink: string;
  readonly traceId: string;
}

export const CONTROL_CENTRE_CONTRACT_VERSION = '1.0.0';

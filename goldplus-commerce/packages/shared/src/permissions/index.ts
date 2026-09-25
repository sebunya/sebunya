export const PERMISSIONS = {
  AUTH_MANAGE: 'auth.manage',
  ROLES_MANAGE: 'roles.manage',
  PERMISSIONS_MANAGE: 'permissions.manage',
  AUDIT_READ: 'audit.read',
  AUDIT_EXPORT: 'audit.export',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_WRITE: 'products.write',
  PRODUCTS_PUBLISH: 'products.publish',
  CATEGORIES_MANAGE: 'categories.manage',
  // Homepage hero slider (2026-08-07). READ views the campaign library;
  // MANAGE edits copy, prices, images and rotation. Its own right because the
  // hero is the most visible surface on the site and marketing owns it.
  HERO_READ: 'hero.read',
  HERO_MANAGE: 'hero.manage',
  NAV_READ: 'nav.read',
  NAV_MANAGE: 'nav.manage',
  // Supplier cost. Its own right, separate from retail pricing, because
  // CLAUDE.md forbids supplier cost from ever reaching a public API and the
  // people who set shelf prices are not always the people who see margin.
  // READ exposes what a product costs; MANAGE changes it.
  PRODUCT_COSTS_READ: 'product_costs.read',
  PRODUCT_COSTS_MANAGE: 'product_costs.manage',
  PRICING_MANAGE: 'pricing.manage',
  PRICING_READ: 'pricing.read',
  PRICING_CREATE: 'pricing.create',
  PRICING_APPROVE: 'pricing.approve',
  PRICING_ACTIVATE: 'pricing.activate',
  PRICING_SIMULATE: 'pricing.simulate',
  PRICING_PAUSE: 'pricing.pause',
  // U1 — promotions & coupons admin surface (the promotions domain is the
  // canonical pricing path; these gate the promotions/coupons admin routes).
  PROMOTIONS_READ: 'promotions.read',
  PROMOTIONS_MANAGE: 'promotions.manage',
  // U3 — review moderation queue (approve / reject / flagged view).
  REVIEWS_MODERATE: 'reviews.moderate',
  INVENTORY_READ: 'inventory.read',
  INVENTORY_ADJUST: 'inventory.adjust',
  ORDERS_READ: 'orders.read',
  ORDERS_MANAGE: 'orders.manage',
  PAYMENTS_READ: 'payments.read',
  PAYMENTS_CONFIRM: 'payments.confirm',
  DEALER_APPROVE: 'dealer.approve',
  DEALER_READ_PRIVATE: 'dealer.read_private',
  QUOTES_MANAGE: 'quotes.manage',
  LEADS_ASSIGN: 'leads.assign',
  CAMPAIGNS_MANAGE: 'campaigns.manage',
  CREATIVES_APPROVE: 'creatives.approve',
  FEEDS_PUBLISH: 'feeds.publish',
  ATTRIBUTION_READ: 'attribution.read',
  REPORTS_READ: 'reports.read',
  SETTINGS_MANAGE: 'settings.manage',
  NOTIFICATIONS_READ: 'notifications.read',
  RECOMMENDATIONS_READ: 'recommendations.read',
  RECOMMENDATIONS_MANAGE: 'recommendations.manage',
  CUSTOMER_DNA_READ: 'customer_dna.read',
  CUSTOMER_DNA_MANAGE: 'customer_dna.manage',
  NBA_READ: 'nba.read',
  NBA_RECOMPUTE: 'nba.recompute',
  IDENTITY_REVIEW: 'identity.review',
  // First-party data (0157). Seeing ONE customer's full profile (contact
  // details, timeline, consents) is its own right, separate from reading
  // aggregate customer intelligence, and every view is audited. Carrying out a
  // customer's deletion or anonymisation request is a third, rarer right.
  CUSTOMER_DATA_VIEW: 'customer_data.view',
  PRIVACY_REQUESTS_MANAGE: 'privacy_requests.manage',
  DECISION_INTELLIGENCE_READ: 'decision_intelligence.read',
  DECISION_INTELLIGENCE_EVALUATE: 'decision_intelligence.evaluate',
  DECISION_INTELLIGENCE_ASSIGN: 'decision_intelligence.assign',
  DECISION_INTELLIGENCE_MANAGE: 'decision_intelligence.manage',
  AUTOMATION_READ: 'automation.read',
  AUTOMATION_CREATE: 'automation.create',
  AUTOMATION_MANAGE: 'automation.manage',
  AUTOMATION_APPROVE: 'automation.approve',
  AUTOMATION_EXECUTE: 'automation.execute',
  AUTOMATION_REPLAY: 'automation.replay',
  AUTOMATION_RECONCILE: 'automation.reconcile',
  EXPERIMENTS_READ: 'experiments.read',
  EXPERIMENTS_MANAGE: 'experiments.manage',
  EXPERIMENTS_ASSIGN: 'experiments.assign',
  FRAUD_READ: 'fraud.read',
  FRAUD_SIGNAL: 'fraud.signal',
  FRAUD_ASSIGN: 'fraud.assign',
  FRAUD_DECIDE: 'fraud.decide',
  PIM_READ: 'pim.read',
  PIM_CREATE: 'pim.create',
  PIM_MAP: 'pim.map',
  PIM_APPROVE: 'pim.approve',
  PIM_APPLY: 'pim.apply',
  PIM_ROLLBACK: 'pim.rollback',
  SURVEYS_READ: 'surveys.read',
  SURVEYS_CREATE: 'surveys.create',
  SURVEYS_MANAGE: 'surveys.manage',
  SURVEYS_APPROVE: 'surveys.approve',
  SURVEYS_ACTIVATE: 'surveys.activate',
  SURVEYS_EXPORT: 'surveys.export',
  COPY_QUALITY_READ: 'copy_quality.read',
  COPY_QUALITY_EXPORT: 'copy_quality.export',
  INTERVENTIONS_READ: 'interventions.read',
  INTERVENTIONS_CREATE: 'interventions.create',
  INTERVENTIONS_MANAGE: 'interventions.manage',
  INTERVENTIONS_APPROVE: 'interventions.approve',
  INTERVENTIONS_ACTIVATE: 'interventions.activate',
  ANALYTICS_READ: 'analytics.read',
  ANALYTICS_MANAGE: 'analytics.manage',
  ANALYTICS_EXPORT: 'analytics.export',
  ANALYTICS_ALERTS_MANAGE: 'analytics.alerts.manage',
  // Wave 2B — media library (DAM). Granted to PLATFORM_ADMINISTRATOR automatically by
  // the boot-time registry sync.
  MEDIA_READ: 'media.read',
  MEDIA_MANAGE: 'media.manage',
  // Wave 2C — legal policy CMS. approve is deliberately separate from manage so
  // maker/checker can be enforced at the role level as well as in the use case.
  LEGAL_READ: 'legal.read',
  LEGAL_MANAGE: 'legal.manage',
  LEGAL_APPROVE: 'legal.approve',
  // Wave 2E-3 — notification template wording overrides (draft/publish/revert).
  NOTIFICATIONS_MANAGE: 'notifications.manage',
  // Delivery estimation (brief v7, PART 6). Read, propose and publish are three
  // separate rights on purpose: the nightly calibration proposes, an operator
  // reads, and only a publisher makes a fee change live. Applying a variance to
  // a placed order is its own right again, because it changes what a specific
  // customer has already been told they will pay.
  DELIVERY_CONFIG_READ: 'delivery_config.read',
  DELIVERY_CONFIG_PROPOSE: 'delivery_config.propose',
  DELIVERY_CONFIG_PUBLISH: 'delivery_config.publish',
  DELIVERY_VARIANCE_APPLY: 'delivery_variance.apply',
  // Organic Growth OS (Phase 2). VIEW opens every read surface; each mutating
  // area carries its own manage right so competitor curation, SERP evidence
  // entry and technical changes can be granted separately. audit.run starts a
  // first-party crawl or opportunity generation (compute, no external send);
  // approve_high_risk exists so HIGH-risk technical changes (redirects,
  // robots) can require a second person, mirroring the maker/checker split
  // used by legal and pricing.
  SEO_VIEW: 'seo.view',
  SEO_AUDIT_RUN: 'seo.audit.run',
  SEO_METADATA_MANAGE: 'seo.metadata.manage',
  SEO_REDIRECTS_MANAGE: 'seo.redirects.manage',
  SEO_ROBOTS_MANAGE: 'seo.robots.manage',
  SEO_COMPETITORS_MANAGE: 'seo.competitors.manage',
  SEO_SERP_MANAGE: 'seo.serp.manage',
  SEO_INTEGRATIONS_MANAGE: 'seo.integrations.manage',
  // Integrations control plane (0118): connecting a provider, handling raw
  // credentials, and running the experimental custom read-only connector are
  // separately dangerous acts, so each carries its own right.
  SEO_INTEGRATIONS_CONNECT: 'seo.integrations.connect',
  SEO_INTEGRATIONS_CREDENTIALS: 'seo.integrations.credentials',
  SEO_INTEGRATIONS_CUSTOM_CONNECTOR: 'seo.integrations.custom_connector',
  SEO_EXPERIMENTS_MANAGE: 'seo.experiments.manage',
  SEO_APPROVE_HIGH_RISK: 'seo.approve_high_risk',
  // AI Search Visibility (0131). Reading evidence, configuring a project,
  // spending provider budget, approving spend/actions and handling provider
  // API keys are five different acts with five different risks.
  AI_VISIBILITY_VIEW: 'ai_visibility.view',
  AI_VISIBILITY_MANAGE: 'ai_visibility.manage',
  AI_VISIBILITY_RUN: 'ai_visibility.run',
  AI_VISIBILITY_APPROVE: 'ai_visibility.approve',
  AI_VISIBILITY_CREDENTIALS: 'ai_visibility.credentials',
  // Measurement delivery operations (0140/0141, dossier §10.3): reading the
  // delivery queue, replaying/quarantining deliveries, and the kill switch are
  // three different powers.
  MEASUREMENT_DELIVERY_READ: 'measurement.delivery.read',
  MEASUREMENT_REPLAY: 'measurement.replay',
  MEASUREMENT_KILL: 'measurement.kill',
  // Payments brief 2026-08-06: giving money back is its own right, separate
  // from reading payments and from confirming them. If money has been taken
  // wrongly there must be a way to return it, and that way must be guarded.
  PAYMENTS_REFUND: 'payments.refund',
  // Battery catalogue, devices, compatibility and finder (2026-08-26). Four
  // responsibilities, four rights: a catalogue editor records batteries and
  // aliases; a device editor owns brands, series and exact models; anyone who
  // may PROPOSE a compatibility claim cannot VERIFY one (maker/checker is
  // enforced in the use case); a publisher decides what customers see. Demand
  // triage (no-result searches, battery requests) is its own right so support
  // staff can work the queue without editing the catalogue. Stock movements use
  // inventory.adjust, unit costs product_costs.manage, imports pim.*.
  BATTERIES_READ: 'batteries.read',
  BATTERIES_CATALOGUE_MANAGE: 'batteries.catalogue.manage',
  BATTERIES_DEVICES_MANAGE: 'batteries.devices.manage',
  BATTERIES_COMPAT_PROPOSE: 'batteries.compatibility.propose',
  BATTERIES_COMPAT_VERIFY: 'batteries.compatibility.verify',
  BATTERIES_PUBLISH: 'batteries.publish',
  BATTERIES_DEMAND_MANAGE: 'batteries.demand.manage',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Governance role vocabulary (§6). PLATFORM_ADMINISTRATOR receives the full
 * registry from the boot sync; LEGAL_REVIEWER carries the legal review/approve
 * baseline; the rest are named-but-empty pending business decisions.
 */
export const PLATFORM_ADMINISTRATOR_ROLE = 'PLATFORM_ADMINISTRATOR';
export const LEGACY_FULL_ACCESS_ROLE = 'Owner';
export const GOVERNANCE_ROLES = [
  PLATFORM_ADMINISTRATOR_ROLE,
  'PLATFORM_OPERATOR',
  'COMMERCIAL_MANAGER',
  'MERCHANDISING_MANAGER',
  'FULFILMENT_MANAGER',
  'MARKETING_MANAGER',
  'ANALYST',
  'SUPPORT_OPERATOR',
  'LEGAL_REVIEWER',
  'SECURITY_ADMIN',
  'READ_ONLY_AUDITOR',
] as const;

export type GovernanceRole = (typeof GOVERNANCE_ROLES)[number];

/**
 * Role management (2026-09-12, owner decision: every role defined, roles
 * manageable in the Back Office). Two full-access roles are SYSTEM roles:
 * their permission set is the whole registry, they cannot be edited or
 * deleted, and granting one always goes through the maker/checker request.
 * Every other role is editable in the Back Office. The baselines below are
 * what a role holds the FIRST time it is seen with no permissions at all;
 * after that the Back Office is the authority and the boot sync never
 * overwrites an operator's edit.
 */
export const FULL_ACCESS_ROLES = [PLATFORM_ADMINISTRATOR_ROLE, LEGACY_FULL_ACCESS_ROLE] as const;
export const ROLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{2,49}$/;

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  PLATFORM_ADMINISTRATOR: "Every permission. Granted only through a second administrator's approval.",
  Owner: 'Legacy full-access role held by the founding accounts. Every permission.',
  PLATFORM_OPERATOR: 'Keeps the platform running: queues, notifications, automation runs, settings, audit; reads orders and payments.',
  COMMERCIAL_MANAGER: 'Owns the commercial catalogue: products, categories, retail pricing and its approvals, supplier cost, promotions, dealers, quotes and feeds.',
  MERCHANDISING_MANAGER: 'Owns what customers see: product listings, hero, navigation, media, recommendations, imports, copy quality, batteries and reviews.',
  FULFILMENT_MANAGER: 'Works orders from paid to delivered: order management, stock adjustments, delivery configuration proposals and variances.',
  MARKETING_MANAGER: 'Owns campaigns, creatives, hero, promotions, experiments, surveys, interventions, attribution and growth analytics.',
  ANALYST: 'Read-only across reports, analytics, attribution, audit, customer intelligence, orders, payments and the catalogue.',
  SUPPORT_OPERATOR: 'Serves customers: reads and manages orders, reads payments, works quotes, battery requests, identity reviews and review moderation.',
  LEGAL_REVIEWER: 'Reads and approves legal policy wording.',
  SECURITY_ADMIN: 'Manages accounts, roles and permissions, reads and exports audit, works fraud cases and identity reviews.',
  READ_ONLY_AUDITOR: 'Reads everything, changes nothing. Audit export included.',
};

const P = PERMISSIONS;
const READ_ONLY_SET: readonly Permission[] = [
  P.AUDIT_READ, P.AUDIT_EXPORT, P.PRODUCTS_READ, P.PRICING_READ, P.PRODUCT_COSTS_READ, P.PROMOTIONS_READ,
  P.INVENTORY_READ, P.ORDERS_READ, P.PAYMENTS_READ, P.HERO_READ, P.NAV_READ, P.NOTIFICATIONS_READ,
  P.RECOMMENDATIONS_READ, P.CUSTOMER_DNA_READ, P.NBA_READ, P.DECISION_INTELLIGENCE_READ, P.AUTOMATION_READ,
  P.EXPERIMENTS_READ, P.FRAUD_READ, P.PIM_READ, P.SURVEYS_READ, P.COPY_QUALITY_READ, P.INTERVENTIONS_READ,
  P.ANALYTICS_READ, P.MEDIA_READ, P.LEGAL_READ, P.DELIVERY_CONFIG_READ, P.SEO_VIEW, P.AI_VISIBILITY_VIEW, P.BATTERIES_READ,
  P.REPORTS_READ, P.ATTRIBUTION_READ, P.DEALER_READ_PRIVATE,
];

export const ROLE_PERMISSION_BASELINES: Record<GovernanceRole, readonly Permission[]> = {
  PLATFORM_ADMINISTRATOR: Object.values(P),
  PLATFORM_OPERATOR: [
    P.AUDIT_READ, P.AUDIT_EXPORT, P.NOTIFICATIONS_READ, P.NOTIFICATIONS_MANAGE, P.SETTINGS_MANAGE, P.REPORTS_READ,
    P.AUTOMATION_READ, P.AUTOMATION_EXECUTE, P.AUTOMATION_REPLAY, P.AUTOMATION_RECONCILE,
    P.DELIVERY_CONFIG_READ, P.ORDERS_READ, P.PAYMENTS_READ, P.PRODUCTS_READ, P.INVENTORY_READ, P.ANALYTICS_READ,
    P.MEASUREMENT_DELIVERY_READ, P.MEASUREMENT_REPLAY,
  ],
  COMMERCIAL_MANAGER: [
    P.PRODUCTS_READ, P.PRODUCTS_WRITE, P.PRODUCTS_PUBLISH, P.CATEGORIES_MANAGE,
    P.PRICING_READ, P.PRICING_MANAGE, P.PRICING_CREATE, P.PRICING_APPROVE, P.PRICING_ACTIVATE, P.PRICING_SIMULATE, P.PRICING_PAUSE,
    P.PRODUCT_COSTS_READ, P.PRODUCT_COSTS_MANAGE, P.PROMOTIONS_READ, P.PROMOTIONS_MANAGE,
    P.INVENTORY_READ, P.ORDERS_READ, P.REPORTS_READ, P.ANALYTICS_READ,
    P.DEALER_READ_PRIVATE, P.DEALER_APPROVE, P.QUOTES_MANAGE, P.LEADS_ASSIGN, P.FEEDS_PUBLISH, P.BATTERIES_READ,
  ],
  MERCHANDISING_MANAGER: [
    P.PRODUCTS_READ, P.PRODUCTS_WRITE, P.PRODUCTS_PUBLISH, P.CATEGORIES_MANAGE,
    P.HERO_READ, P.HERO_MANAGE, P.NAV_READ, P.NAV_MANAGE, P.MEDIA_READ, P.MEDIA_MANAGE,
    P.RECOMMENDATIONS_READ, P.RECOMMENDATIONS_MANAGE, P.PROMOTIONS_READ,
    P.PIM_READ, P.PIM_CREATE, P.PIM_MAP, P.PIM_APPROVE, P.PIM_APPLY, P.PIM_ROLLBACK,
    P.COPY_QUALITY_READ, P.COPY_QUALITY_EXPORT, P.REVIEWS_MODERATE, P.INVENTORY_READ,
    P.SEO_VIEW, P.SEO_METADATA_MANAGE, P.FEEDS_PUBLISH,
    P.BATTERIES_READ, P.BATTERIES_CATALOGUE_MANAGE, P.BATTERIES_DEVICES_MANAGE, P.BATTERIES_COMPAT_PROPOSE, P.BATTERIES_PUBLISH,
  ],
  FULFILMENT_MANAGER: [
    P.ORDERS_READ, P.ORDERS_MANAGE, P.INVENTORY_READ, P.INVENTORY_ADJUST, P.PAYMENTS_READ,
    P.DELIVERY_CONFIG_READ, P.DELIVERY_CONFIG_PROPOSE, P.DELIVERY_VARIANCE_APPLY,
    P.NOTIFICATIONS_READ, P.PRODUCTS_READ, P.BATTERIES_READ,
  ],
  MARKETING_MANAGER: [
    P.CAMPAIGNS_MANAGE, P.CREATIVES_APPROVE, P.HERO_READ, P.HERO_MANAGE, P.NAV_READ,
    P.PROMOTIONS_READ, P.PROMOTIONS_MANAGE, P.ATTRIBUTION_READ, P.ANALYTICS_READ, P.ANALYTICS_EXPORT,
    P.SEO_VIEW, P.SEO_COMPETITORS_MANAGE, P.SEO_SERP_MANAGE, P.SEO_METADATA_MANAGE,
    P.AI_VISIBILITY_VIEW, P.AI_VISIBILITY_MANAGE, P.AI_VISIBILITY_RUN,
    P.SURVEYS_READ, P.SURVEYS_CREATE, P.SURVEYS_MANAGE, P.SURVEYS_EXPORT,
    P.INTERVENTIONS_READ, P.INTERVENTIONS_CREATE, P.INTERVENTIONS_MANAGE,
    P.EXPERIMENTS_READ, P.EXPERIMENTS_MANAGE, P.CUSTOMER_DNA_READ, P.NBA_READ, P.RECOMMENDATIONS_READ,
    P.REPORTS_READ, P.NOTIFICATIONS_READ, P.FEEDS_PUBLISH, P.MEDIA_READ, P.PRODUCTS_READ,
  ],
  ANALYST: [
    P.REPORTS_READ, P.ANALYTICS_READ, P.ANALYTICS_EXPORT, P.ATTRIBUTION_READ, P.AUDIT_READ,
    P.CUSTOMER_DNA_READ, P.NBA_READ, P.DECISION_INTELLIGENCE_READ, P.EXPERIMENTS_READ, P.SURVEYS_READ, P.SEO_VIEW, P.AI_VISIBILITY_VIEW,
    P.ORDERS_READ, P.PAYMENTS_READ, P.PRODUCTS_READ, P.INVENTORY_READ, P.PRICING_READ, P.PROMOTIONS_READ,
    P.RECOMMENDATIONS_READ, P.BATTERIES_READ, P.COPY_QUALITY_READ, P.MEASUREMENT_DELIVERY_READ,
  ],
  SUPPORT_OPERATOR: [
    P.ORDERS_READ, P.ORDERS_MANAGE, P.PAYMENTS_READ, P.PRODUCTS_READ, P.INVENTORY_READ, P.NOTIFICATIONS_READ,
    P.QUOTES_MANAGE, P.BATTERIES_READ, P.BATTERIES_DEMAND_MANAGE, P.IDENTITY_REVIEW, P.DELIVERY_CONFIG_READ,
    P.REVIEWS_MODERATE, P.SURVEYS_READ, P.CUSTOMER_DNA_READ, P.CUSTOMER_DATA_VIEW,
  ],
  LEGAL_REVIEWER: [P.LEGAL_READ, P.LEGAL_APPROVE],
  SECURITY_ADMIN: [
    P.AUTH_MANAGE, P.ROLES_MANAGE, P.PERMISSIONS_MANAGE, P.AUDIT_READ, P.AUDIT_EXPORT,
    P.FRAUD_READ, P.FRAUD_SIGNAL, P.FRAUD_ASSIGN, P.FRAUD_DECIDE, P.IDENTITY_REVIEW, P.SETTINGS_MANAGE,
    P.CUSTOMER_DATA_VIEW, P.PRIVACY_REQUESTS_MANAGE,
  ],
  READ_ONLY_AUDITOR: READ_ONLY_SET,
};

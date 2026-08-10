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
  // Payments brief 2026-08-06: giving money back is its own right, separate
  // from reading payments and from confirming them. If money has been taken
  // wrongly there must be a way to return it, and that way must be guarded.
  PAYMENTS_REFUND: 'payments.refund',
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

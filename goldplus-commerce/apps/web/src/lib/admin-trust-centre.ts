export const ADMIN_TRUST_STATUSES = [
  "Live",
  "Ready",
  "No data yet",
  "Protected",
  "Disabled",
  "Dormant",
  "Action required",
  "Review recommended",
] as const;

export type AdminTrustStatus = typeof ADMIN_TRUST_STATUSES[number];

export interface AdminTrustModule {
  id: "products" | "orders" | "recommendations" | "measurement" | "support" | "legal" | "loyalty";
  title: string;
  description: string;
  status: AdminTrustStatus;
  actionLabel: string;
  href?: string;
  actionDisabled?: boolean;
  disabledReason?: string;
  previewHref?: string;
  previewLabel?: string;
  nextStep: string;
  accessNote?: string;
  safetyNote?: string;
}

export interface AdminReadinessItem {
  id: string;
  label: string;
  status: AdminTrustStatus;
  detail: string;
}

export const ADMIN_TRUST_MODULES: readonly AdminTrustModule[] = [
  {
    id: "products",
    title: "Products",
    description: "Manage catalogue content and review product truth before it reaches the public shop.",
    status: "Live",
    actionLabel: "Open products",
    href: "/admin/products",
    nextStep: "Review missing images, prices, availability and verified product details.",
    accessNote: "Catalogue changes remain subject to existing admin permissions.",
  },
  {
    id: "orders",
    title: "Orders",
    description: "Inspect protected order records and the payment status already recorded by the commerce system.",
    status: "Protected",
    actionLabel: "Open orders",
    href: "/admin/orders",
    nextStep: "Verify checkout and provider evidence before any fulfilment decision.",
    accessNote: "Order data requires an authenticated role with order-read access.",
    safetyNote: "This dashboard does not mark orders paid or change payment state.",
  },
  {
    id: "recommendations",
    title: "Recommendations",
    description: "Preview deterministic catalogue recommendations and inspect their supported selection reasons.",
    status: "Live",
    actionLabel: "Open read-only preview",
    href: "/admin/recommendations/preview",
    nextStep: "Choose a product or category context, then review exclusions, fallback reasons and catalogue gaps.",
    safetyNote: "The preview is read-only and does not personalise results or modify catalogue data.",
  },
  {
    id: "measurement",
    title: "Measurement",
    description: "Inspect consent-safe readiness, reconciliation and controlled-activation evidence.",
    status: "Protected",
    actionLabel: "Open Control Tower",
    href: "/admin/measurement-control-tower",
    nextStep: "Resolve readiness warnings and use approved vault flows if credentials are required.",
    accessNote: "Requires the existing Measurement Control Tower permission.",
    safetyNote: "Opening this module does not activate a destination or provider.",
  },
  {
    id: "support",
    title: "Support operations",
    description: "Prepare operator handling for customer questions without implying that a verified ticket queue is connected.",
    status: "Protected",
    actionLabel: "Open support inbox",
    href: "/admin/support",
    nextStep: "Triage open cases, confirm SLA state and record customer-safe responses.",
    accessNote: "Support cases require an authenticated role with reports access.",
    safetyNote: "Optional external connectors are configured separately; the first-party queue operates without them.",
  },
  {
    id: "legal",
    title: "Legal and policy",
    description: "Review the public interim terms and privacy guidance currently available to customers.",
    status: "Live",
    actionLabel: "Review public terms",
    href: "/terms",
    nextStep: "Keep policy copy truthful and schedule formal legal review before making broader promises.",
    safetyNote: "Live means the routes are available; it does not mean lawyer-approved final wording.",
  },
  {
    id: "loyalty",
    title: "Loyalty and rewards",
    description: "Prepare policy and operating safeguards before any rewards programme is introduced.",
    status: "Dormant",
    actionLabel: "Open loyalty operations",
    href: "/admin/loyalty",
    previewHref: "/admin/loyalty",
    previewLabel: "Review ledger foundation",
    nextStep: "Approve programme rules and the liability model to move activation from dormant to active.",
    safetyNote: "The ledger is operational and auditable; no value is issued until an operator approves the policy.",
  },
] as const;

export const ADMIN_READINESS_ITEMS: readonly AdminReadinessItem[] = [
  { id: "storefront", label: "Storefront", status: "Live", detail: "Public homepage and shop are released." },
  { id: "discovery", label: "Product discovery", status: "Live", detail: "Search, filters and catalogue truth safeguards are released." },
  { id: "pdp", label: "PDP trust guidance", status: "Live", detail: "Product truth and safe recommendation fallbacks are released." },
  { id: "checkout", label: "Checkout payment truth", status: "Protected", detail: "Payment and order state remain provider-verified and outside this dashboard." },
  { id: "support", label: "Support and order help", status: "Live", detail: "Public support and order-help routes are available." },
  { id: "legal", label: "Terms and privacy", status: "Live", detail: "Interim public policy routes are available with scoped wording." },
  { id: "recommendations", label: "Recommendations preview", status: "Ready", detail: "Read-only operator preview and deterministic public rails are available." },
  { id: "admin-access", label: "Admin access", status: "Protected", detail: "Existing session and API permission checks remain enforced." },
  { id: "providers", label: "Provider sends", status: "Disabled", detail: "No send or activation is performed by the trust centre." },
  { id: "loyalty", label: "Loyalty programme", status: "Dormant", detail: "Ledger and rules are operational; no value is issued until an operator approves the programme policy." },
] as const;

export function isAdminTrustStatus(value: string): value is AdminTrustStatus {
  return (ADMIN_TRUST_STATUSES as readonly string[]).includes(value);
}

export function adminStatusTone(status: AdminTrustStatus): "success" | "info" | "warning" | "danger" | "neutral" {
  if (status === "Live" || status === "Ready") return "success";
  if (status === "Protected") return "info";
  if (status === "Action required" || status === "Review recommended") return "warning";
  if (status === "Dormant") return "neutral";
  if (status === "Disabled") return "danger";
  return "neutral";
}

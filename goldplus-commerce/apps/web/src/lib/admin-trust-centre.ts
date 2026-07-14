export const ADMIN_TRUST_STATUSES = [
  "Live",
  "Ready",
  "Needs configuration",
  "No data yet",
  "Protected",
  "Disabled",
  "Coming soon",
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
    status: "Needs configuration",
    actionLabel: "Support queue unavailable",
    actionDisabled: true,
    disabledReason: "A verified operator support source is not connected to this trust centre yet.",
    nextStep: "Review the public support journey and approve a real case source before operational handling.",
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
    status: "Coming soon",
    actionLabel: "Programme not active",
    actionDisabled: true,
    disabledReason: "Requires an approved policy, liability model, support process and launch decision.",
    nextStep: "Define programme rules and financial liability before building issuance or redemption.",
    safetyNote: "No points, balance, cashback, discount or reward is active.",
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
  { id: "loyalty", label: "Loyalty programme", status: "Coming soon", detail: "No rewards programme, points balance or redemption is active." },
] as const;

export function isAdminTrustStatus(value: string): value is AdminTrustStatus {
  return (ADMIN_TRUST_STATUSES as readonly string[]).includes(value);
}

export function adminStatusTone(status: AdminTrustStatus): "success" | "info" | "warning" | "danger" | "neutral" {
  if (status === "Live" || status === "Ready") return "success";
  if (status === "Protected") return "info";
  if (status === "Needs configuration" || status === "Action required" || status === "Review recommended") return "warning";
  if (status === "Disabled") return "danger";
  return "neutral";
}

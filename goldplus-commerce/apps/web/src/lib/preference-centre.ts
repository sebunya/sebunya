export type PreferenceReadinessStatus =
  | "Prepared as future preference"
  | "Requires verification"
  | "Support-assisted today"
  | "Not active yet";

export interface PreferenceItem {
  id: string;
  title: string;
  description: string;
  status: PreferenceReadinessStatus;
  activationRequirement: string;
}

export const preferenceCentreStatus = Object.freeze({
  label: "Preview only",
  active: false,
  persistenceEnabled: false,
  customerSpecific: false,
  providerSendsEnabled: false,
  publicMessage: "GoldPlus is preparing a clearer Preference Centre.",
  sendMessage: "No marketing messages are sent from this page.",
  verificationMessage: "Some preferences may require account verification before they can be applied.",
  supportMessage: "GoldPlus support can help confirm or update your preferences.",
  futureProgrammeMessage: "Loyalty, Memory Lane and personalised offers are not active yet.",
});

export const communicationPreferences: readonly PreferenceItem[] = Object.freeze([
  {
    id: "essential-service",
    title: "Essential service messages",
    description: "Order, payment, delivery or security messages that may be needed to provide a service you request.",
    status: "Requires verification",
    activationRequirement: "A verified order or account context and an approved transactional-message rule.",
  },
  {
    id: "support-follow-up",
    title: "Support follow-up",
    description: "Replies about a question, return, warranty enquiry or reported issue you asked GoldPlus to handle.",
    status: "Support-assisted today",
    activationRequirement: "A customer-initiated support request and enough information to verify the request.",
  },
  {
    id: "product-education",
    title: "Product education",
    description: "Future optional guidance about product care, compatibility, safe charging and buying decisions.",
    status: "Prepared as future preference",
    activationRequirement: "Clear purpose, channel consent, frequency rules and an unsubscribe path.",
  },
  {
    id: "offers-news",
    title: "Offers and GoldPlus news",
    description: "Future optional marketing about approved products, services or promotions.",
    status: "Not active yet",
    activationRequirement: "Explicit marketing consent, verified contact details, approved content and opt-out controls.",
  },
]);

export const servicePreferences: readonly PreferenceItem[] = Object.freeze([
  {
    id: "order-help",
    title: "Order help",
    description: "Choose how support may respond when you ask for help with an order.",
    status: "Support-assisted today",
    activationRequirement: "An order reference plus verification appropriate to the request.",
  },
  {
    id: "returns-warranty-help",
    title: "Returns and warranty help",
    description: "Get support guidance based on the product, order details and applicable policy.",
    status: "Support-assisted today",
    activationRequirement: "Proof of purchase or other safe verification where required.",
  },
  {
    id: "delivery-clarification",
    title: "Delivery clarification",
    description: "Ask support to clarify delivery information without creating a courier-tracking promise.",
    status: "Support-assisted today",
    activationRequirement: "A valid request and the delivery context support needs to investigate.",
  },
]);

export const productEducationPreferences: readonly PreferenceItem[] = Object.freeze([
  {
    id: "device-care",
    title: "Device care",
    description: "Future optional tips for caring for electronics and accessories.",
    status: "Prepared as future preference",
    activationRequirement: "Approved education content and explicit channel choice.",
  },
  {
    id: "compatibility-guidance",
    title: "Compatibility guidance",
    description: "Future optional guidance that helps customers ask the right compatibility questions.",
    status: "Prepared as future preference",
    activationRequirement: "Supported product data, careful wording and explicit channel choice.",
  },
  {
    id: "safe-charging",
    title: "Safe charging education",
    description: "Future optional safety guidance for chargers, cables and power banks.",
    status: "Prepared as future preference",
    activationRequirement: "Reviewed safety content, purpose limitation and channel consent.",
  },
  {
    id: "buying-guides",
    title: "Buying guides",
    description: "Future optional explanations for comparing features and choosing products honestly.",
    status: "Prepared as future preference",
    activationRequirement: "Truthful catalogue data, approved frequency and channel consent.",
  },
]);

export const loyaltyReadinessPreferences: readonly PreferenceItem[] = Object.freeze([
  {
    id: "loyalty-participation",
    title: "Loyalty participation",
    description: "A future choice about joining an approved GoldPlus loyalty programme.",
    status: "Not active yet",
    activationRequirement: "Programme terms, identity, ledger, consent, liability, fraud and support controls.",
  },
]);

export const memoryLaneReadinessPreferences: readonly PreferenceItem[] = Object.freeze([
  {
    id: "memory-lane",
    title: "Memory Lane",
    description: "A future choice about using consented history for an annual journey insight.",
    status: "Not active yet",
    activationRequirement: "Explicit consent, identity, retention rules, privacy review and an approved history model.",
  },
]);

export const personalisationReadinessPreferences: readonly PreferenceItem[] = Object.freeze([
  {
    id: "personalisation",
    title: "Personalised product guidance",
    description: "A future choice about using approved, consented data to tailor product guidance.",
    status: "Not active yet",
    activationRequirement: "Explicit consent, data-use rules, explainability, fairness and opt-out controls.",
  },
  {
    id: "utilisation-aware-offers",
    title: "Utilisation-aware offers",
    description: "A future governed concept that may consider approved operational signals before any offer is created.",
    status: "Not active yet",
    activationRequirement: "Consent, policy, margin floors, budget caps, eligibility rules and support capacity.",
  },
]);

export const channelPreferences = Object.freeze([
  { name: "WhatsApp", status: "Not active yet" as const, guidance: "Future marketing use requires explicit consent, verified contact details and a clear opt-out path." },
  { name: "Email", status: "Not active yet" as const, guidance: "Future optional email requires explicit consent, approved purpose, frequency and unsubscribe handling." },
  { name: "SMS", status: "Not active yet" as const, guidance: "Future optional SMS requires explicit consent, verified contact details and an opt-out path." },
  { name: "Phone call", status: "Requires verification" as const, guidance: "Support may need to verify identity and the reason for contact before discussing protected details." },
  { name: "In-account notifications", status: "Not active yet" as const, guidance: "Requires a verified account, notification controls and an approved account experience." },
  { name: "Support-assisted updates", status: "Support-assisted today" as const, guidance: "Customers can contact support to ask for help confirming or updating a preference." },
]);

export const dataUsePrinciples = Object.freeze([
  "Explain the purpose before asking for a preference or consent.",
  "Collect only information needed for the stated purpose.",
  "Keep service messages separate from optional marketing choices.",
  "Do not treat silence, inactivity or a pre-ticked control as consent.",
  "Verify identity before applying changes to customer-specific records.",
  "Provide a clear way to change or withdraw an optional preference.",
  "Keep future personalisation explainable, proportionate and reviewable.",
  "Protect preference records with access controls, retention rules and an audit trail before persistence is enabled.",
]);

export const inactiveCapabilities = Object.freeze([
  "Marketing sends from this page",
  "Saved public-page preferences",
  "Loyalty enrolment, points or balances",
  "Memory Lane history or annual insights",
  "Customer-specific personalisation",
  "Utilisation-aware discounts or personalised prices",
  "Coupon, reward or cashback generation",
  "Provider, queue or automation activation",
]);

export const customerRightsGuidance = Object.freeze([
  "Ask what information GoldPlus uses for a stated purpose.",
  "Ask support to confirm which preference-change process is available today.",
  "Request correction of inaccurate contact or preference information after verification.",
  "Withdraw an optional marketing choice through the approved channel once that capability is live.",
  "Escalate an unresolved privacy or communication concern through GoldPlus support.",
]);

export const adminConsentReadinessRows = Object.freeze([
  { area: "Purpose catalogue", status: "Prepared as future preference" as const, blocker: "Accountable approval and legal/privacy review." },
  { area: "Identity verification", status: "Requires verification" as const, blocker: "Approved account or support-assisted verification flow." },
  { area: "Preference persistence", status: "Not active yet" as const, blocker: "Data model, access control, audit and retention approval." },
  { area: "Provider enforcement", status: "Not active yet" as const, blocker: "Provider mapping, suppression, unsubscribe and delivery controls." },
  { area: "Loyalty consent", status: "Not active yet" as const, blocker: "Programme terms, ledger, liability and support readiness." },
  { area: "Memory Lane consent", status: "Not active yet" as const, blocker: "Explicit consent, history model, retention and privacy approval." },
  { area: "Personalisation consent", status: "Not active yet" as const, blocker: "Explainability, fairness, data-use and withdrawal rules." },
  { area: "Utilisation-aware offers", status: "Not active yet" as const, blocker: "Consent, margin, budget, eligibility and support controls." },
]);

export const riskControls = Object.freeze([
  "No marketing message without explicit consent.",
  "No WhatsApp send without explicit consent and an approved opt-out path.",
  "No SMS send without explicit consent and an approved opt-out path.",
  "No email marketing without explicit consent and unsubscribe handling.",
  "No loyalty tracking before approved terms, consent and a ledger.",
  "No Memory Lane without explicit consent and privacy review.",
  "No personalised offer without explicit consent, explainability and margin controls.",
  "No utilisation-aware offer without approved policy, eligibility and budget controls.",
  "No targeting of minors without an approved age-appropriate policy and safeguards.",
  "No hidden tracking or inferred marketing consent.",
  "No bundled consent for unrelated purposes.",
  "No pre-ticked optional preference.",
  "No persisted preference change without an audit trail once persistence is enabled.",
  "No provider activation from the Preference Centre.",
  "No optional messaging programme without a tested unsubscribe or withdrawal path.",
]);

export const launchReadinessChecklist = Object.freeze([
  "Approved preference purpose catalogue",
  "Privacy and legal review",
  "Plain-language customer notice",
  "Verified identity and account-change model",
  "Support-assisted change procedure",
  "Preference data contract",
  "Access controls and audit trail",
  "Retention and deletion rules",
  "Channel-specific consent evidence",
  "Transactional-versus-marketing classification",
  "WhatsApp opt-out handling",
  "Email unsubscribe handling",
  "SMS opt-out handling",
  "Provider suppression enforcement",
  "Loyalty consent and programme terms",
  "Memory Lane explicit consent and privacy review",
  "Personalisation explainability and withdrawal rules",
  "Utilisation-aware offer policy, margin and budget controls",
  "Customer complaint and dispute process",
  "Accessibility and mobile review",
  "Pre-launch security and production verification",
]);

export const forbiddenClaims = Object.freeze([
  "You are subscribed",
  "You are unsubscribed",
  "Your preferences are saved",
  "Your consent has been updated",
  "You will now receive WhatsApp messages",
  "Your Memory Lane is enabled",
  "You joined GoldPlus Rewards",
  "You unlocked personalised offers",
  "You opted into discounts",
]);

export const supportActions = Object.freeze([
  { label: "Get preference help", href: "/support", description: "Ask GoldPlus support what can be confirmed or updated today." },
  { label: "Read privacy guidance", href: "/privacy", description: "Understand current interim data-use guidance." },
  { label: "Read terms", href: "/terms", description: "Review current interim service terms." },
]);

export function preferenceCentreSafetySummary() {
  return Object.freeze({
    active: false,
    persistence: false,
    customerState: false,
    providerSends: false,
    automation: false,
    loyaltyEnrolment: false,
    memoryLane: false,
    personalisation: false,
    utilisationOffers: false,
    checkoutMutation: false,
    paymentMutation: false,
  });
}

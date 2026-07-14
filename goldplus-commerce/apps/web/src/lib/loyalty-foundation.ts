export const LOYALTY_PROGRAMME_STATUS = Object.freeze({
  name: "GoldPlus Rewards",
  label: "Being prepared",
  active: false,
  activationStatus: "Disabled",
  publicMessage: "GoldPlus Rewards is being prepared.",
  truthMessage: "Purchases are not yet earning live points unless the programme is formally activated.",
  approvalMessage: "Benefits and rules will be confirmed before launch.",
  termsMessage: "Programme terms will be published before launch.",
});

export const LOYALTY_FOUNDATION_GUARDRAILS = Object.freeze([
  "No live points, customer balance or wallet",
  "No reward issuance, redemption, cashback or coupon generation",
  "No customer-specific tier, badge, quest or progress state",
  "No identity tracking, cookies or local storage",
  "No inventory, order or customer reads for offers",
  "No discount, personalised price or checkout mutation",
  "No random prize, code reveal or data collection",
  "No provider activation or customer communication send",
]);

export const FORBIDDEN_LOYALTY_CLAIMS = Object.freeze([
  "You earned points",
  "Redeem now",
  "VIP unlocked",
  "Guaranteed cashback",
  "Claim reward",
  "Your balance",
  "Discount unlocked",
  "Offer applied",
  "You won",
  "Your annual recap",
  "You earned this badge",
  "Your personal discount",
]);

export const VISUAL_PROGRESS_PREVIEW = Object.freeze({
  title: "Programme setup preview",
  label: "Preview only — not customer progress",
  setupPercent: 25,
  steps: Object.freeze([
    { label: "Foundation and safeguards", state: "Prepared" },
    { label: "Policy, consent and liability", state: "Not approved" },
    { label: "Identity, ledger and fraud controls", state: "Not built" },
    { label: "Support, legal and launch review", state: "Not approved" },
  ]),
  technicalNote: "Live visual progress requires persistent identity matching, consent, a server-side ledger, fraud controls and fast page-load rendering. This foundation does not activate those systems.",
});

export type PreviewStatus = "Preview only" | "Not active" | "Needs approval";

export interface QuestConcept {
  name: string;
  purpose: string;
  futureUnlockConcept: string;
  activationBlocker: string;
  status: PreviewStatus;
}

export const QUEST_CONCEPTS: readonly QuestConcept[] = Object.freeze([
  { name: "Safe Charging Quest", purpose: "Build safer charging habits.", futureUnlockConcept: "Future service or education benefit after approved completion rules.", activationBlocker: "Verified learning events, consent, audit rules and benefit policy.", status: "Preview only" },
  { name: "Warranty Aware Quest", purpose: "Help customers understand proof-of-purchase and warranty guidance.", futureUnlockConcept: "Future warranty-support education benefit.", activationBlocker: "Policy, legal review and verified completion evidence.", status: "Preview only" },
  { name: "Storage Backup Quest", purpose: "Encourage safer storage and backup planning.", futureUnlockConcept: "Future storage-care benefit after rules are approved.", activationBlocker: "Education content, event audit and approved benefit rules.", status: "Preview only" },
  { name: "Smart Buyer Quest", purpose: "Promote comparison and product-fit checks.", futureUnlockConcept: "Future buying-guidance benefit.", activationBlocker: "Consent, verified actions and fair eligibility rules.", status: "Preview only" },
  { name: "Device Care Quest", purpose: "Reinforce practical device-care habits.", futureUnlockConcept: "Future care-support benefit.", activationBlocker: "Approved care content, ledger and fraud controls.", status: "Preview only" },
  { name: "Support Ready Quest", purpose: "Teach what information helps support resolve issues.", futureUnlockConcept: "Future service-first benefit.", activationBlocker: "Support capacity, policy and completion verification.", status: "Preview only" },
  { name: "Compare Before You Buy Quest", purpose: "Encourage informed product comparisons.", futureUnlockConcept: "Future comparison-guidance benefit.", activationBlocker: "Approved rules, identity, consent and audit history.", status: "Preview only" },
  { name: "Business Buyer Readiness Quest", purpose: "Prepare buyers for responsible bulk-purchase planning.", futureUnlockConcept: "Future business guidance benefit.", activationBlocker: "Commercial policy, support capacity and fair eligibility.", status: "Preview only" },
  { name: "Power Setup Quest", purpose: "Help customers plan compatible power accessories.", futureUnlockConcept: "Future power-readiness education benefit.", activationBlocker: "Compatibility evidence and approved benefit rules.", status: "Preview only" },
  { name: "Family Device Planner Quest", purpose: "Support safer shared-device planning.", futureUnlockConcept: "Future planning or support benefit.", activationBlocker: "Privacy review, consent and non-sensitive completion rules.", status: "Preview only" },
]);

export const BADGE_PREVIEW_STATES = Object.freeze([
  { id: "preview", label: "Preview badge", meaning: "A non-customer-specific example only." },
  { id: "future-earned", label: "Future earned state", meaning: "Would require verified events, identity, consent and audit rules." },
  { id: "future-undiscovered", label: "Future undiscovered state", meaning: "Would require consented history and fair discovery rules." },
  { id: "not-active", label: "Not active", meaning: "No badge is currently assigned to any customer." },
]);

export const BADGE_CONCEPTS = Object.freeze([
  "Smart Buyer", "Power Ready", "Storage Safe", "Sound Explorer", "Warranty Aware",
  "Support Ready", "Device Care Champion", "Safe Charger", "Backup Planner",
  "Comparison Pro", "Compatibility Checker",
]);

export const TIER_PREVIEWS = Object.freeze([
  { name: "Starter", description: "A possible future introduction to education and support benefits." },
  { name: "Plus", description: "A possible future step for broader device-care participation." },
  { name: "Pro", description: "A possible future step subject to approved, non-exploitative rules." },
  { name: "Elite", description: "A possible future service tier, not a VIP assignment." },
].map((tier) => Object.freeze({ ...tier, status: "Preview only" as const, active: false, customerSpecific: false })));

export const MEMORY_LANE_CONCEPT = Object.freeze({
  title: "Memory Lane",
  status: "Not active" as const,
  message: "Memory Lane is a future concept. No customer history is being read or shown in this release.",
  launchRequirements: "Future Memory Lane will require consent, identity, event history, privacy review and approved messaging.",
  possibleInsights: Object.freeze([
    "Categories explored", "Device-care tips completed", "Support topics reviewed",
    "Warranty awareness milestones", "Safe charging learning", "Storage protection journey",
    "Sound products explored", "Smart buying decisions", "Badges earned under future rules",
    "Badges not yet discovered under future rules", "Quests completed under future rules",
    "Useful accessories not yet explored",
  ]),
});

export interface UtilisationOfferRule {
  signal: string;
  futureUse: string;
  dataRequired: string;
  approvalRequired: string;
  riskControl: string;
  status: PreviewStatus;
}

export const UTILISATION_OFFER_RULES: readonly UtilisationOfferRule[] = Object.freeze([
  { signal: "Low accessory attachment", futureUse: "Accessory education before any approved bundle offer.", dataRequired: "Consented order and category history.", approvalRequired: "Policy and margin approval.", riskControl: "Compatibility truth, consent and margin floor.", status: "Not active" },
  { signal: "Slow-moving stock", futureUse: "Stock education or a finance-approved offer.", dataRequired: "Inventory age and verified margin data.", approvalRequired: "Stock and finance approval.", riskControl: "Price floor, expiry and brand-protection rules.", status: "Not active" },
  { signal: "Underused benefits", futureUse: "Explain the benefit before considering price support.", dataRequired: "Consented benefit usage data.", approvalRequired: "Privacy and support approval.", riskControl: "Education first and no pressure mechanics.", status: "Not active" },
  { signal: "Quest completion", futureUse: "An approved future benefit after verified completion.", dataRequired: "Quest rules, ledger and audit history.", approvalRequired: "Policy, ledger and fraud approval.", riskControl: "No benefit before verified rules and payment truth.", status: "Needs approval" },
  { signal: "Memory Lane discovery gap", futureUse: "Insight-led product education before any offer.", dataRequired: "Consented history and identity.", approvalRequired: "Consent and privacy approval.", riskControl: "No profiling or targeting in this foundation.", status: "Preview only" },
  { signal: "Reward budget utilisation", futureUse: "Keep future programme liability inside an approved cap.", dataRequired: "Approved budget and liability records.", approvalRequired: "Finance and programme-owner approval.", riskControl: "Hard budget cap and auditable stop rule.", status: "Needs approval" },
  { signal: "Support capacity", futureUse: "Pause future demand creation when service capacity is constrained.", dataRequired: "Approved aggregate support capacity signal.", approvalRequired: "Support leadership approval.", riskControl: "No offer that support cannot explain or serve.", status: "Preview only" },
  { signal: "Margin floor", futureUse: "Block any future offer below an approved contribution threshold.", dataRequired: "Verified cost, price and margin rules.", approvalRequired: "Finance and commercial approval.", riskControl: "Non-bypassable margin and price floors.", status: "Needs approval" },
]);

export const DISCOUNT_GOVERNANCE_PRINCIPLES = Object.freeze([
  "Discounts should protect margin and respect an approved margin floor.",
  "Discounts should not train customers to wait.",
  "Discounts should not reward abuse.",
  "Discounts should not bypass support capacity.",
  "Discounts should not hide terms.",
  "Discounts should never apply without approved rules.",
  "Education should come before discounting.",
  "Service value can be more powerful than price cuts.",
  "Every approved offer should have a documented promotion budget cap.",
]);

export const MYSTERY_REVEAL_CONCEPTS = Object.freeze([
  "Scratch-to-reveal concept", "Spin-and-win concept", "Mystery accessory offer concept",
  "Care-tip reveal concept", "Quest reward reveal concept", "Utilisation-aware offer reveal concept",
].map((name) => Object.freeze({ name, status: "Preview only" as const, prizeGenerated: false, codeIssued: false, dataCollected: false })));

export const LAUNCH_READINESS_CHECKLIST = Object.freeze([
  "Approved programme policy", "Earning rules", "Quest completion rules", "Badge award rules",
  "Earned and undiscovered badge display rules", "Memory Lane consent model", "Memory Lane data retention model",
  "Utilisation signal data contract", "Offer eligibility rules", "Discount margin rules",
  "Promotion budget caps", "Redemption rules", "Financial liability model", "Fraud controls",
  "Support process", "Customer consent", "Privacy review", "Legal review", "Terms update",
  "Measurement plan", "Customer communication approval", "Refund and return adjustment rules",
  "Expiry rules", "Dispute handling", "Account closure handling", "Manual adjustment controls",
  "Margin approval for offers", "Odds and eligibility disclosure for reveal mechanics",
]);

export const RISK_CONTROLS_CHECKLIST = Object.freeze([
  "No reward without a verified order.",
  "No reward before payment confirmation.",
  "No quest reward without approved rules.",
  "No earned badge without event history and audit rules.",
  "No Memory Lane without consent and privacy review.",
  "No utilisation offer without a margin floor.",
  "No utilisation offer without stock and finance approval.",
  "No discount without a budget cap.",
  "No redemption without a liability model.",
  "No customer balance without a ledger.",
  "No marketing send without consent.",
  "No points expiry without policy.",
  "No manual adjustment without an audit trail.",
  "No cashback without finance approval.",
  "No discount without margin rules.",
  "No mystery reveal without odds and eligibility rules.",
  "No leaderboard with customer PII.",
  "No public ranking by spend.",
]);

export type ReadinessLevel = "Low" | "Medium" | "High";

export interface GamificationReadinessRow {
  rank: number;
  mechanic: string;
  customerValue: ReadinessLevel;
  commercialUsefulness: ReadinessLevel;
  technicalReadiness: ReadinessLevel;
  policyReadiness: ReadinessLevel;
  riskLevel: ReadinessLevel;
  activationBlocker: string;
  status: PreviewStatus;
}

export const GAMIFICATION_READINESS_LEADERBOARD: readonly GamificationReadinessRow[] = Object.freeze([
  [1, "Device-care missions", "High", "High", "Medium", "Low", "Low", "Approved learning rules and audit evidence"],
  [2, "Badge concepts", "High", "Medium", "Medium", "Low", "Low", "Event and badge-award rules"],
  [3, "Quest concepts", "High", "High", "Low", "Low", "Medium", "Identity, ledger, fraud and benefit policy"],
  [4, "Warranty-awareness journey", "High", "Medium", "Medium", "Low", "Low", "Legal and support approval"],
  [5, "Visual progress", "Medium", "Medium", "Low", "Low", "Medium", "Identity, consent and server-side ledger"],
  [6, "Tier preview", "Medium", "Medium", "Low", "Low", "Medium", "Fair tier and benefit rules"],
  [7, "Earned and undiscovered badge model", "High", "Medium", "Low", "Low", "Medium", "Consented history and audit rules"],
  [8, "Memory Lane", "High", "Medium", "Low", "Low", "High", "Consent, privacy, history and messaging approval"],
  [9, "Utilisation-aware offers", "Medium", "High", "Low", "Low", "High", "Data contracts, margin, finance and consent"],
  [10, "Mystery accessory offer", "Medium", "Medium", "Low", "Low", "High", "Eligibility, odds, margin and support rules"],
  [11, "Scratch-to-reveal", "Low", "Medium", "Low", "Low", "High", "Legal, odds, fraud and customer-protection review"],
  [12, "Spin-and-win", "Low", "Medium", "Low", "Low", "High", "Legal, odds, fraud and customer-protection review"],
].map(([rank, mechanic, customerValue, commercialUsefulness, technicalReadiness, policyReadiness, riskLevel, activationBlocker]) => Object.freeze({
  rank: rank as number,
  mechanic: mechanic as string,
  customerValue: customerValue as ReadinessLevel,
  commercialUsefulness: commercialUsefulness as ReadinessLevel,
  technicalReadiness: technicalReadiness as ReadinessLevel,
  policyReadiness: policyReadiness as ReadinessLevel,
  riskLevel: riskLevel as ReadinessLevel,
  activationBlocker: activationBlocker as string,
  status: "Preview only" as const,
})));

export const UTILISATION_READINESS_SCORECARD = Object.freeze(UTILISATION_OFFER_RULES.map((rule, index) => Object.freeze({
  rank: index + 1,
  signal: rule.signal,
  dataReadiness: "Low" as const,
  policyReadiness: "Low" as const,
  marginControl: rule.signal === "Margin floor" ? "Needs approval" as const : "Not active" as const,
  activationBlocker: `${rule.dataRequired} ${rule.approvalRequired}`,
  status: rule.status,
})));

export const FUTURE_PREMIUM_CONCEPTS = Object.freeze([
  "Device Care Missions", "Smart Buyer Path", "Warranty Aware Journey", "Power Readiness",
  "Storage Safety", "Sound Explorer", "Family Device Planner", "Business Buyer Readiness",
  "Support Trust Milestones", "Memory Lane", "Quest Unlock Paths", "Undiscovered Badge Discovery",
  "Safe Charging Mastery", "Compatibility Confidence", "Bulk Buyer Readiness",
  "Utilisation-Aware Offers", "Smart Accessory Nudges", "Service-First Benefits",
]);

export const LOYALTY_ADMIN_PREVIEW = Object.freeze({
  programmeStatus: "Foundation ready / programme not active",
  activationStatus: "Disabled",
  readOnly: true,
  ranksCustomers: false,
  containsPii: false,
  activationBlocker: "Policy, liability, ledger, consent, fraud, identity, privacy, margin and support process are not approved.",
  activeFinancialMechanics: 0,
});

export function isLoyaltyProgrammeActive(): boolean {
  return LOYALTY_PROGRAMME_STATUS.active;
}

export function hasLiveFinancialMechanic(): boolean {
  return LOYALTY_ADMIN_PREVIEW.activeFinancialMechanics > 0;
}

export function loyaltyFoundationSafetySummary() {
  return Object.freeze({
    programmeActive: false,
    customerState: false,
    persistence: false,
    liveOffers: false,
    couponGeneration: false,
    checkoutMutation: false,
    customerRanking: false,
    customerCommunications: false,
  });
}

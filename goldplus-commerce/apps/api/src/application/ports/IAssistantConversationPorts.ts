/**
 * Ports for what Goldie does beyond answering: knowing who she is talking to,
 * remembering what they asked about, and passing a chat on by email.
 */

/** What Goldie may know about the shopper in front of her. Everything is optional and first-party. */
export interface AssistantShopperContext {
  /** First word of the name on their saved address or last order; null when unknown. */
  firstName: string | null;
  /** 1 = first visit, 2-3 = returning, 4+ = regular (the hero's own measure). */
  visits: number;
  hasOrdered: boolean;
  /** Category names they browse most, strongest first (at most 3). */
  topCategories: string[];
  /** Products they looked at most recently (names, at most 3). */
  recentlyViewed: string[];
  /** What they asked Goldie about before (short topics, newest first, at most 3). */
  pastTopics: string[];
  /** The next-best action the Customer DNA engine chose for them (RESUME_CART, LOYALTY_ACTION, ...), or null. */
  nextBestAction?: string | null;
}

/** The Customer DNA next-best-action engine, asked on the customer's behalf (service context, not marketing). */
export interface INextBestActionAdvisor {
  forCustomer(userId: string): Promise<string | null>;
}

export interface AssistantShopperKey {
  /** Server experience-profile id resolved from the signed visit cookie. */
  profileId: string | null;
  /** Signed-in customer, from the session (never from a request body). */
  userId: string | null;
  /** First-party analytics id (_fp_cid), used for consent and zero-party signals. */
  fpClientId: string | null;
  /** WhatsApp: the sender's Meta-verified number (international digits); resolves to an account with that verified phone. */
  verifiedPhone?: string | null;
}

export interface IAssistantContextReader {
  read(key: AssistantShopperKey): Promise<AssistantShopperContext>;
}

/** One topic a shopper raised with Goldie, for Customer DNA. */
export interface AssistantInterest {
  intent: string;
  topic: string;
  phoneModel: string | null;
  page: string | null;
}

export interface IAssistantInterestSink {
  /** Records the interest when the shopper's consent allows it; returns whether it was kept. */
  record(key: AssistantShopperKey, interest: AssistantInterest): Promise<boolean>;
}

export interface PreRenderedMail {
  eventType: 'GOLDIE_HANDOVER' | 'GOLDIE_TRANSCRIPT';
  /** Null for the handover (the router sends it to the shop's configured inbox). */
  recipient: string | null;
  subject: string;
  text: string;
  html: string;
  /** Handover only: the customer's email, so the shop can answer with Reply. */
  replyTo?: string | null;
  replyToName?: string | null;
  idempotencyKey: string;
  relatedEntity: string;
  relatedEntityId: string | null;
}

export interface IAssistantMailOutbox {
  enqueue(mail: PreRenderedMail): Promise<{ enqueued: boolean }>;
  /** Transcript copies already queued for this address since `since` (the per-address cap). */
  countTranscriptsSince(recipient: string, since: Date): Promise<number>;
}

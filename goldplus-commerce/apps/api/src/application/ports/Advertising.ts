import type { Confirmation, RemoteRequestOutcome, RemoteRequests } from '../../domain/advertising/AudienceConfirmation';

/** Advertising destinations (0138): a platform's switch, ids and encrypted token. */
export interface AdDestinationRow {
  platform: string;
  enabled: boolean;
  config: Record<string, string>;
  hasSecret: boolean;
  secretMask: string | null;
  updatedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  sentCount: number;
  failedCount: number;
  /** 0154: 'test' sends to the platform's test channel (test event code / validate only). */
  mode: 'live' | 'test';
  /** 0154: early-signal events this destination sends; null = every supported one. */
  eventSelection: string[] | null;
}

export interface AdDestinationRepository {
  list(): Promise<AdDestinationRow[]>;
  get(platform: string): Promise<AdDestinationRow | null>;
  save(platform: string, patch: { enabled?: boolean; config?: Record<string, string>; secretEnc?: string | null; secretMask?: string | null; updatedBy: string | null; mode?: 'live' | 'test'; eventSelection?: string[] | null }): Promise<AdDestinationRow>;
  /**
   * Enabled, fully configured platforms with the ENCRYPTED secret (dispatch
   * only). In test mode the config carries `_test: '1'` for the builders.
   */
  active(): Promise<Array<{ platform: string; config: Record<string, string>; secretEnc: string | null; eventSelection?: string[] | null }>>;
}

export interface SecretCipher { encrypt(plain: string): string; decrypt(enc: string): string; mask(plain: string): string }

// ── Advertising operations (0154): capabilities, audiences, spend, offline ──

export type AdCapability = 'audiences' | 'spend' | 'offline';

/** One platform capability's settings; the secret is write-only (mask only). */
export interface AdCapabilityRow {
  platform: string;
  capability: AdCapability;
  enabled: boolean;
  config: Record<string, string>;
  hasSecret: boolean;
  secretMask: string | null;
  updatedAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface AdCapabilityRepository {
  list(): Promise<AdCapabilityRow[]>;
  get(platform: string, capability: AdCapability): Promise<AdCapabilityRow | null>;
  save(platform: string, capability: AdCapability, patch: { enabled?: boolean; config?: Record<string, string>; secretEnc?: string | null; secretMask?: string | null; updatedBy: string | null }): Promise<AdCapabilityRow>;
  recordRun(platform: string, capability: AdCapability, status: string, error: string | null): Promise<void>;
}

/**
 * Decrypted credentials, read just in time for one call and never logged or
 * returned. THROWS when a stored secret cannot be decrypted (a rotated server
 * key): the caller reports it; it never sends on a guess.
 */
export interface AdSecretsPort {
  destinationSecret(platform: string): Promise<string | null>;
  capabilitySecret(platform: string, capability: AdCapability): Promise<string | null>;
  /** The vault key exists on this server. */
  vaultReady(): boolean;
}

/** What a gateway needs for one platform: the owner's ids and the tokens. */
export interface PlatformCredentials {
  /** Capability settings (ad account, advertiser id, offline event set …). */
  config: Record<string, string>;
  /** The capability's own token ('' when it uses the destination's). */
  secret: string;
  /** The conversions destination's ids (dataset, pixel, customer id …). */
  destinationConfig: Record<string, string>;
  /** The conversions destination's token or JSON bundle. */
  destinationSecret: string;
  testMode: boolean;
}

export interface AudienceRunRecord {
  platform: string;
  segment: string;
  mode: 'DRY_RUN' | 'SYNC';
  trigger: 'ADMIN' | 'SCHEDULE';
  status: string;
  eligibleCount: number;
  excludedConsent: number;
  excludedNoIdentifier: number;
  uploadedCount: number | null;
  message: string | null;
  remoteListId: string | null;
  actorId: string | null;
  startedAt: Date;
  finishedAt?: string;
  /** Set when read back from the log. */
  id?: string;
  /** 0159: the platform request ids of an asynchronous upload (Google Data Manager). */
  remoteRequests?: RemoteRequests | null;
  /** 0159: the platform's confirmation of that upload (null = nothing to confirm). */
  confirmation?: Confirmation | null;
  confirmationDetail?: string | null;
  confirmedAt?: string | null;
}

/** A SUBMITTED run still waiting for the platform's confirmation (claimed with a short lease). */
export interface PendingAudienceRun {
  id: string;
  platform: string;
  segment: string;
  remoteListId: string | null;
  startedAt: Date;
  remoteRequests: RemoteRequests;
  confirmation: 'WAITING' | 'SWEEPING';
}

export interface AudienceSourcePort {
  /** Every order with its contact and first-party ids (qualification happens in the domain). */
  buyerOrders(): Promise<import('../../domain/advertising/AudienceSegments').BuyerOrder[]>;
  /**
   * Stored advertising refusals (the AdvertisingConsentGate predicate) among
   * these accounts and browsers, including browsers linked to the accounts.
   * THROWS on a failed read: nobody is uploaded on an unknown answer.
   */
  refusedIdentities(userIds: string[], fpClientIds: string[]): Promise<{ userIds: Set<string>; fpClientIds: Set<string> }>;
}

export interface AudienceListRepository {
  remoteId(platform: string, segment: string): Promise<string | null>;
  saveRemoteId(platform: string, segment: string, remoteId: string): Promise<void>;
  forgetRemoteId(platform: string, segment: string): Promise<void>;
  /** Every list slot this platform has a stored remote list for (built-in and owner-defined). */
  storedSegments(platform: string): Promise<string[]>;
  recordRun(run: AudienceRunRecord): Promise<void>;
  recentRuns(limit: number): Promise<AudienceRunRecord[]>;
  /** SUBMITTED runs due for a confirmation check, claimed for a few minutes so two ticks never poll the same run. */
  pendingConfirmations(limit: number): Promise<PendingAudienceRun[]>;
  /** Fills the confirmation columns only; the run's recorded columns are never rewritten. */
  updateConfirmation(id: string, patch: { confirmation: Confirmation; detail: string | null; sweepRequestId?: string | null }): Promise<void>;
}

export interface HashedAudienceMember { email: string | null; phone: string | null }

export interface AudienceGateway {
  /**
   * Creates the platform list when there is none yet. `uploaded` is set when
   * creating it already uploaded the members (TikTok creates an audience FROM
   * a file); otherwise the caller replaces the members next.
   */
  createList(platform: string, input: { name: string; description: string; membershipDays: number }, members: HashedAudienceMember[], creds: PlatformCredentials): Promise<{ remoteId: string; uploaded: number | null }>;
  /**
   * Replaces the list's members with exactly these (documented full-replace on
   * each platform). `requestIds` is set when the platform only ACCEPTED the
   * upload and confirms it later (Google Data Manager): the run is then
   * SUBMITTED, not SYNCED, and stale members are removed only after Google
   * confirms every request (sweepStale).
   */
  replaceMembers(platform: string, remoteListId: string, members: HashedAudienceMember[], creds: PlatformCredentials): Promise<{ uploaded: number; requestIds?: string[] }>;
  /**
   * Empties a list that no longer has anyone eligible (everyone may have
   * refused advertising since). Google: a remove-all job; Meta and TikTok:
   * the audience is deleted (`forget` = drop our stored id; the next sync
   * creates a fresh one).
   */
  clearList(platform: string, remoteListId: string, creds: PlatformCredentials): Promise<{ forget: boolean; requestIds?: string[] }>;
  /** The platform's per-request outcome of an asynchronous upload (Google: requestStatus:retrieve). */
  requestStatus?(platform: string, requestIds: string[], creds: PlatformCredentials): Promise<RemoteRequestOutcome[]>;
  /** Removes the members last added before `asOf` (Google: removeAll with removeAsOfTime). */
  sweepStale?(platform: string, remoteListId: string, asOf: Date, creds: PlatformCredentials): Promise<{ requestId: string | null }>;
}

export interface SpendImportRecord {
  platform: string;
  trigger: 'ADMIN' | 'SCHEDULE' | 'CSV';
  status: string;
  dateFrom: string | null;
  dateTo: string | null;
  rowsWritten: number;
  message: string | null;
  actorId: string | null;
  startedAt: Date;
  finishedAt?: string;
}

export interface SpendReportRow {
  spendDate: string;
  channel: string;
  platform: string;
  campaign: string;
  campaignLabel: string | null;
  currency: string;
  spendMinor: number;
  clicks: number | null;
  impressions: number | null;
  source: string;
}

export interface SpendFactRepository {
  ingestedCurrencies(): Promise<string[]>;
  /** How many facts are new, would change, or are already identical. */
  preview(facts: import('../../domain/advertising/SpendFacts').SpendFact[]): Promise<{ added: number; changed: number; unchanged: number }>;
  /** All or nothing, in one transaction; a re-import of the same day and campaign replaces its figures. */
  upsert(facts: import('../../domain/advertising/SpendFacts').SpendFact[], actorId: string | null): Promise<{ written: number }>;
  report(from: string, to: string): Promise<SpendReportRow[]>;
  recordImport(rec: SpendImportRecord): Promise<void>;
  recentImports(limit: number): Promise<SpendImportRecord[]>;
}

export interface SpendGateway {
  fetchDaily(platform: string, from: string, to: string, creds: PlatformCredentials): Promise<import('../../domain/advertising/SpendFacts').SpendFact[]>;
}

export interface OfflineSaleRecord {
  id: string;
  channel: 'PHONE' | 'WHATSAPP';
  occurredAt: string;
  valueUgx: number;
  orderNumber: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  note: string | null;
  recordedAt: string;
}

export interface OfflineConversionRow {
  id: string;
  platform: string;
  source: 'COD_DELIVERED' | 'ADMIN_SALE';
  sourceRef: string;
  eventId: string;
  occurredAt: string;
  state: string;
  reason: string | null;
  attemptCount: number;
  sentAt: string | null;
}

export interface OfflineContext {
  row: OfflineConversionRow;
  valueUgx: number;
  orderId: string | null;
  orderNumber: string | null;
  channel: 'PHONE' | 'WHATSAPP' | null;
  hashes: { emailSha256: string | null; emailGoogleSha256: string | null; phoneDigitsSha256: string | null; phonePlusSha256: string | null };
  clickIds: Record<string, string>;
  subjects: { userIds: string[]; fpClientIds: string[] };
}

export interface OfflineConversionRepository {
  /**
   * `linkedUserIds` / `linkedFpClientIds`: the account and browsers the
   * first-party identity graph (customer_identity_links) ties to the order's
   * customer — for a guest usually the only way to reach their browser refusal.
   */
  findOrder(orderNumber: string): Promise<{ id: string; orderNumber: string; userId: string | null; fpClientId: string | null; linkedUserIds?: string[]; linkedFpClientIds?: string[] } | null>;
  /** Accounts and browsers that belong to this phone/email, including identity-graph links of its orders (for the consent check at send time). */
  consentSubjectsForContact(contact: { email?: string | null; phone?: string | null }): Promise<{ userIds: string[]; fpClientIds: string[] }>;
  recordSale(sale: {
    channel: 'PHONE' | 'WHATSAPP'; occurredAt: Date; valueUgx: number; orderId: string | null;
    hashes: OfflineContext['hashes']; subjects: OfflineContext['subjects']; note: string | null; recordedBy: string | null;
  }): Promise<string>;
  listSales(limit: number): Promise<OfflineSaleRecord[]>;
  /** One PENDING row per platform for every COD delivery and admin sale in the window (idempotent). */
  enqueue(platforms: string[], sinceDays: number): Promise<number>;
  due(limit: number): Promise<OfflineConversionRow[]>;
  context(row: OfflineConversionRow): Promise<OfflineContext | null>;
  /** The online purchase delivery for this order and platform, if any (its state). */
  onlinePurchaseState(orderId: string, platform: string): Promise<string | null>;
  /** THROWS on a failed read. */
  refused(subjects: OfflineContext['subjects']): Promise<boolean>;
  finish(id: string, state: string, reason: string | null, extra?: { attempt?: number; nextAttemptAt?: Date; sent?: boolean }): Promise<void>;
  list(limit: number): Promise<OfflineConversionRow[]>;
  counts(): Promise<Record<string, number>>;
}

export interface OfflineConversionGateway {
  /** One platform request. Returns the HTTP status (null = no reply) and a short safe error. */
  send(ctx: OfflineContext, creds: PlatformCredentials): Promise<{ status: number | null; error: string | null }>;
}

/** Scheduled jobs claim a key once (per day); a second instance or tick gets false. */
export interface JobClaimPort {
  claim(key: string): Promise<boolean>;
  /**
   * One attempt at a job that must succeed once (a platform's daily run).
   * Returns a token when this caller may attempt it now; null when it is
   * already done, being attempted elsewhere, waiting before a retry, or out
   * of attempts.
   */
  claimAttempt(key: string, opts: { maxAttempts: number; leaseMs: number }): Promise<string | null>;
  /** Success marks the job done; failure lets a later tick retry after `retryAfterMs`. */
  settleAttempt(key: string, token: string, ok: boolean, retryAfterMs: number): Promise<void>;
  /** A short exclusive lock that expires on its own if the holder dies. Token, or null when held. */
  acquireLock(key: string, leaseMs: number): Promise<string | null>;
  releaseLock(key: string, token: string): Promise<void>;
}

/** The per-platform run lock the audience sync takes (the job-claims table). */
export type AudienceRunLock = Pick<JobClaimPort, 'acquireLock' | 'releaseLock'>;

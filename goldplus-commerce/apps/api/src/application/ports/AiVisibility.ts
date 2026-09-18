import type { NormalizedAnswer, ProviderId } from '../../domain/ai-visibility/Evidence';
import type { ClassifiedCitation } from '../../domain/ai-visibility/Citations';
import type { MentionHit } from '../../domain/ai-visibility/Mentions';
import type { ActionCategory, ActionStatus, ActorKind, RiskClass } from '../../domain/ai-visibility/Actions';
import type { RunStatus } from '../../domain/ai-visibility/RunLifecycle';

// ── Provider adapter port ────────────────────────────────────────────────────

export interface ProviderCallConfig {
  apiKey: string;
  model: string;
  webSearch: boolean;
  timeoutMs: number;
}

export interface QueryExecutionInput {
  query: string;
  location: { country: string; city: string | null } | null;
}

export class ProviderCallError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: 'HTTP' | 'TIMEOUT' | 'NETWORK' | 'PARSE' | 'CONFIG') {
    super(message);
  }
}

/**
 * One answer engine. The query is sent exactly as written — no system prompt,
 * no brand injection. Web search is forced where the API allows it, so every
 * answer is a sourced answer and citation rates share one meaning.
 * normalize() is pure over the raw payload so stored evidence can be re-parsed.
 */
export interface AiAnswerProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** false when the provider cannot apply a location without changing the question. */
  readonly appliesLocation: boolean;
  validateConfiguration(cfg: Pick<ProviderCallConfig, 'apiKey' | 'model'>): { ok: true } | { ok: false; reason: string };
  healthcheck(cfg: ProviderCallConfig): Promise<{ ok: true; servedModel: string | null } | { ok: false; reason: string }>;
  executeQuery(input: QueryExecutionInput, cfg: ProviderCallConfig): Promise<{ raw: unknown; latencyMs: number }>;
  normalize(raw: unknown, cfg: Pick<ProviderCallConfig, 'model'>, latencyMs: number, input: QueryExecutionInput): NormalizedAnswer;
}

export interface CredentialCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  mask(plaintext: string): string;
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface AivProject {
  id: string; slug: string; name: string; brandName: string; brandAliases: string[]; domains: string[];
  marketCountry: string; marketCity: string | null; language: string;
  budget: { maxQueriesPerRun: number; maxSpendPerRunUsd: number; maxDailySpendUsd: number; maxMonthlySpendUsd: number; approvalAboveUsd: number };
}

export interface AivCompetitor { id: string; name: string; aliases: string[]; domains: string[]; businessType: string | null; directness: string | null }

export interface AivProviderConfig {
  id: string; provider: ProviderId; enabled: boolean; model: string; webSearch: boolean;
  estUsdPerCall: number; monthlyCapUsd: number | null;
  hasCredential: boolean; credentialMask: string | null; credentialUpdatedAt: string | null;
  lastHealthStatus: 'OK' | 'FAILED' | null; lastHealthMessage: string | null; lastHealthAt: string | null;
}

export interface AivQuery {
  id: string; text: string; category: string | null; intent: string; funnelStage: string | null; branded: boolean;
  topic: string | null; property: string | null; marketCountry: string | null; marketCity: string | null; language: string | null;
  source: string; provenance: string | null; priority: string; tags: string[]; active: boolean; createdAt: string;
}

export interface AivRun {
  id: string; projectId: string; kind: 'MONITOR' | 'RESEARCH' | 'VERIFICATION'; status: RunStatus; idempotencyKey: string;
  providers: ProviderId[]; queryIds: string[]; adhocQueries: string[];
  totalTasks: number; succeeded: number; failed: number; skipped: number;
  estimatedUsd: number; actualUsd: number; phase: string | null; error: string | null;
  requestedBy: string | null; actorKind: ActorKind; approvedBy: string | null; actionId: string | null; cancelRequested: boolean;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}

export interface NewObservation {
  runId: string; projectId: string; runKind: AivRun['kind']; queryId: string | null; queryText: string; provider: ProviderId;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED'; errorCode: string | null; errorMessage: string | null;
  answer: NormalizedAnswer | null; requestedLocation: string | null;
  brandMentioned: boolean | null; ownCited: boolean | null;
  citations: ClassifiedCitation[]; brandMention: MentionHit | null; competitorMentions: MentionHit[];
}

export interface AivObservationRow {
  id: string; runId: string; runKind: string; queryId: string | null; queryText: string; provider: ProviderId; model: string | null;
  status: string; errorCode: string | null; errorMessage: string | null; citationSupport: string | null;
  brandMentioned: boolean | null; ownCited: boolean | null; citationCount: number; costUsd: number | null; latencyMs: number | null;
  requestedLocation: string | null; appliedLocation: string | null; executedAt: string;
}

export interface AivCitationRow { observationId: string; position: number | null; url: string; title: string | null; host: string; pageKey: string; role: string; competitorId: string | null; sourceKind: string | null }
export interface AivMentionRow { observationId: string; entityKind: 'BRAND' | 'COMPETITOR'; competitorId: string | null; matchedText: string; firstIndex: number; occurrences: number }

export interface AivAction {
  id: string; projectId: string; category: ActionCategory; risk: RiskClass; status: ActionStatus; title: string; reason: string;
  mechanism: string | null; plan: string | null; targetPage: string | null; expectedImpact: string | null; limitations: string | null;
  confidence: string | null; evidence: Record<string, unknown>; queryIds: string[]; baseline: Record<string, unknown> | null;
  verification: Record<string, unknown> | null; result: string | null; rollback: string | null;
  proposedBy: string | null; proposerKind: ActorKind; approvedBy: string | null; approvedAt: string | null;
  executedBy: string | null; executedAt: string | null; verifyAfter: string | null; createdAt: string; updatedAt: string;
}

export interface Page<T> { rows: T[]; total: number; limit: number; offset: number }

// ── Repository port ──────────────────────────────────────────────────────────

export interface AiVisibilityRepository {
  listProjects(): Promise<AivProject[]>;
  getProject(idOrSlug: string): Promise<AivProject | null>;
  updateProject(id: string, patch: Partial<Omit<AivProject, 'id' | 'slug'>>): Promise<AivProject | null>;
  createProject(input: { slug: string; name: string; brandName: string; brandAliases: string[]; domains: string[]; marketCountry: string; marketCity: string | null }): Promise<AivProject>;

  listPinnedCompetitors(projectId: string): Promise<AivCompetitor[]>;
  listRegistryCompetitors(): Promise<AivCompetitor[]>;
  pinCompetitor(projectId: string, competitorId: string): Promise<boolean>;
  unpinCompetitor(projectId: string, competitorId: string): Promise<boolean>;

  listQueries(projectId: string, filter: { active?: boolean; search?: string; limit: number; offset: number }): Promise<Page<AivQuery>>;
  getQueries(projectId: string, ids: readonly string[]): Promise<AivQuery[]>;
  createQuery(projectId: string, q: Omit<AivQuery, 'id' | 'createdAt'> & { createdBy: string | null }): Promise<AivQuery | null>;
  updateQuery(projectId: string, id: string, patch: Partial<Omit<AivQuery, 'id' | 'createdAt'>>): Promise<AivQuery | null>;

  listProviderConfigs(projectId: string): Promise<AivProviderConfig[]>;
  getProviderCredential(projectId: string, provider: ProviderId): Promise<string | null>;
  updateProviderConfig(projectId: string, provider: ProviderId, patch: Partial<Pick<AivProviderConfig, 'enabled' | 'model' | 'webSearch' | 'estUsdPerCall' | 'monthlyCapUsd'>>): Promise<AivProviderConfig | null>;
  setProviderCredential(projectId: string, provider: ProviderId, ciphertext: string | null, mask: string | null): Promise<void>;
  recordProviderHealth(projectId: string, provider: ProviderId, status: 'OK' | 'FAILED', message: string): Promise<void>;

  spendToDate(projectId: string): Promise<{ todayUsd: number; monthUsd: number; providerMonthUsd: Record<string, number> }>;

  findRunByIdempotencyKey(projectId: string, key: string): Promise<AivRun | null>;
  findActiveRun(projectId: string, kind: AivRun['kind']): Promise<AivRun | null>;
  createRun(input: Omit<AivRun, 'id' | 'createdAt' | 'startedAt' | 'finishedAt' | 'succeeded' | 'failed' | 'skipped' | 'actualUsd' | 'phase' | 'error' | 'cancelRequested' | 'approvedBy'>): Promise<AivRun>;
  getRun(projectId: string, runId: string): Promise<AivRun | null>;
  getRunById(runId: string): Promise<AivRun | null>;
  listRuns(projectId: string, limit: number, offset: number, kind?: AivRun['kind']): Promise<Page<AivRun>>;
  /** Atomic compare-and-set status move; false when the run was not in `from`. */
  moveRun(runId: string, from: readonly string[], to: RunStatus, patch?: { approvedBy?: string; phase?: string; error?: string | null; started?: boolean; finished?: boolean }): Promise<boolean>;
  updateRunProgress(runId: string, p: { succeeded: number; failed: number; skipped: number; actualUsd: number; phase: string }): Promise<void>;
  requestCancel(runId: string): Promise<boolean>;
  /** Marks RUNNING runs with no progress for `minutes` as FAILED (a worker died mid-run). Returns ids. */
  failStaleRuns(minutes: number): Promise<string[]>;
  isCancelRequested(runId: string): Promise<boolean>;

  /** Idempotent: an observation already recorded for (run, query text, provider) is left untouched. */
  insertObservation(o: NewObservation): Promise<{ id: string; inserted: boolean }>;
  listObservations(projectId: string, filter: ObservationFilter): Promise<Page<AivObservationRow>>;
  getObservation(projectId: string, id: string): Promise<(AivObservationRow & { answerText: string | null; rawMetadata: Record<string, unknown> }) | null>;
  citationsFor(observationIds: readonly string[]): Promise<AivCitationRow[]>;
  mentionsFor(observationIds: readonly string[]): Promise<AivMentionRow[]>;
  /** Latest two SUCCEEDED MONITOR observations per (query, provider), newest first. */
  latestPairs(projectId: string, sinceIso: string | null): Promise<Array<{ queryId: string | null; queryText: string; provider: ProviderId; current: AivObservationRow; previous: AivObservationRow | null }>>;
  dailySeries(projectId: string, fromIso: string, toIso: string): Promise<Array<{ day: string; provider: string; answered: number; mentioned: number; eligible: number; cited: number }>>;

  createAction(a: Omit<AivAction, 'id' | 'createdAt' | 'updatedAt' | 'approvedBy' | 'approvedAt' | 'executedBy' | 'executedAt' | 'verification' | 'result'>): Promise<AivAction>;
  getAction(projectId: string, id: string): Promise<AivAction | null>;
  listActions(projectId: string, status: string | null, limit: number, offset: number): Promise<Page<AivAction>>;
  /** Compare-and-set status move with history event; false when the action was not in `from`. */
  moveAction(id: string, from: ActionStatus, to: ActionStatus, actor: { id: string | null; kind: ActorKind }, note: string | null, patch?: Partial<Pick<AivAction, 'approvedBy' | 'approvedAt' | 'executedBy' | 'executedAt' | 'result' | 'rollback' | 'verification' | 'verifyAfter' | 'baseline'>>): Promise<boolean>;
  listActionEvents(actionId: string): Promise<Array<{ fromStatus: string | null; toStatus: string; actorId: string | null; actorKind: string; note: string | null; createdAt: string }>>;
}

export interface ObservationFilter {
  runId?: string;
  queryId?: string;
  provider?: string;
  runKind?: string;
  status?: string;
  mentioned?: boolean;
  cited?: boolean;
  fromIso?: string;
  toIso?: string;
  limit: number;
  offset: number;
}

export interface RunQueue {
  enqueueRun(runId: string): Promise<boolean>;
}

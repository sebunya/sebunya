import { apiBase, type ApiEnvelope } from "./api";
import type { RecommendationPlacement } from "@goldplus/shared";

export type RecommendationRuleType = 'BOOST' | 'SUPPRESS' | 'PIN' | 'CAMPAIGN' | 'BUNDLE' | 'PLACEMENT_OVERRIDE';
export type RecommendationRuleStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED';
export type RecommendationRuleTargetType = 'PRODUCT' | 'CATEGORY' | 'PRODUCT_TYPE' | 'PRODUCT_TAG' | 'BRAND' | 'PRICE_BAND' | 'CONNECTOR' | 'PROTOCOL' | 'GLOBAL';

export interface RecommendationRuleAction {
  type: RecommendationRuleType;
  boostScore?: number;
  suppress?: boolean;
  pinPosition?: number;
  campaignLabel?: string;
}

export interface RecommendationRule {
  id: string;
  name: string;
  description?: string;
  type: RecommendationRuleType;
  status: RecommendationRuleStatus;
  priority: number;
  placement: RecommendationPlacement;
  targetType: RecommendationRuleTargetType;
  targetValue?: string;
  conditions: Record<string, any>;
  action: RecommendationRuleAction;
  startsAt?: string;
  endsAt?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationRuleAuditLog {
  id: string;
  ruleId: string;
  action: 'CREATED' | 'UPDATED' | 'STATUS_CHANGED' | 'ARCHIVED' | 'PREVIEWED' | 'ROLLED_BACK';
  before?: any;
  after?: any;
  performedBy?: string;
  performedAt: string;
  metadata: Record<string, any>;
}

export interface PreviewResultPayload {
  placement: RecommendationPlacement;
  before: any[];
  after: any[];
  appliedRuleIds: string[];
  suppressedProductIds: string[];
  pinnedProductIds: string[];
  warnings: string[];
  guardrails?: {
    emptyAfterRules: boolean;
    itemsRemoved: Array<{ productId: string; name: string }>;
    itemsAdded: Array<{ productId: string; name: string }>;
    rankMoves: Array<{ productId: string; name: string; from: number; to: number }>;
    lowStockPinned: Array<{ productId: string; name: string; stockQuantity: number }>;
  };
}

export type ApiResponseWrapper<T> = 
  | { ok: true; data: T }
  | { ok: false; message: string; code?: string; details?: any };

async function fetchAuthed<T>(path: string, token: string, init?: RequestInit): Promise<ApiResponseWrapper<T>> {
  try {
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    
    const json = await res.json().catch(() => null) as ApiEnvelope<T> | null;
    
    if (!res.ok || !json || !json.success) {
      return {
        ok: false,
        message: json?.error?.message ?? `API call failed (HTTP ${res.status}).`,
        code: json?.error?.code,
        details: (json as any)?.error?.details,
      };
    }
    
    return { ok: true, data: json.data as T };
  } catch (e) {
    return { ok: false, message: "Unable to reach API backend." };
  }
}

export async function listRecommendationRules(token: string, params: {
  placement?: string;
  status?: string;
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const q = new URLSearchParams();
  if (params.placement) q.set('placement', params.placement);
  if (params.status) q.set('status', params.status);
  if (params.type) q.set('type', params.type);
  if (params.search) q.set('search', params.search);
  if (params.page) q.set('page', params.page.toString());
  if (params.pageSize) q.set('pageSize', params.pageSize.toString());
  
  const res = await fetchAuthed<{ items: RecommendationRule[]; total: number; page: number; pageSize: number }>(`/admin/recommendations/rules?${q.toString()}`, token);
  
  if (!res.ok) return res;
  
  return {
    ok: true,
    data: {
      rules: res.data.items,
      total: res.data.total,
      page: res.data.page,
      pageSize: res.data.pageSize,
    }
  };
}

export async function getRecommendationRule(token: string, id: string) {
  return fetchAuthed<RecommendationRule>(`/admin/recommendations/rules/${encodeURIComponent(id)}`, token);
}

export async function createRecommendationRule(token: string, payload: Partial<RecommendationRule>) {
  return fetchAuthed<RecommendationRule>(`/admin/recommendations/rules`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateRecommendationRule(token: string, id: string, payload: Partial<RecommendationRule>) {
  return fetchAuthed<RecommendationRule>(`/admin/recommendations/rules/${encodeURIComponent(id)}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function changeRecommendationRuleStatus(token: string, id: string, status: RecommendationRuleStatus) {
  return fetchAuthed<RecommendationRule>(`/admin/recommendations/rules/${encodeURIComponent(id)}/status`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function archiveRecommendationRule(token: string, id: string) {
  return fetchAuthed<{ message: string }>(`/admin/recommendations/rules/${encodeURIComponent(id)}/archive`, token, {
    method: 'POST',
  });
}

export async function getRecommendationRuleAuditLog(token: string, id: string) {
  return fetchAuthed<{ items: RecommendationRuleAuditLog[] }>(`/admin/recommendations/rules/${encodeURIComponent(id)}/audit-log`, token);
}

export interface ServingHealthPayload {
  windowDays: number;
  placements: Array<{ placement: string; responses: number; empty: number; fallbackServed: number; lastResponseAt: string | null }>;
  totalResponses: number;
}

export interface LineageReportPayload {
  windowDays: number;
  total: number;
  historicPreContract: number;
  contractV2: number;
  identityUnavailable: number;
  railEventsMissingPlacement: number;
  orphanClicks: number;
  attributedAtcWithoutExposure: number;
  profileStamped: number;
}

export interface SearchIntelligencePayload {
  topQueries: Array<{ query: string; searchCount: number; lastResultCount: number }>;
  zeroResultQueries: Array<{ query: string; searchCount: number; zeroResultCount: number }>;
  clickedNeverConverted: Array<{ query: string; clickCount: number; productId: string }>;
}

export interface ModelReadinessPayload {
  stage: string;
  policyVersion: string;
  gates: Array<{ gate: string; required: number; actual: number; met: boolean }>;
  blockedBy: string[];
  recommendationExperiments: Array<{ key: string; status: string; srm: { total: number; chiSquare: number | null; srmSuspected: boolean; note: string } | null }>;
  statement: string;
}

export async function getModelReadiness(token: string) {
  return fetchAuthed<ModelReadinessPayload>(`/admin/recommendations/model/readiness`, token);
}

export async function getServingHealth(token: string, windowDays = 7) {
  return fetchAuthed<ServingHealthPayload>(`/admin/recommendations/analytics/serving?windowDays=${windowDays}`, token);
}

export async function getLineageReport(token: string, windowDays = 30) {
  return fetchAuthed<LineageReportPayload>(`/admin/recommendations/analytics/lineage?windowDays=${windowDays}`, token);
}

export async function getSearchIntelligence(token: string, limit = 10) {
  return fetchAuthed<SearchIntelligencePayload>(`/admin/recommendations/analytics/search-intelligence?limit=${limit}`, token);
}

export async function rollbackRecommendationRule(token: string, ruleId: string, auditLogId: string) {
  return fetchAuthed<RecommendationRule>(
    `/admin/recommendations/rules/${encodeURIComponent(ruleId)}/rollback/${encodeURIComponent(auditLogId)}`,
    token,
    { method: 'POST' },
  );
}

export async function previewRecommendationRules(token: string, payload: {
  placement: RecommendationPlacement;
  productId?: string;
  categoryId?: string;
  categorySlug?: string;
  cartProductIds?: string[];
  limit?: number;
  draftRule?: Partial<RecommendationRule>;
  draftOnly?: boolean;
}) {
  return fetchAuthed<PreviewResultPayload>(`/admin/recommendations/preview`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

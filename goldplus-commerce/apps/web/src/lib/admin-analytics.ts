import { apiBase, type ApiEnvelope } from "./api";
import type { RecommendationAnalyticsQuery, RecommendationAnalyticsResponse } from "@goldplus/shared";

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

export async function getRecommendationAnalytics(token: string, query: RecommendationAnalyticsQuery): Promise<ApiResponseWrapper<RecommendationAnalyticsResponse>> {
  const q = new URLSearchParams();
  if (query.startDate) q.set('startDate', query.startDate);
  if (query.endDate) q.set('endDate', query.endDate);
  if (query.placement) q.set('placement', query.placement);
  if (query.ruleId) q.set('ruleId', query.ruleId);
  if (query.productId) q.set('productId', query.productId);
  if (query.eventType) q.set('eventType', query.eventType);

  return fetchAuthed<RecommendationAnalyticsResponse>(`/admin/recommendations/analytics?${q.toString()}`, token);
}

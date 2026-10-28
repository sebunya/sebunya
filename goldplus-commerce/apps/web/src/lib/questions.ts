import { apiBase } from './api';

/**
 * Answered questions for a product (0208, gap analysis #14), from the API's public read
 * (GET /commerce/questions/products/:id). Any failure is "no questions", never an error on the product page.
 */
export interface PublicQuestion { id: string; askerName: string; question: string; answer: string; answeredAt: string }

export async function getProductQuestions(productId: string, timeoutMs = 1500): Promise<PublicQuestion[]> {
  try {
    const res = await fetch(`${apiBase}/commerce/questions/products/${encodeURIComponent(productId)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { questions?: PublicQuestion[] } } | null;
    const list = json?.success ? json.data?.questions : null;
    return Array.isArray(list) ? list.filter((q) => q && typeof q.question === 'string' && typeof q.answer === 'string') : [];
  } catch {
    return [];
  }
}

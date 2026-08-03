import { apiBase } from './api';

/**
 * Public legal-policy resolution (Wave 2C). Returns the current PUBLISHED version
 * or null — null means the page shows its truthful interim static wording. Any
 * failure (timeout, 404 NO_PUBLISHED_VERSION, network) is a null, never an error
 * surface: legal pages must render regardless of API state.
 */
export interface PublishedPolicy {
  policyKey: string;
  version: number;
  title: string;
  bodyMarkdown: string;
  effectiveAt: string | null;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export async function fetchPublishedPolicy(key: string): Promise<PublishedPolicy | null> {
  try {
    const res = await fetch(`${apiBase}/legal/${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json?.success ? (json.data as PublishedPolicy) : null;
  } catch {
    return null;
  }
}

/** Markdown-lite: blank-line-separated paragraphs; content is rendered escaped. */
export function policyParagraphs(bodyMarkdown: string): string[] {
  return bodyMarkdown
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

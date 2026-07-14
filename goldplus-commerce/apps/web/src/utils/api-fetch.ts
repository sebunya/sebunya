import { apiBase } from '../lib/api';

/**
 * Compatibility fetch for server-rendered admin pages.
 * It preserves the native Response contract and adds no auth or feature behavior.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resolvedInput = typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')
    ? `${apiBase.replace(/\/$/, '')}${input}`
    : input;

  return fetch(resolvedInput, init);
}

/**
 * Admin authenticity centre reads. Every read answers ok:false with a reason
 * instead of a number when the API fails — the page never shows fake zeros.
 */
export const FAKE_REPORT_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  investigating: 'Investigating',
  verified_fake: 'Confirmed counterfeit',
  dismissed: 'Dismissed',
};

/** The statuses the existing PATCH accepts. */
export const FAKE_REPORT_SETTABLE_STATUSES = ['investigating', 'verified_fake', 'dismissed'] as const;

export interface FakeReportRow {
  id: string;
  status: string;
  productDescription: string;
  locationFound: string;
  hologramCodeProvided: boolean;
  evidenceCount: number;
  reporterSignedIn: boolean;
  createdAt: string;
}

export interface FakeReportPage {
  items: FakeReportRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
  topLocations: Array<{ location: string; reports: number }>;
}

export interface VerificationSummary {
  windowDays: number;
  since: string;
  total: number;
  genuine: number;
  notGenuineOrUnknown: number;
  topProducts: Array<{ productId: string; productName: string | null; scans: number }>;
}

export type Read<T> = { ok: true; data: T } | { ok: false; message: string };
type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

async function readJson<T>(fetcher: Fetcher, path: string): Promise<Read<T>> {
  try {
    const res = await fetcher(path);
    const body = await res.json().catch(() => null);
    if (res.status === 401) return { ok: false, message: 'Your session has expired. Sign in again.' };
    if (res.status === 403) return { ok: false, message: 'Your role cannot read this (reports.read required).' };
    if (!res.ok || !body?.success) return { ok: false, message: body?.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, data: body.data as T };
  } catch {
    return { ok: false, message: 'The API did not answer.' };
  }
}

export function readFakeReportPage(fetcher: Fetcher, input: { page: number; status: string | null }) {
  const q = new URLSearchParams({ page: String(input.page), pageSize: '25' });
  if (input.status) q.set('status', input.status);
  return readJson<FakeReportPage>(fetcher, `/governance/admin/fake-reports?${q.toString()}`);
}

export function readVerificationSummary(fetcher: Fetcher, days: number) {
  return readJson<VerificationSummary>(fetcher, `/governance/admin/verification/summary?days=${encodeURIComponent(String(days))}`);
}

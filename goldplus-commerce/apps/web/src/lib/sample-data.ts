// Slice 10 (§7 simplification): sample operational data has been REMOVED.
//
// These arrays are now empty. Fabricated rows must never appear in an admin
// surface — a disconnected API renders an honest empty/degraded state (see
// tryFetchAdminList in lib/api.ts), never invented records. The type exports and
// empty-array exports are retained only so existing call sites compile while the
// pages are migrated to fetch live data with honest empty states.

export type SampleQuote = {
  id: string;
  customerName: string;
  productName: string;
  quantity: string;
  email: string;
  phone: string;
  status: 'new' | 'quoted' | 'lost' | 'won';
  createdAt: string;
};
export const SAMPLE_QUOTES: SampleQuote[] = [];

export type SampleSupportTicket = {
  id: string;
  subject: string;
  type: 'issue' | 'fake_report' | 'inquiry';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  createdAt: string;
};
export const SAMPLE_SUPPORT_TICKETS: SampleSupportTicket[] = [];

export type SampleFakeReport = {
  id: string;
  locationFound: string;
  hologramCode: string | null;
  status: 'new' | 'investigating' | 'verified_fake' | 'dismissed';
  createdAt: string;
};
export const SAMPLE_FAKE_REPORTS: SampleFakeReport[] = [];

export type SamplePayment = {
  id: string;
  provider: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  createdAt: string;
};
export const SAMPLE_PAYMENTS: SamplePayment[] = [];

export type SampleAuditLog = {
  id: string;
  actor: string;
  action: string;
  resource: string;
  ipAddress: string;
  createdAt: string;
};
export const SAMPLE_AUDIT_LOGS: SampleAuditLog[] = [];

export type SampleCategory = {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  isActive: boolean;
};
export const SAMPLE_CATEGORIES: SampleCategory[] = [];

export type SampleCampaign = {
  id: string;
  name: string;
  channel: string;
  status: 'active' | 'paused' | 'scheduled';
  conversionRate: string;
};
export const SAMPLE_CAMPAIGNS: SampleCampaign[] = [];

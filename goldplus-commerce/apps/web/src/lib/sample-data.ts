// Sample data shown ONLY when the corresponding admin GET endpoint is unreachable.
// Every visible string makes the placeholder origin obvious. Never used to claim records exist.

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

export const SAMPLE_QUOTES: SampleQuote[] = [
  {
    id: 'sample-quote-001',
    customerName: 'Sample data. Replace with production records.',
    productName: 'Missing. Requires admin review.',
    quantity: 'Missing. Requires admin review.',
    email: 'sample@example.com',
    phone: '+256-000-000-000',
    status: 'new',
    createdAt: new Date().toISOString(),
  },
];

export type SampleSupportTicket = {
  id: string;
  subject: string;
  type: 'issue' | 'fake_report' | 'inquiry';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  createdAt: string;
};

export const SAMPLE_SUPPORT_TICKETS: SampleSupportTicket[] = [
  {
    id: 'sample-ticket-001',
    subject: 'Sample data. Replace with production records.',
    type: 'issue',
    priority: 'medium',
    status: 'open',
    createdAt: new Date().toISOString(),
  },
];

export type SampleFakeReport = {
  id: string;
  locationFound: string;
  hologramCode: string | null;
  status: 'new' | 'investigating' | 'verified_fake' | 'dismissed';
  createdAt: string;
};

export const SAMPLE_FAKE_REPORTS: SampleFakeReport[] = [
  {
    id: 'sample-fake-001',
    locationFound: 'Sample data. Replace with production records.',
    hologramCode: null,
    status: 'new',
    createdAt: new Date().toISOString(),
  },
];

export type SamplePayment = {
  id: string;
  provider: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  createdAt: string;
};

export const SAMPLE_PAYMENTS: SamplePayment[] = [
  {
    id: 'sample-pay-001',
    provider: 'mtn',
    orderId: 'sample-order-001',
    amount: 0,
    currency: 'UGX',
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  },
];

export type SampleAuditLog = {
  id: string;
  actor: string;
  action: string;
  resource: string;
  ipAddress: string;
  createdAt: string;
};

export const SAMPLE_AUDIT_LOGS: SampleAuditLog[] = [
  {
    id: 'sample-audit-001',
    actor: 'System Monitor',
    action: 'BOOT_COMPLETED',
    resource: 'APP_SERVER',
    ipAddress: '127.0.0.1',
    createdAt: new Date().toISOString(),
  },
];

export type SampleCategory = {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  isActive: boolean;
};

export const SAMPLE_CATEGORIES: SampleCategory[] = [
  {
    id: 'sample-cat-001',
    name: 'Sample Category',
    slug: 'sample-category',
    productCount: 0,
    isActive: true,
  },
];

export type SampleCampaign = {
  id: string;
  name: string;
  channel: string;
  status: 'active' | 'paused' | 'scheduled';
  conversionRate: string;
};

export const SAMPLE_CAMPAIGNS: SampleCampaign[] = [
  {
    id: 'sample-camp-001',
    name: 'Sample Campaign. Not Active.',
    channel: 'Direct',
    status: 'paused',
    conversionRate: '0%',
  },
];


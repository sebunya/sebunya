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

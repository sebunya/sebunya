export interface NavItem {
  label: string;
  href: string;
  group: 'Dashboard' | 'Commerce' | 'Recommendations' | 'Merchandising' | 'System' | 'Other';
  status: 'working' | 'read_only' | 'diagnostic' | 'hidden';
  description: string;
  reason?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const ADMIN_NAVIGATION_ITEMS: NavItem[] = [
  {
    label: 'Control Centre',
    href: '/admin',
    group: 'Dashboard',
    status: 'working',
    description: 'Unified administration oversight and system-wide statuses.'
  },
  {
    label: 'Products',
    href: '/admin/products',
    group: 'Commerce',
    status: 'working',
    description: 'Manage physical catalogue items, definitions and specs.'
  },
  {
    label: 'Carts',
    href: '/admin/carts',
    group: 'Commerce',
    status: 'working',
    description: 'Inspect active shopping baskets, sessions and diagnostics.'
  },
  {
    label: 'Orders',
    href: '/admin/orders',
    group: 'Commerce',
    status: 'hidden',
    description: 'Read-only relational query of active buyer records.',
    reason: 'Logistical lifecycles and fulfillment processing not yet implemented.'
  },
  {
    label: 'Recommendations',
    href: '/admin/recommendations',
    group: 'Recommendations',
    status: 'working',
    description: 'Manage product recommendations shown across the store.'
  },
  {
    label: 'Rules',
    href: '/admin/recommendations/rules',
    group: 'Recommendations',
    status: 'working',
    description: 'Rules that boost, suppress or pin specific products.'
  },
  {
    label: 'Create rule',
    href: '/admin/recommendations/rules/new',
    group: 'Recommendations',
    status: 'working',
    description: 'Create a new recommendation rule.'
  },
  {
    label: 'Preview',
    href: '/admin/recommendations/preview',
    group: 'Recommendations',
    status: 'working',
    description: 'Test and preview rules before activation.'
  },
  {
    label: 'Merchandising',
    href: '/admin/merchandising',
    group: 'Merchandising',
    status: 'read_only',
    description: 'Manage sections on the homepage.'
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    group: 'System',
    status: 'diagnostic',
    description: 'Review app configuration values.',
    reason: 'Read-only view.'
  },
  {
    label: 'System status',
    href: '/admin/system',
    group: 'System',
    status: 'diagnostic',
    description: 'Check service and route availability.',
    reason: 'Diagnostic tools.'
  },
  {
    label: 'Access',
    href: '/admin/governance',
    group: 'System',
    status: 'hidden',
    description: 'Permissions and role definitions.'
  },
  // Hidden Modules
  {
    label: 'Categories',
    href: '/admin/categories',
    group: 'Commerce',
    status: 'hidden',
    description: 'Organize inventory into customer-facing groupings.'
  },
  {
    label: 'Inventory',
    href: '/admin/inventory',
    group: 'Commerce',
    status: 'hidden',
    description: 'Track availability status, safety stock and counts.'
  },
  {
    label: 'Pricing',
    href: '/admin/pricing',
    group: 'Commerce',
    status: 'hidden',
    description: 'Control Ugandan Shilling rates, currencies and wholesale levels.'
  },
  {
    label: 'Authenticity Check',
    href: '/admin/verification',
    group: 'Other',
    status: 'hidden',
    description: 'Lookup holographic sequence status and scans.'
  },
  {
    label: 'Dealer Requests',
    href: '/admin/dealers',
    group: 'Other',
    status: 'hidden',
    description: 'Assess retail applications for wholesale credentials.'
  },
  {
    label: 'Price Quotes',
    href: '/admin/quotes',
    group: 'Other',
    status: 'hidden',
    description: 'Formulate responses to corporate procurement enquiries.'
  },
  {
    label: 'Support Tickets',
    href: '/admin/support',
    group: 'Other',
    status: 'hidden',
    description: 'Assist users with technical difficulties and support cases.'
  }
];

// Group helper to replicate traditional display grouping without duplicate data
export const ADMIN_NAVIGATION: NavGroup[] = [
  {
    title: 'Dashboard',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Dashboard' && item.status !== 'hidden')
  },
  {
    title: 'Commerce',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Commerce' && item.status !== 'hidden')
  },
  {
    title: 'Recommendations',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Recommendations' && item.status !== 'hidden')
  },
  {
    title: 'Merchandising',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'Merchandising' && item.status !== 'hidden')
  },
  {
    title: 'System',
    items: ADMIN_NAVIGATION_ITEMS.filter(item => item.group === 'System' && item.status !== 'hidden')
  }
];


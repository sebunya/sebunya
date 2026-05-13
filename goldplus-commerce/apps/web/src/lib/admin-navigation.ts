export interface NavItem {
  label: string;
  href: string;
  status: 'live' | 'coming_soon' | 'needs_api';
  description: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const ADMIN_NAVIGATION: NavGroup[] = [
  {
    title: 'Dashboard',
    items: [
      {
        label: 'Control Centre',
        href: '/admin',
        status: 'live',
        description: 'Unified administration oversight and system-wide statuses.',
      },
    ],
  },
  {
    title: 'Commerce',
    items: [
      {
        label: 'Products',
        href: '/admin/products',
        status: 'live',
        description: 'Manage physical catalogue items, definitions and specs.',
      },
      {
        label: 'Categories',
        href: '/admin/categories',
        status: 'live',
        description: 'Organize inventory into customer-facing groupings.',
      },
      {
        label: 'Inventory',
        href: '/admin/inventory',
        status: 'needs_api',
        description: 'Track availability status, safety stock and counts.',
      },
      {
        label: 'Pricing',
        href: '/admin/pricing',
        status: 'needs_api',
        description: 'Control Ugandan Shilling rates, currencies and wholesale levels.',
      },
      {
        label: 'Orders',
        href: '/admin/orders',
        status: 'live',
        description: 'Process buyer fulfillments, payments and logistical lifecycles.',
      },
      {
        label: 'Carts',
        href: '/admin/carts',
        status: 'live',
        description: 'Inspect active shopping baskets, sessions and abandonment.',
      },
    ],
  },
  {
    title: 'Recommendations',
    items: [
      {
        label: 'Rules Engine',
        href: '/admin/recommendations/rules',
        status: 'live',
        description: 'Configure custom boosts, pins, suppression and exclusions.',
      },
      {
        label: 'Sandbox Simulator',
        href: '/admin/recommendations/preview',
        status: 'live',
        description: 'Preview ranking outputs using live catalog contexts.',
      },
      {
        label: 'Placement Audit',
        href: '/admin/recommendations',
        status: 'live',
        description: 'Overview of all recommendation zones embedded in views.',
      },
    ],
  },
  {
    title: 'Merchandising',
    items: [
      {
        label: 'Homepage Highlights',
        href: '/admin/merchandising',
        status: 'live',
        description: 'Review promotional hero cards and GoldPlus Pick surfaces.',
      },
      {
        label: 'Campaign Surfaces',
        href: '/admin/merchandising#campaigns',
        status: 'coming_soon',
        description: 'Schedule temporary banners and seasonal collection pushes.',
      },
      {
        label: 'Flash Sales',
        href: '/admin/merchandising#flash',
        status: 'coming_soon',
        description: 'Timed urgent discount parameters and landing activations.',
      },
    ],
  },
  {
    title: 'Trust & Verification',
    items: [
      {
        label: 'Authenticity Check',
        href: '/admin/verification',
        status: 'live',
        description: 'Lookup holographic sequence status and scans.',
      },
      {
        label: 'Counterfeit Reports',
        href: '/admin/verification#reports',
        status: 'coming_soon',
        description: 'Review user submissions flag potential fakes.',
      },
    ],
  },
  {
    title: 'Business Requests',
    items: [
      {
        label: 'Dealer Requests',
        href: '/admin/dealers',
        status: 'live',
        description: 'Assess retail applications for wholesale credentials.',
      },
      {
        label: 'Price Quotes',
        href: '/admin/quotes',
        status: 'live',
        description: 'Formulate responses to corporate procurement enquiries.',
      },
    ],
  },
  {
    title: 'Support & Governance',
    items: [
      {
        label: 'Support Tickets',
        href: '/admin/support',
        status: 'live',
        description: 'Assist users with technical difficulties and support cases.',
      },
      {
        label: 'System Audit Logs',
        href: '/admin/audit',
        status: 'live',
        description: 'Immutable stream of every critical modification executed.',
      },
      {
        label: 'Platform Governance',
        href: '/admin/governance',
        status: 'live',
        description: 'Manage roles, capabilities and security parameters.',
      },
      {
        label: 'Platform Settings',
        href: '/admin/settings',
        status: 'live',
        description: 'Global toggles and variables backing runtime operations.',
      },
      {
        label: 'System Health',
        href: '/admin/system',
        status: 'live',
        description: 'Assess server availability, network latency and environments.',
      },
    ],
  },
];

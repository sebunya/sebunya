import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Marketing attribution for an order (0111). A SIDE table keyed by the order,
 * written best-effort after checkout — never on the money path. Last-touch UTM +
 * referrer, plus the first-touch timestamp so a report can tell new from returning.
 */
export const orderAttribution = pgTable(
  'order_attribution',
  {
    orderId: uuid('order_id').primaryKey(),
    orderNumber: varchar('order_number', { length: 20 }),
    source: varchar('source', { length: 120 }),
    medium: varchar('medium', { length: 120 }),
    campaign: varchar('campaign', { length: 160 }),
    term: varchar('term', { length: 160 }),
    content: varchar('content', { length: 160 }),
    landingPath: text('landing_path'),
    referrer: text('referrer'),
    firstAt: timestamp('first_at', { withTimezone: true }),
    // 0136: the visitor as GA4 knows it, so a server-confirmed purchase joins its visit.
    fpClientId: varchar('fp_client_id', { length: 255 }),
    clientIp: varchar('client_ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 1024 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    numberIdx: index('order_attribution_number_idx').on(t.orderNumber),
    channelIdx: index('order_attribution_channel_idx').on(t.source, t.medium, t.campaign),
    createdIdx: index('order_attribution_created_idx').on(t.createdAt),
  }),
);

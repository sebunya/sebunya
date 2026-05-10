import { pgTable, uuid, varchar, timestamp, text, jsonb } from 'drizzle-orm/pg-core';

export const dealerApplications = pgTable('dealer_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessName: varchar('business_name', { length: 255 }).notNull(),
  contactName: varchar('contact_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  tinNumber: varchar('tin_number', { length: 50 }).notNull(),
  location: varchar('location', { length: 255 }).notNull(),

  experience: text('experience'),
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, under_review, approved, rejected
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const quoteRequests = pgTable('quote_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  quantity: varchar('quantity', { length: 50 }).notNull(),
  message: text('message'),
  status: varchar('status', { length: 50 }).default('new').notNull(), // new, quoted, lost, won
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const supportIssues = pgTable('support_issues', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id'),
  subject: varchar('subject', { length: 255 }).notNull(),
  description: text('description').notNull(),
  status: varchar('status', { length: 50 }).default('open').notNull(), // open, in-progress, resolved, closed
  priority: varchar('priority', { length: 50 }).default('medium').notNull(), // low, medium, high, urgent
  type: varchar('type', { length: 50 }).notNull(), // issue, fake_report, inquiry
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});


export const fakeProductReports = pgTable('fake_product_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  reporterName: varchar('reporter_name', { length: 255 }),
  reporterContact: varchar('reporter_contact', { length: 255 }),
  locationFound: varchar('location_found', { length: 255 }).notNull(),
  productDescription: text('product_description').notNull(),
  hologramCode: varchar('hologram_code', { length: 100 }),
  evidenceUrls: jsonb('evidence_urls').$type<string[]>().default([]),
  status: varchar('status', { length: 50 }).default('new').notNull(), // new, investigating, verified_fake, dismissed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

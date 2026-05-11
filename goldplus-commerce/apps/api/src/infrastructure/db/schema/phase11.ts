import { pgTable, uuid, varchar, text, integer, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { products, categories } from './products';
import { users } from './identity';

/**
 * Phase 1.1 scaffolds — schema only this pass; use cases land in Pass 10.
 *
 * - product_images: per-product image gallery, URL-only for now
 * - attributes: dynamic per-category spec definitions (e.g. "Wattage" under "Power")
 * - product_attribute_values: typed values for each (product, attribute) pair
 * - wishlists: per-user saved products
 * - notification_attempts: append-only log of every send through any channel
 */

export const productImages = pgTable('product_images', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  altText: varchar('alt_text', { length: 255 }),
  displayOrder: integer('display_order').default(0).notNull(),
  isPrimary: boolean('is_primary').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const attributes = pgTable('attributes', {
  id: uuid('id').defaultRandom().primaryKey(),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }).notNull(),
  slug: varchar('slug', { length: 60 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  unit: varchar('unit', { length: 20 }),
  isRequired: boolean('is_required').default(false).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
});

export const productAttributeValues = pgTable(
  'product_attribute_values',
  {
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
    attributeId: uuid('attribute_id').references(() => attributes.id, { onDelete: 'cascade' }).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    isVerified: boolean('is_verified').default(false).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.productId, table.attributeId] }),
  }),
);

export const wishlists = pgTable(
  'wishlists',
  {
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.productId] }),
  }),
);

export const notificationAttempts = pgTable('notification_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  channel: varchar('channel', { length: 20 }).notNull(), // whatsapp, email, sms
  recipient: varchar('recipient', { length: 255 }).notNull(),
  template: varchar('template', { length: 100 }).notNull(),
  status: varchar('status', { length: 30 }).default('PENDING').notNull(), // PENDING | SENT | FAILED | NOT_CONFIGURED
  providerCode: varchar('provider_code', { length: 50 }), // raw provider response code
  providerMessage: text('provider_message'),
  relatedEntity: varchar('related_entity', { length: 50 }), // order, dealer, quote, fake_report, support_ticket
  relatedEntityId: uuid('related_entity_id'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
});

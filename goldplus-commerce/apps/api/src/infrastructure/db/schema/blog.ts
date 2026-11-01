import { pgTable, uuid, varchar, text, timestamp, integer, index, primaryKey } from 'drizzle-orm/pg-core';
import { products } from './products';
import { users } from './identity';

/** Editorial articles (0126). The storefront's only writing surface. */
export const blogPosts = pgTable(
  'blog_posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 200 }).notNull().unique(),
    title: varchar('title', { length: 200 }).notNull(),
    excerpt: varchar('excerpt', { length: 400 }).default('').notNull(),
    body: text('body').default('').notNull(),
    coverImageUrl: varchar('cover_image_url', { length: 1000 }),
    coverImageAlt: varchar('cover_image_alt', { length: 300 }),
    status: varchar('status', { length: 16 }).default('DRAFT').notNull(),
    metaTitle: varchar('meta_title', { length: 200 }),
    metaDescription: varchar('meta_description', { length: 320 }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    authorId: uuid('author_id').references(() => users.id),
    authorName: varchar('author_name', { length: 120 }).default('GoldPlus').notNull(),
  },
  (table) => ({
    publishedIdx: index('blog_posts_published_idx').on(table.status, table.publishedAt),
  }),
);

/** The products an article recommends — internal links to real stock. */
export const blogPostProducts = pgTable(
  'blog_post_products',
  {
    postId: uuid('post_id').notNull().references(() => blogPosts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').default(0).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.postId, table.productId] }),
    productIdx: index('blog_post_products_product_idx').on(table.productId),
  }),
);

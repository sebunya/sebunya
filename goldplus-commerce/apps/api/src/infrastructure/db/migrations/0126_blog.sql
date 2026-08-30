-- Editorial articles: the storefront's own writing surface (0126).
--
-- WHY
-- The shop has no way to publish a written page. The SEO engine already tells
-- us what people ask (`seo_intel_answer_units`) and which clusters have no
-- owning page, but there was nowhere to PUT an answer: every URL the site can
-- serve is a product, a category hub or a policy page. So the only content that
-- could ever rank was the catalogue itself, and informational demand
-- ("which power bank for a Tecno", "how do I know a charger is fake") had no
-- page to land on.
--
-- This is ADDITIVE. It adds one table for the articles and one join table for
-- the products an article recommends, so an article can send readers to stock
-- and the SEO engine can later see a real URL to attribute a cluster to.
--
-- The body is stored as TEXT written in a restricted markup, and is escaped and
-- rendered by the storefront. Raw HTML is never stored or rendered: an admin
-- editor that accepts HTML is a stored-XSS hole aimed at the operator's own
-- session.
--
-- Nothing is seeded. An empty blog renders an honest empty state; it never
-- invents an article.
--
-- MIGRATION_REQUIRED=true: no existing table can hold a titled, slugged,
-- publishable document with its own SEO metadata.
--
-- LOCK RISK: none. Two new tables, no ALTER of anything in use.

create table if not exists blog_posts (
  id                uuid primary key default gen_random_uuid(),
  slug              varchar(200) not null unique,
  title             varchar(200) not null,
  -- Shown on cards and in search results. Never auto-filled with the first
  -- sentence of the body: a summary written for a reader beats a truncation.
  excerpt           varchar(400) not null default '',
  body              text         not null default '',
  cover_image_url   varchar(1000),
  cover_image_alt   varchar(300),
  -- DRAFT is invisible to the storefront and noindex; only PUBLISHED is served.
  status            varchar(16)  not null default 'DRAFT',
  -- The operator's own SEO overrides. Null means "derive it from the article",
  -- which is the honest default rather than an empty tag.
  meta_title        varchar(200),
  meta_description  varchar(320),
  -- Set once, on first publish, and never moved by an edit: a changing date on
  -- an unchanged article is a lie to both readers and crawlers.
  published_at      timestamptz,
  updated_at        timestamptz  not null default now(),
  created_at        timestamptz  not null default now(),
  author_id         uuid references users(id),
  author_name       varchar(120) not null default 'GoldPlus',
  constraint blog_posts_status_check check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  -- A published article must have a date; a draft must not pretend to have one.
  constraint blog_posts_published_at_check check (
    (status = 'PUBLISHED' and published_at is not null)
    or (status <> 'PUBLISHED')
  )
);

-- The storefront lists published articles newest first; the admin lists all.
create index if not exists blog_posts_published_idx
  on blog_posts (status, published_at desc);

create table if not exists blog_post_products (
  post_id     uuid not null references blog_posts(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  position    integer not null default 0,
  primary key (post_id, product_id)
);

create index if not exists blog_post_products_product_idx
  on blog_post_products (product_id);

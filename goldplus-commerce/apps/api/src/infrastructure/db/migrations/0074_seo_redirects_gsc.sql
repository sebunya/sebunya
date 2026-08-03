-- U6 §17 — SEO redirects + GSC performance warehouse.
--
-- WHY
-- redirects is the precondition for URL restructuring: a slug change auto-creates
-- a 301 so the old URL resolves instead of 404ing. gsc_performance is the organic
-- measurement warehouse (there is currently no organic measurement of any kind),
-- joined to product and revenue. Live GSC ingestion uses real credentials; no
-- fabricated Google evidence is inserted here.
--
-- LOCK RISK: additive (two new tables + indexes). Safe online.

CREATE TABLE redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_path varchar(512) NOT NULL,
  to_path varchar(512) NOT NULL,
  status_code integer NOT NULL DEFAULT 301,
  reason varchar(120),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  CONSTRAINT redirects_status_chk CHECK (status_code IN (301, 302, 307, 308)),
  CONSTRAINT redirects_no_self_loop_chk CHECK (from_path <> to_path)
);
CREATE UNIQUE INDEX redirects_from_path_idx ON redirects (from_path);

CREATE TABLE gsc_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  page varchar(512) NOT NULL,
  query varchar(300) NOT NULL,
  product_id uuid REFERENCES products(id),
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  position double precision,
  ctr double precision
);
CREATE INDEX gsc_performance_date_idx ON gsc_performance (date);
CREATE INDEX gsc_performance_page_date_idx ON gsc_performance (page, date);
CREATE UNIQUE INDEX gsc_performance_date_page_query_idx ON gsc_performance (date, page, query);

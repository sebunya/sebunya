# Content Management System (CMS)

Admin-managed pages published to the public site, with append-only revision
history, scheduled publish/expire windows, and SEO metadata.

## Model

- **cms_pages** — the live page (current version). Slug is immutable after
  creation (stable URLs). Body is a documented markdown subset.
- **cms_page_revisions** — one row per version, appended on every content edit.
  History is never rewritten; reverting re-applies an old revision as a **new**
  version.

Status lifecycle: `DRAFT → PUBLISHED → ARCHIVED` (and back to DRAFT from either).
A page is publicly visible only when `PUBLISHED` and inside its optional
`publishAt`/`expireAt` window — the scheduling feature.

## Admin API (permission `content.manage`; all writes audit-logged)

```
GET    /admin/cms                      # list pages
POST   /admin/cms                      # create (starts DRAFT)
PUT    /admin/cms/:id                  # edit content -> new version
PATCH  /admin/cms/:id/status           # { status, publishAt?, expireAt? }
GET    /admin/cms/:id/revisions        # revision history
POST   /admin/cms/:id/revert/:version  # revert (as a new version)
```

Create/edit payload:

```json
{
  "slug": "about-us",
  "title": "About GoldPlus",
  "body": "## Our story\n\nWe sell **original** electronics...",
  "excerpt": "Short summary for cards and meta description fallback.",
  "metaTitle": "About GoldPlus | Original Electronics in Uganda",
  "metaDescription": "Who we are and why authenticity matters."
}
```

## Public surface

- API: `GET /content/pages/:slug` returns a page **only** when visible; otherwise 404.
- API: `GET /content/sitemap` lists visible slugs (feeds the web sitemap).
- Web: `/p/<slug>` (`apps/web/src/pages/p/[slug].astro`) renders the page inside
  the site layout, using `metaTitle`/`metaDescription` for SEO. Published pages
  are automatically added to `/sitemap.xml`.

## Content format & safety

Bodies use a small, safe markdown subset rendered by
`apps/web/src/lib/markdown.ts`: headings (`#`→h2, `##`→h3, `###`→h4), `**bold**`,
`*italic*`, `` `code` ``, links `[label](url)`, blockquotes, and ordered/unordered
lists. All text is HTML-escaped before formatting and links are restricted to
`http(s)`, `mailto:`, and site-relative URLs — stored content cannot inject markup
or scripts. This is intentionally not a full WYSIWYG/rich-media editor (see the
roadmap for the media library and WYSIWYG follow-ups).

## Testing

`tests/unit/CmsPage.test.ts` (validation, lifecycle, visibility windows, versioning,
revert-as-new-version, publish-window guards) and `tests/unit/Markdown.test.ts`
(subset rendering + injection/`javascript:` URL protection).

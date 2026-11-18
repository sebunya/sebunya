/**
 * The answer a page route gives when the thing it was asked for does not exist:
 * an empty 404, which Astro reroutes to 404.astro (only a 404/500 with a null
 * body is rerouted; a route that wants its own 404 page sends a body).
 *
 * Replaces `Astro.redirect('/404', 404)`, which reached the same 404 page but is
 * not a redirect (its type only allows 3xx) and attached a meaningless
 * `location: /404` header to the 404 response (2026-11).
 */
export function notFound(): Response {
  return new Response(null, { status: 404 });
}

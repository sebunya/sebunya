import { Hono } from 'hono';
import { ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../infrastructure/Registry';

/**
 * Public legal-policy resolution (Wave 2C). One endpoint, read-only: the storefront
 * pages ask for the current effective version and fall back to their truthful
 * interim static wording when nothing is published. No body is ever served from an
 * unapproved draft — resolution only returns PUBLISHED versions (lazily promoting a
 * due SCHEDULED one).
 */
const routes = new Hono();

const KEY_RE = /^[a-z_]{2,40}$/;

routes.get('/:key', async (c) => {
  const key = c.req.param('key') ?? '';
  if (!KEY_RE.test(key)) {
    return c.json({ success: false, error: { code: 'BAD_KEY', message: 'Unknown policy key.' } } satisfies ApiResponse<never>, 400);
  }
  const version = await Registry.getInstance().legalCmsUseCase.resolveCurrent(key);
  if (!version) {
    return c.json(
      { success: false, error: { code: 'NO_PUBLISHED_VERSION', message: 'No published version for this policy yet.' } } satisfies ApiResponse<never>,
      404,
    );
  }
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    success: true,
    data: {
      policyKey: version.policyKey,
      version: version.version,
      title: version.title,
      bodyMarkdown: version.bodyMarkdown,
      effectiveAt: version.effectiveAt,
      publishedAt: version.publishedAt,
      seoTitle: version.seoTitle,
      seoDescription: version.seoDescription,
    },
  } satisfies ApiResponse<unknown>);
});

export default routes;

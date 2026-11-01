/**
 * The JPEG twin of a product image rendition.
 *
 * Every uploaded product image is stored as thumb / card / pdp renditions in
 * AVIF, WebP and JPEG (SharpVariantGenerator); pages show the WebP one. Meta's
 * catalogue accepts JPEG and PNG only, and a share-card crawler is safest with
 * JPEG, so a URL that leaves the site for Meta names the JPEG rendition of the
 * same picture. Any other URL (a legacy upload, a static file, another host's
 * picture) is returned unchanged: its JPEG twin is not known to exist.
 */
const RENDITION = /^((?:https?:\/\/[^/]+)?\/uploads\/assets\/[0-9a-f]{2}\/[0-9a-f]{6,64}\/(?:pdp|card|thumb))\.(?:webp|avif)(\?[^#]*)?$/i;

export function jpegRendition(url: string): string {
  const m = RENDITION.exec(url);
  return m ? `${m[1]}.jpg${m[2] ?? ''}` : url;
}

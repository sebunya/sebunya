/**
 * Goldie's portrait (owner-supplied, 2026-10-13), in place of the "G" monogram. Cropped to head and
 * headset so the face reads at button size; 3 to 15 KB per size. The "G" stays underneath as the
 * fallback when an image cannot load (empty alt shows nothing broken).
 *
 * Goldie is the GoldPlus personal shopper (owner, 2026-10-13: that is her title; no "AI" tag or word
 * on screen, and no "not a person" line either). She never claims to be human: asked, she says she is
 * virtual (router IDENTITY reply and the prompt).
 */
export const GOLDIE_AVATAR_SRC = '/goldie/goldie-v1-160.webp';
export const GOLDIE_AVATAR_SRCSET = '/goldie/goldie-v1-96.webp 96w, /goldie/goldie-v1-160.webp 160w, /goldie/goldie-v1-320.webp 320w';

/** The portrait as a DOM node, for avatars the panel script creates. */
export function goldieAvatarImg(sizePx: number): HTMLImageElement {
  const img = document.createElement('img');
  img.src = GOLDIE_AVATAR_SRC; img.srcset = GOLDIE_AVATAR_SRCSET; img.sizes = `${sizePx}px`;
  img.width = sizePx; img.height = sizePx; img.alt = ''; img.decoding = 'async';
  img.className = 'gp-assistant__face';
  return img;
}

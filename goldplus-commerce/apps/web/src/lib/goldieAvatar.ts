/**
 * Goldie's portrait (owner-supplied, 2026-10-13), in place of the "G" monogram. Cropped to head and
 * headset so the face reads at button size; 3 to 15 KB per size. The "G" stays underneath as the
 * fallback when an image cannot load (empty alt shows nothing broken).
 *
 * The portrait looks like a person, so an "AI" tag sits on it wherever Goldie greets a shopper
 * (launcher, panel header) and the panel says "AI" in words: nobody should think a human is typing.
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

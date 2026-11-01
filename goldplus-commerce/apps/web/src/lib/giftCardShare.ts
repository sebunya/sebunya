import { BRAND, giftCardTheme, logoUrl } from './giftCardThemes';
import { giftCardPhotoUrl } from './giftCardPhoto';
import { GIFT_CARD_NAME_MAX, clipText } from '@goldplus/shared/src/gift-cards/giftText';

/**
 * "Share your gift" (2026-10-21): a picture of the gift for the recipient to post, drawn from scratch on a canvas.
 *
 * The renderer receives ShareContent and nothing else: an explicit list of permitted fields, each one the recipient
 * switched on. It never sees the card record, the code, the balance, the private link, a phone number or a
 * reference, so none of them can reach the pixels, the file name or the caption. Not a screenshot of the card page.
 */
export interface ShareContent {
  occasion: string;
  /** Each present only when the recipient chose it. */
  recipientName?: string;
  senderName?: string;
  message?: string;
  /** The ORIGINAL value of the gift; never the balance. */
  originalUgx?: number;
  /** 0201: the sender's photo (a same-site URL), only when the recipient chose to show it. */
  photoUrl?: string;
}

export type ShareSize = 'square' | 'story';
export const SHARE_SIZES: Record<ShareSize, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: 'Square' },
  story: { w: 1080, h: 1920, label: 'Story / Status' },
};

/** The fields the share panel may pass on, and nothing else (also what the tests check). */
export const PERMITTED_SHARE_FIELDS = ['occasion', 'recipientName', 'senderName', 'message', 'originalUgx', 'photoUrl'] as const;

/** Build the content from the recipient's choices: only switched-on fields, only from the permitted list. */
export function shareContent(source: { occasion: string; recipientName?: string | null; senderName?: string | null; message?: string | null; originalUgx?: number | null; photoUrl?: string | null },
  choose: { recipientName: boolean; senderName: boolean; message: boolean; amount: boolean; photo?: boolean }, messageOverride?: string | null): ShareContent {
  const out: ShareContent = { occasion: giftCardTheme(source.occasion).key };
  if (choose.recipientName && source.recipientName) out.recipientName = clipText(source.recipientName.trim(), GIFT_CARD_NAME_MAX);
  if (choose.senderName && source.senderName) out.senderName = clipText(source.senderName.trim(), GIFT_CARD_NAME_MAX);
  const message = (messageOverride ?? source.message ?? '').trim();
  if (choose.message && message) out.message = clipText(message, 200);
  if (choose.amount && Number.isFinite(source.originalUgx) && (source.originalUgx ?? 0) > 0) out.originalUgx = Math.round(source.originalUgx!);
  // Only the shop's own photo address (a same-site picture keeps the canvas exportable; nothing else is fetched).
  const photo = source.photoUrl?.startsWith('/gift-card/photo/') ? giftCardPhotoUrl(source.photoUrl.slice('/gift-card/photo/'.length)) : null;
  if (choose.photo && photo) out.photoUrl = photo;
  return out;
}

/** The captions offered: the occasion's own first, then the general thank-yous (always there). Never the message. */
export function captionSuggestions(occasion: string): string[] {
  const general = ['This made my day. Thank you ❤️', 'Wasn’t expecting this. Thank you so much 🎁'];
  const own: Record<string, string[]> = {
    birthday: ['Such a thoughtful birthday surprise. Thank you! 🎂'],
    anniversary: ['An anniversary surprise from my favourite person. ❤️'],
    christmas: ['Someone made Christmas extra special. Thank you ❤️'],
    love: ['Feeling very loved today. ❤️'], valentine: ['Feeling very loved today. ❤️'], mothers_day: ['Feeling very loved today. ❤️'],
  };
  return [...(own[occasion] ?? []), ...general];
}

/** The public page for buying a gift card (never the recipient's own link). Tagged like the referral links: a friend
 *  who taps it in a WhatsApp status or a chat arrives with no referrer, and GA4 called it Direct (2026-10-23). */
export const PUBLIC_BUY_URL = 'https://shopgoldplus.com/gift-card/buy?utm_source=customer_share&utm_medium=friend&utm_campaign=gift_card';

export function shareFileName(occasion: string, size: ShareSize): string {
  return `goldplus-gift-${giftCardTheme(occasion).key.replace(/_/g, '-')}-${size}.png`;
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-US')}`;
// 'Montserrat Fallback' is Arial sized to Montserrat (global.css): if the brand face could not load, the picture keeps
// its measured proportions instead of falling to another family's.
const FONT = 'Montserrat, "Montserrat Fallback", Arial, sans-serif';
const font = (weight: number, px: number) => `${weight} ${Math.round(px)}px ${FONT}`;

/** What layout needs from a canvas: set a font, measure a string (a real 2D context, or a test's stand-in). */
export type ShareMeasure = Pick<CanvasRenderingContext2D, 'font' | 'measureText'> & { letterSpacing?: string };

/** Words into lines that fit `maxWidth` (an over-long word is broken, never shrunk). */
export function wrapLines(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(tryLine).width <= maxWidth) { line = tryLine; continue; }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
    // A single very long word: split it by characters (whole characters: an emoji is never cut in two).
    let part = '';
    for (const ch of Array.from(word)) {
      if (ctx.measureText(part + ch).width > maxWidth) { lines.push(part); part = ch; } else part += ch;
    }
    line = part;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The greeting's lines: its own preferred breaks (\n), a soft hyphen used only when a word will not fit, and the
 * size stepped down (to a floor) until the longest line fits. The note is never shrunk; the greeting may be.
 */
export function greetingLines(ctx: Pick<CanvasRenderingContext2D, 'measureText' | 'font'>, headline: string, maxWidth: number, px: number, weight = 800): { lines: string[]; px: number } {
  for (let size = px; size >= px * 0.62; size -= 2) {
    ctx.font = font(weight, size);
    const lines = headline.split('\n').flatMap((l) => {
      const plain = l.replace(/­/g, '');
      if (ctx.measureText(plain).width <= maxWidth || !l.includes('­')) return wrapLines(ctx, plain, maxWidth);
      const [first, second] = l.split('­');
      return [`${first}-`, second];
    });
    if (lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { lines, px: size };
  }
  ctx.font = font(weight, px * 0.62);
  return { lines: wrapLines(ctx, headline.replace(/­/g, '').replace(/\n/g, ' '), maxWidth), px: px * 0.62 };
}

/**
 * A name in at most two lines: the size steps down (to 60%) before anything is cut, so a long name is shown whole
 * rather than losing its end without a mark.
 */
function nameLines(ctx: ShareMeasure, name: string, maxWidth: number, px: number): { lines: string[]; px: number } {
  for (let size = px; size >= px * 0.6; size -= 2) {
    ctx.font = font(700, size);
    const lines = wrapLines(ctx, name, maxWidth);
    if (lines.length <= 2) return { lines, px: size };
  }
  ctx.font = font(700, px * 0.6);
  return { lines: wrapLines(ctx, name, maxWidth), px: px * 0.6 };
}

/** One line that fits `room`, cut at a whole character with an ellipsis when it must be cut (the band's "From"). */
function fitOneLine(ctx: ShareMeasure, text: string, room: number): string {
  if (ctx.measureText(text).width <= room) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(`${chars.join('').trimEnd()}…`).width > room) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/**
 * Two compositions on the card's own system (brand area, greeting, the person and the note, the illustration in its
 * own area, the information band):
 *  - square: the words on the left, the illustration (or photo) in its column on the right, the band across the foot;
 *  - story: the illustration (or photo) above, the words below, the band at the foot; the top 250 px and bottom 280 px
 *    hold no words (the apps draw their own controls there).
 */
interface Layout { margin: number; logoH: number; greeting: number; label: number; name: number; note: number; band: number; bandText: number; amount: number; noteMaxLines: number }
const LAYOUTS: Record<ShareSize, Layout> = {
  square: { margin: 80, logoH: 50, greeting: 80, label: 24, name: 52, note: 33, band: 156, bandText: 34, amount: 44, noteMaxLines: 7 },
  story: { margin: 96, logoH: 62, greeting: 112, label: 30, name: 68, note: 44, band: 150, bandText: 40, amount: 56, noteMaxLines: 6 },
};
export const STORY_SAFE_TOP = 250;
export const STORY_SAFE_BOTTOM = 280;
/** Space kept between the greeting and the person's details when both are drawn. */
const MIN_WORDS_GAP = 16;
/** The smallest illustration or photo a story keeps; below it the words are too long for the picture. */
const MIN_STORY_PICTURE = 260;
/** Rough glyph extents (Montserrat: 0.968 above the baseline, 0.251 below), for keeping blocks apart. */
const ASCENT = 0.97;
const DESCENT = 0.25;

export type ShareOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'text'; text: string; font: string; color: string; x: number; y: number; align: CanvasTextAlign; spacing?: number }
  | { kind: 'picture'; x: number; y: number; side: number }
  | { kind: 'logo'; x: number; y: number; w: number; h: number };

export interface ShareImageLayout {
  width: number;
  height: number;
  /** Painted in order. */
  ops: ShareOp[];
  /**
   * False when the chosen words cannot all be drawn without touching each other or the picture: the panel then asks
   * for a shorter message for the picture (it never cuts or shrinks the note itself).
   */
  fits: boolean;
}

/**
 * Where everything goes, and whether it fits. Pure: it measures through `ctx` and draws nothing, so the same layout
 * decides what the panel says ("too long for this size") and what is painted, and can be checked without a browser.
 */
export function layoutShareImage(content: ShareContent, size: ShareSize, ctx: ShareMeasure, logoAspect = 3.5): ShareImageLayout {
  const { w, h } = SHARE_SIZES[size];
  const L = LAYOUTS[size];
  const t = giftCardTheme(content.occasion);
  const dark = t.variant === 'dark';
  const ink = dark ? BRAND.white : BRAND.black;
  const soft = dark ? 'rgba(255,255,255,.62)' : 'rgba(0,0,0,.56)';
  const noteInk = dark ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.86)';
  const isPhoto = Boolean(content.photoUrl);
  const ops: ShareOp[] = [];
  const text = (s: string, f: string, color: string, x: number, y: number, align: CanvasTextAlign = 'left', spacing?: number) =>
    ops.push({ kind: 'text', text: s, font: f, color, x, y, align, ...(spacing ? { spacing } : {}) });
  const spaced = (px: number) => px * 0.16;
  const measureSpaced = (s: string, f: string, spacing: number) => {
    ctx.font = f;
    const had = ctx.letterSpacing;
    if (had !== undefined) ctx.letterSpacing = `${spacing}px`;
    const width = ctx.measureText(s).width;
    if (had !== undefined) ctx.letterSpacing = had;
    return width;
  };
  ops.push({ kind: 'rect', x: 0, y: 0, w, h, color: dark ? BRAND.black : BRAND.white });

  // ── The band: From and the amount when chosen; otherwise the shop's name, so the picture is always complete.
  const bandTop = size === 'story' ? h - STORY_SAFE_BOTTOM - L.band : h - L.band;
  ops.push({ kind: 'rect', x: 0, y: bandTop, w, h: h - bandTop, color: dark ? BRAND.green : BRAND.black });
  const bandInk = dark ? BRAND.black : BRAND.white;
  const bandSoft = dark ? 'rgba(0,0,0,.66)' : 'rgba(255,255,255,.66)';
  const bandMid = bandTop + L.band / 2 + L.bandText * 0.36;
  let leftEnd = L.margin;
  if (content.senderName || !content.originalUgx) {
    const label = content.senderName ? 'FROM' : 'A GOLDPLUS GIFT CARD';
    text(label, font(600, L.label), bandSoft, L.margin, bandMid, 'left', spaced(L.label));
    leftEnd = L.margin + measureSpaced(label, font(600, L.label), spaced(L.label)) + L.label * 0.9;
  }
  if (content.originalUgx) text(ugx(content.originalUgx), font(800, L.amount), dark ? BRAND.black : BRAND.green, w - L.margin, bandMid + (L.amount - L.bandText) * 0.36, 'right');
  else if (!content.senderName) text('shopgoldplus.com', font(700, L.bandText * 0.8), bandInk, w - L.margin, bandMid, 'right');
  if (content.senderName) {
    ctx.font = font(700, L.bandText);
    const room = (content.originalUgx ? w * 0.58 : w - L.margin) - leftEnd;
    text(fitOneLine(ctx, content.senderName, room), font(700, L.bandText), bandInk, leftEnd, bandMid);
  }

  // ── The words: brand area and greeting from the top; the person and the note from the bottom, grouped.
  const words = (x: number, top: number, bottom: number, width: number) => {
    ctx.font = font(500, L.note);
    const note = content.message ? wrapLines(ctx, content.message, width) : [];
    const names = content.recipientName ? nameLines(ctx, content.recipientName, width, L.name) : { lines: [] as string[], px: L.name };
    // Nothing personal chosen: the greeting itself fills the words area, larger and set down by the band.
    const alone = !note.length && !names.lines.length && size === 'square';
    const g = greetingLines(ctx, t.headline, width, alone ? L.greeting * 1.3 : L.greeting);
    const greetingLh = g.px * 1.04;
    const out: ShareOp[] = [{ kind: 'logo', x, y: top, w: logoAspect * L.logoH, h: L.logoH }];
    let gy = alone ? bottom - (g.lines.length - 1) * greetingLh : top + L.logoH + g.px * 1.25;
    for (const line of g.lines) { out.push({ kind: 'text', text: line, font: font(800, g.px), color: ink, x, y: gy, align: 'left' }); gy += greetingLh; }
    const greetingBottom = gy - greetingLh + g.px * DESCENT;
    let y = bottom;
    let groupTop = bottom;
    for (let i = note.length - 1; i >= 0; i--) { out.push({ kind: 'text', text: note[i], font: font(500, L.note), color: noteInk, x, y, align: 'left' }); groupTop = y - L.note * ASCENT; y -= L.note * 1.42; }
    if (note.length) y -= L.note * 0.5;
    for (let i = names.lines.length - 1; i >= 0; i--) { out.push({ kind: 'text', text: names.lines[i], font: font(700, names.px), color: ink, x, y, align: 'left' }); groupTop = y - names.px * ASCENT; y -= names.px * 1.16; }
    if (names.lines.length) {
      const toY = y + names.px * 0.12 - L.label * 0.2;
      out.push({ kind: 'text', text: 'TO', font: font(600, L.label), color: soft, x, y: toY, align: 'left', spacing: spaced(L.label) });
      groupTop = toY - L.label * ASCENT;
      y -= L.label * 1.4;
    }
    const overlaps = (note.length || names.lines.length) && !alone ? groupTop - greetingBottom < MIN_WORDS_GAP : false;
    return { ops: out, fits: note.length <= L.noteMaxLines && !overlaps, top, greetingPx: g.px, greetingLines: g.lines.length, noteLines: note.length, names };
  };

  if (size === 'square') {
    const colX = Math.round(w * 0.56);
    if (!dark || isPhoto) ops.push({ kind: 'rect', x: colX, y: 0, w: w - colX, h: bandTop, color: BRAND.green });
    const side = isPhoto ? w - colX - 96 : Math.round((w - colX) * 0.84);
    const px = colX + (w - colX - side) / 2;
    // Dark: the illustration stands on the band (as on the card); light: centred in its green field.
    const py = isPhoto ? (bandTop - side) / 2 : dark ? bandTop - side - 4 : (bandTop - side) / 2;
    ops.push({ kind: 'picture', x: px, y: py, side });
    const wb = words(L.margin, L.margin, bandTop - L.margin * 0.75, colX - L.margin - 24);
    ops.push(...wb.ops);
    return { width: w, height: h, ops, fits: wb.fits };
  }

  // Story: the words are measured first (from the band up), then the art takes the space above them.
  const width = w - L.margin * 2;
  const probe = words(0, 0, 0, width); // measuring only: how many lines of each, at what size
  const groupH = (probe.noteLines ? probe.noteLines * L.note * 1.42 + L.note * 0.5 : 0)
    + (probe.names.lines.length ? probe.names.lines.length * probe.names.px * 1.16 + L.label * 1.4 : 0);
  const wordsH = L.logoH + probe.greetingPx * 0.25 + probe.greetingLines * probe.greetingPx * 1.04 + (groupH ? 64 + groupH : 0);
  const wordsBottom = bandTop - 72;
  const wordsTop = wordsBottom - wordsH;
  const artBottom = wordsTop - 72;
  if (!dark || isPhoto) ops.push({ kind: 'rect', x: 0, y: 0, w, h: artBottom + 24, color: BRAND.green });
  const room = artBottom - STORY_SAFE_TOP;
  // The picture takes what the words leave (less a little air), up to its full size and never below MIN_STORY_PICTURE.
  // With long words it may rise into the top band (the apps' avatar sits over it there), but it must never reach the
  // words: when it would, the layout says the content does not fit, and the panel asks for a shorter message.
  const side = Math.max(MIN_STORY_PICTURE, Math.min(isPhoto ? 720 : 640, room - 40));
  const py = isPhoto ? STORY_SAFE_TOP + (room - side) / 2 : dark ? artBottom - side : STORY_SAFE_TOP + (room - side) / 2 + 12;
  ops.push({ kind: 'picture', x: (w - side) / 2, y: py, side });
  const wb = words(L.margin, wordsTop, wordsBottom, width);
  ops.push(...wb.ops);
  const clearOfWords = py >= 0 && py + side <= wordsTop - MIN_WORDS_GAP;
  return { width: w, height: h, ops, fits: wb.fits && clearOfWords };
}

/** Can this content be drawn at this size as it is? (If not, the panel offers an editable, shorter message.) */
export function shareContentFits(ctx: ShareMeasure, content: ShareContent, size: ShareSize): boolean {
  return layoutShareImage(content, size, ctx).fits;
}

/** Does the note fit beside the other chosen details (`rest`)? The panel asks before it draws. */
export function messageFits(ctx: ShareMeasure, message: string, size: ShareSize, rest: Omit<ShareContent, 'message'> = { occasion: 'gold' }): boolean {
  return shareContentFits(ctx, { ...rest, message }, size);
}

/** What the share panel does with the note (pictureNote). */
export interface PictureNote {
  /** The whole note does not fit beside the other chosen details: the panel asks for a shorter one for the picture. */
  askShorter: boolean;
  /** The shorter message's text: it starts as the whole note the first time it is asked for, then is the person's own. */
  shorter: string | null;
  /** The shorter message is written but still does not fit (an empty one is not "too long": it is not written yet). */
  stillTooLong: boolean;
  /** The words drawn: the whole note, the shorter one once it fits, or none (null) until then. Never a silent cut. */
  message: string | null;
}

/**
 * The note on the share picture, decided before anything is drawn. `note` is the card's note when the person chose
 * to show it (else null); `shorter` is what they have written in the shorter-message box, or null before it was ever
 * shown.
 */
export function pictureNote(ctx: ShareMeasure, note: string | null, size: ShareSize, rest: Omit<ShareContent, 'message'>, shorter: string | null): PictureNote {
  const whole = note?.trim() ?? '';
  if (!whole) return { askShorter: false, shorter, stillTooLong: false, message: null };
  if (messageFits(ctx, whole, size, rest)) return { askShorter: false, shorter, stillTooLong: false, message: whole };
  const draft = shorter ?? whole;
  const words = draft.trim();
  const fits = words.length > 0 && messageFits(ctx, words, size, rest);
  return { askShorter: true, shorter: draft, stillTooLong: words.length > 0 && !fits, message: fits ? words : null };
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/** The fonts the picture is drawn in, loaded before drawing (a canvas does not wait for them). */
export async function loadShareFonts(): Promise<boolean> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return false;
  await Promise.all([500, 600, 700, 800].map((wt) => fonts.load(`${wt} 40px Montserrat`).catch(() => undefined)));
  return fonts.check('800 40px Montserrat');
}

/** Paint a layout. The photo is the centred square of its picture (the sender's own crop), with softened corners. */
function paint(ctx: CanvasRenderingContext2D, layout: ShareImageLayout, logo: HTMLImageElement, picture: HTMLImageElement, isPhoto: boolean): void {
  for (const op of layout.ops) {
    if (op.kind === 'rect') { ctx.fillStyle = op.color; ctx.fillRect(op.x, op.y, op.w, op.h); continue; }
    if (op.kind === 'logo') { ctx.drawImage(logo, op.x, op.y, op.w, op.h); continue; }
    if (op.kind === 'text') {
      ctx.font = op.font; ctx.fillStyle = op.color; ctx.textAlign = op.align; ctx.textBaseline = 'alphabetic';
      if (op.spacing) ctx.letterSpacing = `${op.spacing}px`;
      ctx.fillText(op.text, op.x, op.y);
      if (op.spacing) ctx.letterSpacing = '0px';
      continue;
    }
    if (!isPhoto) { ctx.drawImage(picture, op.x, op.y, op.side, op.side); continue; }
    const s = Math.min(picture.naturalWidth, picture.naturalHeight);
    ctx.save();
    ctx.beginPath();
    // roundRect is recent (Chrome 99, Safari 16); an older phone gets square corners rather than no picture.
    if (typeof ctx.roundRect === 'function') ctx.roundRect(op.x, op.y, op.side, op.side, op.side * 0.035);
    else ctx.rect(op.x, op.y, op.side, op.side);
    ctx.clip();
    ctx.drawImage(picture, (picture.naturalWidth - s) / 2, (picture.naturalHeight - s) / 2, s, s, op.x, op.y, op.side, op.side);
    ctx.restore();
  }
}

/**
 * Draw the share image. Resolves when drawn; rejects if the art, logo or photo cannot load, or if the content does not
 * fit (the panel asks for a shorter message first, so that only happens if it was skipped). It never falls back to
 * sharing a link.
 */
export async function drawShareImage(canvas: HTMLCanvasElement, content: ShareContent, size: ShareSize): Promise<void> {
  const { w, h } = SHARE_SIZES[size];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('NO_CANVAS');
  const t = giftCardTheme(content.occasion);
  await loadShareFonts();
  const [logo, picture] = await Promise.all([loadImage(logoUrl(t.logo)), loadImage(content.photoUrl ?? t.art)]);
  const layout = layoutShareImage(content, size, ctx, logo.naturalWidth / logo.naturalHeight);
  if (!layout.fits) throw new Error('MESSAGE_TOO_LONG');
  paint(ctx, layout, logo, picture, Boolean(content.photoUrl));
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('NO_BLOB'))), 'image/png'));
}

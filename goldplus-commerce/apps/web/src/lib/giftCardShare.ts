import { BRAND, giftCardTheme, logoUrl } from './giftCardThemes';
import { giftCardPhotoUrl } from './giftCardPhoto';

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
  if (choose.recipientName && source.recipientName) out.recipientName = source.recipientName.trim().slice(0, 60);
  if (choose.senderName && source.senderName) out.senderName = source.senderName.trim().slice(0, 60);
  const message = (messageOverride ?? source.message ?? '').trim();
  if (choose.message && message) out.message = message.slice(0, 200);
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

/** The public page for buying a gift card (never the recipient's own link). */
export const PUBLIC_BUY_URL = 'https://shopgoldplus.com/gift-card/buy';

export function shareFileName(occasion: string, size: ShareSize): string {
  return `goldplus-gift-${giftCardTheme(occasion).key.replace(/_/g, '-')}-${size}.png`;
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-US')}`;
const FONT = 'Montserrat, "Plus Jakarta Sans", Arial, sans-serif';
const font = (weight: number, px: number) => `${weight} ${Math.round(px)}px ${FONT}`;

/** Words into lines that fit `maxWidth` (an over-long word is broken, never shrunk). */
export function wrapLines(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(tryLine).width <= maxWidth) { line = tryLine; continue; }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
    // A single very long word: split it by characters.
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
      const plain = l.replace(/\u00ad/g, '');
      if (ctx.measureText(plain).width <= maxWidth || !l.includes('\u00ad')) return wrapLines(ctx, plain, maxWidth);
      const [a, b] = l.split('\u00ad');
      return [`${a}-`, b];
    });
    if (lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { lines, px: size };
  }
  ctx.font = font(weight, px * 0.62);
  return { lines: wrapLines(ctx, headline.replace(/\u00ad/g, '').replace(/\n/g, ' '), maxWidth), px: px * 0.62 };
}

/**
 * Two compositions on the card's own system (brand area, greeting, the person and the note, the illustration in its
 * own area, the information band):
 *  - square: the words on the left, the illustration (or photo) in its column on the right, the band across the foot;
 *  - story: the illustration (or photo) above, the words below, the band at the foot; the top 250 px and bottom 280 px
 *    hold no words (the apps draw their own controls there).
 */
interface Layout { margin: number; logoH: number; greeting: number; label: number; name: number; note: number; band: number; bandText: number; amount: number; noteMaxLines: number; noteWidth: number }
const LAYOUTS: Record<ShareSize, Layout> = {
  square: { margin: 80, logoH: 50, greeting: 80, label: 24, name: 52, note: 33, band: 156, bandText: 34, amount: 44, noteMaxLines: 7, noteWidth: 1080 * 0.56 - 80 - 24 },
  story: { margin: 96, logoH: 62, greeting: 112, label: 30, name: 68, note: 44, band: 150, bandText: 40, amount: 56, noteMaxLines: 6, noteWidth: 1080 - 96 * 2 },
};
const STORY_SAFE_TOP = 250;
const STORY_SAFE_BOTTOM = 280;

/** Does the note fit this size without shrinking? (If not, the panel offers an editable excerpt.) */
export function messageFits(ctx: CanvasRenderingContext2D, message: string, size: ShareSize): boolean {
  const L = LAYOUTS[size];
  ctx.font = font(500, L.note);
  return wrapLines(ctx, message, L.noteWidth).length <= L.noteMaxLines;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/** The fonts the picture is drawn in, loaded before drawing (a canvas does not wait for them). */
export async function loadShareFonts(): Promise<boolean> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return false;
  await Promise.all([500, 600, 700, 800].map((wt) => fonts.load(`${wt} 40px Montserrat`).catch(() => undefined)));
  return fonts.check('800 40px Montserrat');
}

/**
 * Draw the share image. Resolves when drawn; rejects if the art, logo or photo cannot load (the panel offers a retry
 * and never falls back to sharing a link).
 */
export async function drawShareImage(canvas: HTMLCanvasElement, content: ShareContent, size: ShareSize): Promise<void> {
  const { w, h } = SHARE_SIZES[size];
  const L = LAYOUTS[size];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('NO_CANVAS');
  const t = giftCardTheme(content.occasion);
  const dark = t.variant === 'dark';
  const ink = dark ? BRAND.white : BRAND.black;
  const soft = dark ? 'rgba(255,255,255,.62)' : 'rgba(0,0,0,.56)';
  await loadShareFonts();
  const [logo, picture] = await Promise.all([loadImage(logoUrl(t.logo)), loadImage(content.photoUrl ?? t.art)]);
  const isPhoto = Boolean(content.photoUrl);

  const text = (s: string, f: string, color: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
    ctx.font = f; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  ctx.fillStyle = dark ? BRAND.black : BRAND.white;
  ctx.fillRect(0, 0, w, h);

  // ── The band: From and the amount when chosen; otherwise the shop's name, so the picture is always complete.
  const bandTop = size === 'story' ? h - STORY_SAFE_BOTTOM - L.band : h - L.band;
  ctx.fillStyle = dark ? BRAND.green : BRAND.black;
  ctx.fillRect(0, bandTop, w, h - bandTop);
  const bandInk = dark ? BRAND.black : BRAND.white;
  const bandSoft = dark ? 'rgba(0,0,0,.66)' : 'rgba(255,255,255,.66)';
  const bandMid = bandTop + L.band / 2 + L.bandText * 0.36;
  let leftEnd = L.margin;
  if (content.senderName || !content.originalUgx) {
    const label = content.senderName ? 'FROM' : 'A GOLDPLUS GIFT CARD';
    ctx.font = font(600, L.label); ctx.letterSpacing = `${L.label * 0.16}px`;
    text(label, font(600, L.label), bandSoft, L.margin, bandMid);
    leftEnd = L.margin + ctx.measureText(label).width + L.label * 0.9;
    ctx.letterSpacing = '0px';
  }
  if (content.originalUgx) text(ugx(content.originalUgx), font(800, L.amount), dark ? BRAND.black : BRAND.green, w - L.margin, bandMid + (L.amount - L.bandText) * 0.36, 'right');
  else if (!content.senderName) text('shopgoldplus.com', font(700, L.bandText * 0.8), bandInk, w - L.margin, bandMid, 'right');
  if (content.senderName) {
    ctx.font = font(700, L.bandText);
    const room = (content.originalUgx ? w * 0.58 : w - L.margin) - leftEnd;
    let name = content.senderName;
    while (name.length > 1 && ctx.measureText(name).width > room) name = name.slice(0, -1);
    text(name === content.senderName ? name : `${name.trimEnd()}…`, font(700, L.bandText), bandInk, leftEnd, bandMid);
  }

  // ── The art area: the illustration (or the photo, never under any words).
  const drawPicture = (x: number, y: number, side: number) => {
    if (isPhoto) {
      // The square the sender chose, set in the green field with softened corners.
      const s = Math.min(picture.naturalWidth, picture.naturalHeight);
      ctx.save();
      ctx.beginPath();
      // roundRect is recent (Chrome 99, Safari 16); an older phone gets square corners rather than no picture.
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, side, side, side * 0.035);
      else ctx.rect(x, y, side, side);
      ctx.clip();
      ctx.drawImage(picture, (picture.naturalWidth - s) / 2, (picture.naturalHeight - s) / 2, s, s, x, y, side, side);
      ctx.restore();
    } else ctx.drawImage(picture, x, y, side, side);
  };

  // ── The words.
  const drawWords = (x: number, top: number, bottom: number, width: number, greetingPx: number) => {
    const lh = (px: number, k: number) => px * k;
    // Brand area and greeting from the top; the person and the note from the bottom, grouped.
    const logoW = (logo.naturalWidth / logo.naturalHeight) * L.logoH;
    ctx.drawImage(logo, x, top, logoW, L.logoH);
    ctx.font = font(500, L.note);
    const note = content.message ? wrapLines(ctx, content.message, width) : [];
    if (note.length > L.noteMaxLines) throw new Error('MESSAGE_TOO_LONG'); // the panel asks for an excerpt first
    ctx.font = font(700, L.name);
    const names = content.recipientName ? wrapLines(ctx, content.recipientName, width).slice(0, 2) : [];
    // Nothing personal chosen: the greeting itself fills the words area, larger and set down by the band.
    const alone = !note.length && !names.length && size === 'square';
    const g = greetingLines(ctx, t.headline, width, alone ? greetingPx * 1.3 : greetingPx);
    let gy = alone ? bottom - (g.lines.length - 1) * lh(g.px, 1.04) : top + L.logoH + g.px * 1.25;
    for (const line of g.lines) { text(line, font(800, g.px), ink, x, gy); gy += lh(g.px, 1.04); }
    const greetingBottom = gy - lh(g.px, 1.04) + g.px * 0.25;
    let y = bottom;
    const noteLh = lh(L.note, 1.42);
    for (let i = note.length - 1; i >= 0; i--) { text(note[i], font(500, L.note), dark ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.86)', x, y); y -= noteLh; }
    if (note.length) y -= L.note * 0.5;
    for (let i = names.length - 1; i >= 0; i--) { text(names[i], font(700, L.name), ink, x, y); y -= lh(L.name, 1.16); }
    if (names.length) {
      ctx.letterSpacing = `${L.label * 0.16}px`;
      text('TO', font(600, L.label), soft, x, y + L.name * 0.12 - L.label * 0.2);
      ctx.letterSpacing = '0px';
      y -= L.label * 1.4;
    }
    return { greetingBottom, groupTop: y };
  };

  if (size === 'square') {
    const colX = Math.round(w * 0.56);
    if (!dark || isPhoto) { ctx.fillStyle = BRAND.green; ctx.fillRect(colX, 0, w - colX, bandTop); }
    const side = isPhoto ? w - colX - 96 : Math.round((w - colX) * 0.84);
    const px = colX + (w - colX - side) / 2;
    // Dark: the illustration stands on the band (as on the card); light: centred in its green field.
    const py = isPhoto ? (bandTop - side) / 2 : dark ? bandTop - side - 4 : (bandTop - side) / 2;
    drawPicture(px, py, side);
    drawWords(L.margin, L.margin, bandTop - L.margin * 0.75, colX - L.margin - 24, L.greeting);
    return;
  }

  // Story: words first (measured from the band up), then the art takes the space above them.
  const width = w - L.margin * 2;
  ctx.font = font(500, L.note);
  const noteLines = content.message ? wrapLines(ctx, content.message, width).length : 0;
  ctx.font = font(700, L.name);
  const nameLines = content.recipientName ? Math.min(2, wrapLines(ctx, content.recipientName, width).length) : 0;
  const g = greetingLines(ctx, t.headline, width, L.greeting);
  const groupH = (noteLines ? noteLines * L.note * 1.42 + L.note * 0.5 : 0) + (nameLines ? nameLines * L.name * 1.16 + L.label * 1.4 : 0);
  const wordsH = L.logoH + g.px * 0.25 + g.lines.length * g.px * 1.04 + (groupH ? 64 + groupH : 0);
  const wordsBottom = bandTop - 72;
  const wordsTop = wordsBottom - wordsH;
  const artBottom = wordsTop - 72;
  if (!dark || isPhoto) { ctx.fillStyle = BRAND.green; ctx.fillRect(0, 0, w, artBottom + 24); }
  const room = artBottom - STORY_SAFE_TOP;
  const side = Math.max(260, Math.min(isPhoto ? 720 : 640, room - 40));
  const py = isPhoto ? STORY_SAFE_TOP + (room - side) / 2 : dark ? artBottom - side : STORY_SAFE_TOP + (room - side) / 2 + 12;
  drawPicture((w - side) / 2, py, side);
  drawWords(L.margin, wordsTop, wordsBottom, width, L.greeting);
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('NO_BLOB'))), 'image/png'));
}

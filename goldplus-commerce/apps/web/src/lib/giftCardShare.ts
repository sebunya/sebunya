import { giftCardTheme, type GiftCardTheme } from './giftCardThemes';

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
}

export type ShareSize = 'square' | 'story';
export const SHARE_SIZES: Record<ShareSize, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: 'Square' },
  story: { w: 1080, h: 1920, label: 'Story / Status' },
};

/** The fields the share panel may pass on, and nothing else (also what the tests check). */
export const PERMITTED_SHARE_FIELDS = ['occasion', 'recipientName', 'senderName', 'message', 'originalUgx'] as const;

/** Build the content from the recipient's choices: only switched-on fields, only from the permitted list. */
export function shareContent(source: { occasion: string; recipientName?: string | null; senderName?: string | null; message?: string | null; originalUgx?: number | null },
  choose: { recipientName: boolean; senderName: boolean; message: boolean; amount: boolean }, messageOverride?: string | null): ShareContent {
  const out: ShareContent = { occasion: giftCardTheme(source.occasion).key };
  if (choose.recipientName && source.recipientName) out.recipientName = source.recipientName.trim().slice(0, 60);
  if (choose.senderName && source.senderName) out.senderName = source.senderName.trim().slice(0, 60);
  const message = (messageOverride ?? source.message ?? '').trim();
  if (choose.message && message) out.message = message.slice(0, 200);
  if (choose.amount && Number.isFinite(source.originalUgx) && (source.originalUgx ?? 0) > 0) out.originalUgx = Math.round(source.originalUgx!);
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

// ── Reading a theme's art: its gradient colours and its motif (the same strings the card is drawn with) ─────────
export function themeArt(t: GiftCardTheme): { from: string; to: string; motif: string | null; glow: boolean } {
  const g = /linear-gradient\(135deg,\s*(#[0-9A-Fa-f]{6})\s+0%,\s*(#[0-9A-Fa-f]{6})\s+100%\)/.exec(t.background);
  const m = /url\("(data:image\/svg\+xml,[^"]+)"\)/.exec(t.background);
  return { from: g?.[1] ?? '#0A0A0A', to: g?.[2] ?? '#1C1C1C', motif: m ? m[1] : null, glow: t.background.includes('radial-gradient') };
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-US')}`;

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

interface Layout {
  margin: number; top: number; bottom: number; logoH: number; headline: number; label: number; name: number;
  message: number; messageMaxLines: number; from: number; amount: number; footer: number; gap: number;
}
const LAYOUTS: Record<ShareSize, Layout> = {
  // Square: comfortable 96 px margins; the stack is centred between the logo and the footer.
  square: { margin: 96, top: 96, bottom: 96, logoH: 64, headline: 92, label: 30, name: 84, message: 50, messageMaxLines: 5, from: 54, amount: 44, footer: 30, gap: 40 },
  // Story / Status: the top and bottom ~14% stay clear (the apps put their own controls there).
  story: { margin: 110, top: 290, bottom: 300, logoH: 78, headline: 118, label: 36, name: 104, message: 60, messageMaxLines: 7, from: 64, amount: 52, footer: 34, gap: 56 },
};

/** Does the message fit this size without shrinking? (If not, the panel offers an editable excerpt.) */
export function messageFits(ctx: CanvasRenderingContext2D, message: string, size: ShareSize): boolean {
  const L = LAYOUTS[size];
  ctx.font = `italic 600 ${L.message}px "Plus Jakarta Sans", sans-serif`;
  return wrapLines(ctx, `“${message}”`, SHARE_SIZES[size].w - L.margin * 2).length <= L.messageMaxLines;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/**
 * Draw the share image. Resolves when drawn; rejects if the art or logo cannot load (the panel offers a retry and
 * never falls back to sharing a link).
 */
export async function drawShareImage(canvas: HTMLCanvasElement, content: ShareContent, size: ShareSize, logoUrl: string): Promise<void> {
  const { w, h } = SHARE_SIZES[size];
  const L = LAYOUTS[size];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('NO_CANVAS');
  const t = giftCardTheme(content.occasion);
  const art = themeArt(t);
  const light = t.ink === 'light';
  const ink = light ? '#FFFFFF' : '#1C1C1C';
  const soft = light ? 'rgba(255,255,255,.78)' : 'rgba(28,28,28,.72)';
  await document.fonts?.load?.(`800 40px "Plus Jakarta Sans"`).catch(() => undefined);
  await document.fonts?.load?.(`italic 600 40px "Plus Jakarta Sans"`).catch(() => undefined);

  // Background: the card's own gradient and motif, laid out for this canvas (not a stretched card).
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, art.from);
  g.addColorStop(1, art.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (art.glow) {
    const r = ctx.createRadialGradient(w, 0, 0, w, 0, w * 0.9);
    r.addColorStop(0, 'rgba(147,213,0,.38)');
    r.addColorStop(1, 'rgba(147,213,0,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
  }
  if (art.motif) {
    const motif = await loadImage(art.motif);
    const tile = size === 'square' ? 420 : 480;
    for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) ctx.drawImage(motif, x, y, tile, tile);
  }

  // The logo, in the card's ink.
  const logo = await loadImage(logoUrl);
  const logoW = (logo.naturalWidth / logo.naturalHeight) * L.logoH;
  const off = document.createElement('canvas');
  off.width = Math.ceil(logoW);
  off.height = L.logoH;
  const octx = off.getContext('2d')!;
  octx.drawImage(logo, 0, 0, logoW, L.logoH);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = ink;
  octx.fillRect(0, 0, off.width, off.height);
  ctx.drawImage(off, L.margin, L.top);

  // The stack: headline, then whatever was chosen; empty parts take no space.
  const maxW = w - L.margin * 2;
  type Block = { h: number; draw: (y: number) => void };
  const blocks: Block[] = [];
  const text = (s: string, font: string, color: string, y: number, align: CanvasTextAlign = 'left') => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'top';
    ctx.fillText(s, align === 'center' ? w / 2 : L.margin, y);
  };
  ctx.font = `800 ${L.headline}px "Plus Jakarta Sans", sans-serif`;
  const headLines = wrapLines(ctx, t.headline, maxW);
  blocks.push({ h: headLines.length * L.headline * 1.08, draw: (y) => headLines.forEach((l, i) => text(l, `800 ${L.headline}px "Plus Jakarta Sans", sans-serif`, ink, y + i * L.headline * 1.08)) });
  if (content.recipientName) {
    ctx.font = `800 ${L.name}px "Plus Jakarta Sans", sans-serif`;
    const lines = wrapLines(ctx, content.recipientName, maxW).slice(0, 2);
    blocks.push({ h: L.label * 1.5 + lines.length * L.name * 1.08, draw: (y) => {
      text('FOR', `800 ${L.label}px "Plus Jakarta Sans", sans-serif`, soft, y);
      lines.forEach((l, i) => text(l, `800 ${L.name}px "Plus Jakarta Sans", sans-serif`, ink, y + L.label * 1.5 + i * L.name * 1.08));
    } });
  }
  if (content.message) {
    ctx.font = `italic 600 ${L.message}px "Plus Jakarta Sans", sans-serif`;
    const lines = wrapLines(ctx, `“${content.message}”`, maxW);
    if (lines.length > L.messageMaxLines) throw new Error('MESSAGE_TOO_LONG'); // the panel asks for an excerpt first
    blocks.push({ h: lines.length * L.message * 1.32, draw: (y) => lines.forEach((l, i) => text(l, `italic 600 ${L.message}px "Plus Jakarta Sans", sans-serif`, ink, y + i * L.message * 1.32)) });
  }
  if (content.senderName) {
    ctx.font = `800 ${L.from}px "Plus Jakarta Sans", sans-serif`;
    const line = wrapLines(ctx, content.senderName, maxW)[0] ?? '';
    blocks.push({ h: L.label * 1.5 + L.from * 1.1, draw: (y) => {
      text('FROM', `800 ${L.label}px "Plus Jakarta Sans", sans-serif`, soft, y);
      text(line, `800 ${L.from}px "Plus Jakarta Sans", sans-serif`, ink, y + L.label * 1.5);
    } });
  }
  if (content.originalUgx) {
    const label = ugx(content.originalUgx);
    blocks.push({ h: L.amount * 1.9, draw: (y) => {
      ctx.font = `800 ${L.amount}px "Plus Jakarta Sans", sans-serif`;
      const pw = ctx.measureText(label).width + L.amount * 1.2;
      const ph = L.amount * 1.7;
      ctx.fillStyle = t.accent;
      ctx.beginPath();
      ctx.roundRect(L.margin, y, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = t.accentInk; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(label, L.margin + L.amount * 0.6, y + ph / 2 + 2);
    } });
  }
  const areaTop = L.top + L.logoH + L.gap;
  const areaBottom = h - L.bottom - L.footer * 2;
  const total = blocks.reduce((s, b) => s + b.h, 0) + L.gap * (blocks.length - 1);
  let y = areaTop + Math.max(0, (areaBottom - areaTop - total) / 2);
  for (const b of blocks) { b.draw(y); y += b.h + L.gap; }

  // A discreet footer.
  text('shopgoldplus.com', `700 ${L.footer}px "Plus Jakarta Sans", sans-serif`, soft, h - L.bottom - L.footer, 'left');
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('NO_BLOB'))), 'image/png'));
}

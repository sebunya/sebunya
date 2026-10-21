import { describe, expect, it } from 'vitest';
import {
  SHARE_SIZES, STORY_SAFE_BOTTOM, STORY_SAFE_TOP, layoutShareImage, shareContent, type ShareContent, type ShareOp, type ShareSize,
} from '../../apps/web/src/lib/giftCardShare';
import { GIFT_CARD_THEMES } from '../../apps/web/src/lib/giftCardThemes';

// The share picture's layout, checked without a browser: a stand-in measures text as a fixed share of the font size
// per character (wider for bold), which is close to Montserrat and identical run to run.
function measurer() {
  return {
    font: '10px sans-serif',
    letterSpacing: '0px',
    measureText(text: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
      const weight = Number(/^(\d{3})/.exec(this.font)?.[1] ?? 500);
      const spacing = Number.parseFloat(this.letterSpacing) || 0;
      const chars = Array.from(text).length;
      return { width: chars * px * (weight >= 700 ? 0.64 : 0.56) + chars * spacing } as TextMetrics;
    },
  };
}
const PX = (f: string) => Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 0);
type Box = { x0: number; y0: number; x1: number; y1: number };
function textBox(op: Extract<ShareOp, { kind: 'text' }>): Box {
  const m = measurer();
  m.font = op.font;
  if (op.spacing) m.letterSpacing = `${op.spacing}px`;
  const width = m.measureText(op.text).width;
  const x0 = op.align === 'right' ? op.x - width : op.x;
  return { x0, x1: x0 + width, y0: op.y - PX(op.font) * 0.97, y1: op.y + PX(op.font) * 0.25 };
}
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const texts = (ops: ShareOp[]) => ops.filter((o): o is Extract<ShareOp, { kind: 'text' }> => o.kind === 'text');
const picture = (ops: ShareOp[]) => ops.find((o): o is Extract<ShareOp, { kind: 'picture' }> => o.kind === 'picture')!;

const FULL: Omit<ShareContent, 'occasion'> = {
  recipientName: 'Sarah Nakato', senderName: 'Daniel Okello', originalUgx: 100_000,
  message: 'Happy birthday! I hope this year brings you everything you have been wishing for.',
};
const VARIANTS: Array<[string, Omit<ShareContent, 'occasion'>]> = [
  ['nothing chosen', {}],
  ['everything', FULL],
  ['everything with the photo', { ...FULL, photoUrl: '/gift-card/photo/0f8fad5b-d9cb-469f-a165-70867728950e' }],
  ['a long name', { ...FULL, recipientName: 'Sarah Nakato Namubiru Kizza Nalubega Mukasa' }],
  ['a full 160-character note', { ...FULL, message: 'x'.repeat(10).split('').map((_, i) => `Wishing you joy ${i}`).join(' ').slice(0, 160) }],
];

describe('the share picture’s layout (every occasion, both sizes)', () => {
  for (const size of ['square', 'story'] as ShareSize[]) {
    it(`${size}: nothing overlaps, nothing leaves the picture, and story words keep clear of the apps’ controls`, () => {
      const { w, h } = SHARE_SIZES[size];
      for (const t of GIFT_CARD_THEMES) {
        for (const [label, rest] of VARIANTS) {
          const layout = layoutShareImage({ occasion: t.key, ...rest }, size, measurer());
          if (!layout.fits) continue; // the panel asks for a shorter message instead of drawing this
          const pic = picture(layout.ops);
          const picBox: Box = { x0: pic.x, y0: pic.y, x1: pic.x + pic.side, y1: pic.y + pic.side };
          const boxes = texts(layout.ops).map(textBox);
          boxes.forEach((b, i) => {
            const where = `${t.key} ${size} ${label}: "${texts(layout.ops)[i].text}"`;
            expect(b.x0, where).toBeGreaterThanOrEqual(0);
            expect(b.x1, where).toBeLessThanOrEqual(w);
            expect(b.y0, where).toBeGreaterThanOrEqual(0);
            expect(b.y1, where).toBeLessThanOrEqual(h);
            expect(overlap(b, picBox), `${where} touches the picture`).toBe(false);
            if (size === 'story') {
              expect(b.y0, `${where} is under the apps' top controls`).toBeGreaterThanOrEqual(STORY_SAFE_TOP);
              expect(b.y1, `${where} is under the apps' bottom controls`).toBeLessThanOrEqual(h - STORY_SAFE_BOTTOM);
            }
            // Lines of one block (the same font at the same x: a headline, a note) are set close on purpose; blocks
            // must keep apart.
            const all = texts(layout.ops);
            boxes.slice(i + 1).forEach((o, j) => {
              const other = all[i + 1 + j];
              if (other.font === all[i].font && other.x === all[i].x && other.align === all[i].align) return;
              expect(overlap(b, o), `${where} overlaps "${other.text}"`).toBe(false);
            });
          });
        }
      }
    });
  }

  it('the ordinary contents fit at both sizes for every occasion (the panel only asks for a shorter note when it must)', () => {
    for (const size of ['square', 'story'] as ShareSize[]) {
      for (const t of GIFT_CARD_THEMES) {
        for (const [label, rest] of VARIANTS.slice(0, 4)) expect(layoutShareImage({ occasion: t.key, ...rest }, size, measurer()).fits, `${t.key} ${size} ${label}`).toBe(true);
      }
    }
  });

  it('content that cannot be drawn cleanly is reported as not fitting rather than drawn on top of itself', () => {
    const crowded: ShareContent = {
      occasion: 'valentine', ...FULL,
      recipientName: 'Sarah Nakato Namubiru Kizza Nalubega Mukasa Nantongo',
      message: 'Supercalifragilistic expialidocious '.repeat(5).trim(),
    };
    // The square's columns are fixed: the greeting and the details would meet, so it does not fit.
    expect(layoutShareImage(crowded, 'square', measurer()).fits).toBe(false);
    // The story can give the words more height (the picture rises): it fits only if nothing touches.
    const story = layoutShareImage(crowded, 'story', measurer());
    if (story.fits) {
      const pic = picture(story.ops);
      const picBox: Box = { x0: pic.x, y0: pic.y, x1: pic.x + pic.side, y1: pic.y + pic.side };
      for (const op of texts(story.ops)) {
        expect(overlap(textBox(op), picBox), op.text).toBe(false);
        expect(textBox(op).y0, op.text).toBeGreaterThanOrEqual(STORY_SAFE_TOP);
      }
    }
    // Ever more words: the story too runs out of room, and says so rather than drawing into the apps' controls.
    const overflowing = { ...crowded, recipientName: Array.from({ length: 24 }, (_, i) => `Namesake${i}`).join(' ') };
    expect(layoutShareImage(overflowing, 'story', measurer()).fits).toBe(false);
  });

  it('a long name is set smaller and kept whole, never cut', () => {
    const name = 'Sarah Nakato Namubiru Kizza Nalubega Mukasa';
    const layout = layoutShareImage({ occasion: 'gold', ...FULL, recipientName: name }, 'square', measurer());
    const drawn = texts(layout.ops).map((o) => o.text).join(' ');
    for (const word of name.split(' ')) expect(drawn).toContain(word);
  });

  it('the From line is cut with an ellipsis at a whole character (an emoji is never split)', () => {
    const layout = layoutShareImage({ occasion: 'gold', senderName: `${'Daniel Okello '.repeat(4)}😊😊😊😊`, originalUgx: 50_000 }, 'square', measurer());
    const from = texts(layout.ops).find((o) => o.text.endsWith('…'))!;
    expect(from).toBeDefined();
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(from.text)).toBe(false);
  });

  it('with every detail hidden the band names the shop; with them shown it carries From and the amount', () => {
    const hidden = texts(layoutShareImage({ occasion: 'birthday' }, 'square', measurer()).ops).map((o) => o.text);
    expect(hidden).toEqual(expect.arrayContaining(['A GOLDPLUS GIFT CARD', 'shopgoldplus.com']));
    expect(hidden).not.toContain('TO');
    const shown = texts(layoutShareImage({ occasion: 'birthday', ...FULL }, 'square', measurer()).ops).map((o) => o.text);
    expect(shown).toEqual(expect.arrayContaining(['FROM', 'Daniel Okello', 'UGX 100,000', 'TO', 'Sarah Nakato']));
  });

  it('only permitted fields reach the picture, whatever the source holds', () => {
    const leaky = {
      occasion: 'love', ...FULL, code: 'GPGC-AAAA-BBBB-CCCC', balanceUgx: 12_000, link: 'https://shopgoldplus.com/gift-card/open#GPGC-AAAA-BBBB-CCCC', phone: '+256772111222',
    } as never;
    const content = shareContent(leaky, { recipientName: true, senderName: true, message: true, amount: true, photo: true });
    for (const size of ['square', 'story'] as ShareSize[]) {
      const drawn = texts(layoutShareImage(content, size, measurer()).ops).map((o) => o.text).join(' | ');
      expect(drawn).not.toMatch(/GPGC|12,000|12000|#|\+256|772111222/);
    }
  });
});

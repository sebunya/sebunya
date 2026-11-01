/**
 * The words on a gift card face, worked out once for both places that draw it: the server (GiftCardFace.astro) and
 * the buy page's live preview (its redraw). Two copies of this logic had already drifted apart (the preview's spoken
 * label lost the photo; the server's lost the placeholders the card shows).
 */

/** What the card shows before the buyer has typed a name. */
export const CARD_PLACEHOLDER = Object.freeze({ to: 'Someone special', from: 'You' });

/** A headline's lines (`\n` marks a preferred break) and whether one of them is long enough for the smaller size. */
export function greetingParts(headline: string): { lines: string[]; long: boolean } {
  const lines = headline.split('\n');
  return { lines, long: lines.some((l) => l.replace(/­/g, '').length > 12) };
}

/** The headline as one line of plain words (no preferred breaks, no soft hyphens). */
export const plainHeadline = (headline: string) => headline.replace(/\n/g, ' ').replace(/­/g, '');

/** A note as the shop keeps it: line breaks and runs of spaces become one space (the card is one paragraph). */
export const asCardNote = (raw: string | null | undefined) => String(raw ?? '').replace(/\s+/g, ' ').trim();

/**
 * The card's name for a screen reader (the card is one image to them): everything it shows, in reading order, the
 * note last so the rest is not lost behind a long one.
 */
export function giftCardLabel(card: { headline: string; to?: string | null; from?: string | null; amount?: string | null; photo?: boolean; note?: string | null }): string {
  const note = asCardNote(card.note);
  return [
    `GoldPlus gift card: ${plainHeadline(card.headline)}`,
    `to ${card.to || CARD_PLACEHOLDER.to}`,
    `from ${card.from || CARD_PLACEHOLDER.from}`,
    card.amount,
    card.photo && 'with a photo',
    note && `note: ${note}`,
  ].filter(Boolean).join(', ');
}

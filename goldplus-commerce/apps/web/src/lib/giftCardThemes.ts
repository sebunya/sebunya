/**
 * The GoldPlus gift card collection (redesign, 2026-10-21), built from the rebrand book: one green (#96CC06), black
 * and white; the logo black on light, white or green on black; never white text on green; Montserrat.
 *
 * Every card has the same structure: a brand area with the logo, a greeting, the recipient's name and note grouped
 * together, an illustration in its own area, and an information band (From and the amount) that reads as the gift's
 * ribbon. Black-led cards draw their art on black and carry a green band (black text); white-led cards set their art
 * on a broad green field and carry a black band (white text, the amount in green). The API keeps only the key.
 */
export type GiftCardThemeKey =
  | 'gold' | 'birthday' | 'thanks' | 'celebrate' | 'love' | 'anniversary'
  | 'valentine' | 'mothers_day' | 'fathers_day' | 'easter' | 'eid' | 'christmas' | 'new_year' | 'festive';

export const BRAND = { green: '#96CC06', black: '#000000', white: '#FFFFFF' } as const;

export interface GiftCardTheme {
  key: GiftCardThemeKey;
  /** In the occasion picker. */
  label: string;
  /** The greeting on the card; `\n` marks a preferred line break. */
  headline: string;
  /** dark: black field, green band. light: white field with a green art panel, black band. */
  variant: 'dark' | 'light';
  /** Which logo treatment sits on this card (brand book: black on light; white or green on black). */
  logo: 'black' | 'white' | 'green';
  /** The occasion's illustration (an SVG drawn for this card's art area). */
  art: string;
  /** Tap-to-use messages, written to fit the 160-character note. Emoji are the customer's to keep or remove. */
  suggestions: readonly string[];
}

const art = (key: GiftCardThemeKey) => `/gift-cards/art/${key}.svg`;

export const GIFT_CARD_THEMES: readonly GiftCardTheme[] = [
  { key: 'gold', label: 'A gift for you', headline: 'A gift\nfor you', variant: 'dark', logo: 'white', art: art('gold'), suggestions: [
    'A little something to say you are thought of. Get yourself something you will really enjoy.',
    'No reason needed. You deserve something nice, so this one is on me.',
    'I saw this and thought of you. Pick whatever makes you happiest. 🎁',
  ] },
  { key: 'birthday', label: 'Birthday', headline: 'Happy\nbirthday', variant: 'light', logo: 'black', art: art('birthday'), suggestions: [
    'Happy birthday! I hope this year brings you everything you have been wishing for. Treat yourself to something you love. 🎂',
    'Another year older and still my favourite person to celebrate. Have a wonderful day!',
    'Wishing you a birthday full of laughter and a year full of good things. Enjoy your gift!',
  ] },
  { key: 'thanks', label: 'Thank you', headline: 'Thank you', variant: 'light', logo: 'black', art: art('thanks'), suggestions: [
    'Thank you for everything you do. It means more than you know, so please enjoy this small thank-you.',
    'You went out of your way for me and I will not forget it. Thank you so much.',
    'A small thank-you for a big kindness. I really appreciate you. 🙏',
  ] },
  { key: 'celebrate', label: 'Congratulations', headline: 'Congratu­lations', variant: 'dark', logo: 'white', art: art('celebrate'), suggestions: [
    'Congratulations! All your hard work has paid off. So proud of you, enjoy this moment. 🎉',
    'You did it! Well done on this achievement. Treat yourself, you have earned it.',
    'Big news deserves a celebration. Congratulations, and here is to everything that comes next.',
  ] },
  { key: 'love', label: 'With love', headline: 'With love', variant: 'dark', logo: 'green', art: art('love'), suggestions: [
    'For the person who makes every day better. Sending you all my love. ❤️',
    'Just because I love you, and I never say it enough. Enjoy something lovely.',
    'Thinking of you today and always. You mean the world to me.',
  ] },
  { key: 'anniversary', label: 'Anniversary', headline: 'Happy\nanniversary', variant: 'light', logo: 'black', art: art('anniversary'), suggestions: [
    'Happy anniversary! Every year with you is my favourite one yet. Here is to many more. ❤️',
    'Celebrating us today, and all the years still to come. Thank you for walking this road with me.',
    'Happy anniversary to a wonderful team. Here is to the next chapter together.',
  ] },
  { key: 'valentine', label: "Valentine's Day", headline: 'Happy\nValentine’s Day', variant: 'dark', logo: 'white', art: art('valentine'), suggestions: [
    'Happy Valentine’s Day to the one who has my heart. You make every day feel special. ❤️',
    'To my Valentine: thank you for the love, the laughter and the little things. Enjoy your gift.',
    'You are my favourite person, today and every day. Happy Valentine’s Day!',
  ] },
  { key: 'mothers_day', label: "Mother's Day", headline: 'Happy\nMother’s Day', variant: 'light', logo: 'black', art: art('mothers_day'), suggestions: [
    'Happy Mother’s Day, Mum! Thank you for your endless love and care. Treat yourself today. 💐',
    'For the strongest, kindest woman I know. Thank you for everything, Mum.',
    'Happy Mother’s Day to someone who gives so much. Today is all about you.',
  ] },
  { key: 'fathers_day', label: "Father's Day", headline: 'Happy\nFather’s Day', variant: 'dark', logo: 'white', art: art('fathers_day'), suggestions: [
    'Happy Father’s Day! Thank you for your guidance, your patience and your support. Enjoy your gift.',
    'For the man who taught me so much. Thank you for always being there, Dad.',
    'Happy Father’s Day to the best dad around. Get yourself something you will enjoy.',
  ] },
  { key: 'easter', label: 'Easter', headline: 'Happy\nEaster', variant: 'light', logo: 'black', art: art('easter'), suggestions: [
    'Happy Easter! Wishing you and your family a season of joy, peace and new beginnings.',
    'Easter blessings to you and yours. Enjoy the holiday and a little treat on me.',
    'Wishing you a joyful Easter full of hope, rest and good company. 🐣',
  ] },
  { key: 'eid', label: 'Eid', headline: 'Eid Mubarak', variant: 'dark', logo: 'green', art: art('eid'), suggestions: [
    'Eid Mubarak! Wishing you and your family peace, joy and many blessings. 🌙',
    'May this Eid bring you happiness and good health. Enjoy a little gift from me.',
    'Eid Mubarak to you and your loved ones. Celebrate well and enjoy your day.',
  ] },
  { key: 'christmas', label: 'Christmas', headline: 'Merry\nChristmas', variant: 'dark', logo: 'white', art: art('christmas'), suggestions: [
    'Merry Christmas! Wishing you a joyful season with the people you love. Enjoy something special. 🎄',
    'Sending warm wishes for Christmas and the new year. Treat yourself, you deserve it.',
    'Merry Christmas to you and the whole family. May your holidays be full of laughter.',
  ] },
  { key: 'new_year', label: 'New Year', headline: 'Happy\nNew Year', variant: 'dark', logo: 'white', art: art('new_year'), suggestions: [
    'Happy New Year! Wishing you a year of good health, success and plenty of reasons to smile. 🎉',
    'Here is to a fresh start and a wonderful year ahead. Start it with something nice.',
    'Cheers to new beginnings. May the year ahead be your best one yet.',
  ] },
  { key: 'festive', label: "Season's greetings", headline: 'Season’s\ngreetings', variant: 'light', logo: 'black', art: art('festive'), suggestions: [
    'Season’s greetings! Wishing you peace, rest and happiness this festive season. ✨',
    'Warm wishes to you and yours for the holidays and the year ahead.',
    'Happy holidays! Enjoy the season and a little something from me.',
  ] },
];

export function giftCardTheme(key: unknown): GiftCardTheme {
  return GIFT_CARD_THEMES.find((t) => t.key === key) ?? GIFT_CARD_THEMES[0];
}

export const logoUrl = (logo: GiftCardTheme['logo']) => `/gift-cards/goldplus-logo-${logo}.svg`;

/** The note's limit: the same in the form, the API and the database (one constant, shared with the API). */
export { GIFT_CARD_MESSAGE_MAX as GIFT_MESSAGE_MAX } from '@goldplus/shared/src/gift-cards/giftText';

/**
 * The looks a GoldPlus gift card can take (0199). The API keeps only the key (gift_card_purchases.theme, checked
 * against the same list); everything about how a theme looks lives here. Drawn with gradients and small inline SVG
 * motifs: no photos to load, nothing borrowed, and the text always meets contrast on its own background.
 */
export type GiftCardThemeKey = 'gold' | 'birthday' | 'thanks' | 'love' | 'celebrate' | 'festive';

export interface GiftCardTheme {
  key: GiftCardThemeKey;
  /** In the theme picker. */
  label: string;
  /** The line across the top of the card. */
  headline: string;
  background: string;
  /** light text on a dark card, dark text on a light one */
  ink: 'light' | 'dark';
  /** amount pill and small accents */
  accent: string;
  accentInk: string;
}

const svg = (body: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>${body}</svg>`)}")`;

const confetti = svg(`<g opacity='.35'><rect x='18' y='20' width='10' height='4' rx='2' fill='#fff' transform='rotate(25 23 22)'/><circle cx='120' cy='34' r='4' fill='#fff'/><rect x='92' y='110' width='12' height='4' rx='2' fill='#1c1c1c' transform='rotate(-30 98 112)'/><circle cx='40' cy='120' r='3' fill='#1c1c1c'/><rect x='136' y='92' width='9' height='4' rx='2' fill='#fff' transform='rotate(60 140 94)'/><circle cx='70' cy='64' r='2.5' fill='#fff'/></g>`);
const leaves = svg(`<g fill='none' stroke='#fff' stroke-width='2' opacity='.16'><path d='M20 140c30-10 45-35 48-70-30 8-45 32-48 70z'/><path d='M110 60c25-6 38-24 40-50-24 6-37 24-40 50z'/></g>`);
const hearts = svg(`<g fill='#fff' opacity='.18'><path d='M40 52c-6-12-24-8-22 6 2 10 22 22 22 22s20-12 22-22c2-14-16-18-22-6z'/><path d='M118 118c-4-8-16-5-15 4 1 7 15 15 15 15s14-8 15-15c1-9-11-12-15-4z'/></g>`);
const stars = svg(`<g fill='#fff' opacity='.28'><path d='M30 24l3 8 8 3-8 3-3 8-3-8-8-3 8-3z'/><path d='M124 70l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'/><path d='M70 128l2.5 7 7 2.5-7 2.5-2.5 7-2.5-7-7-2.5 7-2.5z'/><circle cx='100' cy='26' r='1.6'/><circle cx='20' cy='92' r='1.6'/></g>`);
const snow = svg(`<g fill='#fff' opacity='.22'><circle cx='20' cy='30' r='2.5'/><circle cx='86' cy='18' r='1.8'/><circle cx='140' cy='52' r='2.5'/><circle cx='50' cy='96' r='1.8'/><circle cx='118' cy='124' r='2.5'/><circle cx='24' cy='146' r='1.8'/></g><g stroke='#F5C542' stroke-width='1.5' opacity='.5' fill='none'><path d='M128 14v16M120 22h16M122 16l12 12M134 16l-12 12'/></g>`);
const glow = svg(`<g fill='none' stroke='#93D500' stroke-width='1' opacity='.22'><circle cx='150' cy='10' r='40'/><circle cx='150' cy='10' r='70'/><circle cx='150' cy='10' r='100'/></g>`);

export const GIFT_CARD_THEMES: readonly GiftCardTheme[] = [
  { key: 'gold', label: 'GoldPlus', headline: 'A gift for you', background: `${glow}, radial-gradient(120% 90% at 100% 0%, rgba(147,213,0,.35) 0%, rgba(147,213,0,0) 55%), linear-gradient(135deg, #0A0A0A 0%, #1C1C1C 100%)`, ink: 'light', accent: '#93D500', accentInk: '#0A0A0A' },
  { key: 'birthday', label: 'Birthday', headline: 'Happy birthday', background: `${confetti}, linear-gradient(135deg, #FFB547 0%, #FF7A59 100%)`, ink: 'dark', accent: '#1C1C1C', accentInk: '#FFFFFF' },
  { key: 'thanks', label: 'Thank you', headline: 'Thank you', background: `${leaves}, linear-gradient(135deg, #0F5132 0%, #2E7D4F 100%)`, ink: 'light', accent: '#93D500', accentInk: '#0A0A0A' },
  { key: 'love', label: 'With love', headline: 'With love', background: `${hearts}, linear-gradient(135deg, #9D174D 0%, #BE185D 100%)`, ink: 'light', accent: '#FFFFFF', accentInk: '#9D174D' },
  { key: 'celebrate', label: 'Congratulations', headline: 'Congratulations', background: `${stars}, linear-gradient(135deg, #2E1065 0%, #6D28D9 100%)`, ink: 'light', accent: '#FDE68A', accentInk: '#2E1065' },
  { key: 'festive', label: 'Festive', headline: "Season's greetings", background: `${snow}, linear-gradient(135deg, #7F1D1D 0%, #B91C1C 100%)`, ink: 'light', accent: '#F5C542', accentInk: '#7F1D1D' },
];

export function giftCardTheme(key: unknown): GiftCardTheme {
  return GIFT_CARD_THEMES.find((t) => t.key === key) ?? GIFT_CARD_THEMES[0];
}

/**
 * Sharp L3 (category entry points): the buying situations people are in when they need what GoldPlus makes, each with
 * its own page. Products are found by the shop's own search over the live catalogue (never a hand-picked list that goes
 * stale); guides are existing published posts. Copy states only what the shop already says elsewhere.
 */
export interface BuyingSituation {
  slug: string;
  title: string;
  metaTitle: string;
  description: string;
  intro: string;
  /** Shop searches, each a row of products. */
  rows: { heading: string; search: string }[];
  guides: { label: string; href: string }[];
  extra?: { label: string; href: string };
}

export const BUYING_SITUATIONS: readonly BuyingSituation[] = [
  {
    slug: 'gifts',
    title: 'Gifts that get used every day',
    metaTitle: 'Tech Gifts in Kampala: Power Banks, Earbuds, Gift Cards | GoldPlus',
    description: 'GoldPlus gifts that get used every day: power banks, earbuds, speakers, flash drives and GoldPlus gift cards, delivered in Kampala.',
    intro: 'A charger, a power bank or a pair of earbuds is a gift that gets used every day. Not sure what they need? A GoldPlus gift card lets them choose.',
    rows: [
      { heading: 'Power banks', search: 'power bank' },
      { heading: 'Earbuds and speakers', search: 'earbuds' },
      { heading: 'Flash drives and memory cards', search: 'flash drive' },
    ],
    guides: [{ label: 'GoldPlus gift cards: how they work', href: '/blog/goldplus-gift-cards-how-they-work' }],
    extra: { label: 'Send a GoldPlus gift card', href: '/gift-card/buy' },
  },
  {
    slug: 'fast-charging',
    title: 'Fast charging, done safely',
    metaTitle: 'Fast Chargers & Cables for Android and iPhone in Kampala | GoldPlus',
    description: 'GoldPlus fast chargers, PD and QC chargers and the cables that carry fast charging, with guides on what your phone supports.',
    intro: 'Fast charging needs three things to agree: the phone, the charger and the cable. These are the GoldPlus chargers and cables built for it.',
    rows: [
      { heading: 'Fast chargers', search: 'fast charger' },
      { heading: 'Cables for fast charging', search: 'cable' },
    ],
    guides: [
      { label: 'Choosing a fast charger for Samsung, Tecno, Infinix and Android', href: '/blog/choosing-a-fast-charger-for-samsung-tecno-infinix-and-android' },
      { label: 'Does fast charging damage your battery?', href: '/blog/does-fast-charging-damage-your-battery' },
      { label: 'Why cable quality matters for fast charging', href: '/blog/why-cable-quality-matters-for-fast-charging' },
    ],
    extra: { label: 'Find the right charger for your phone', href: '/charger-finder' },
  },
  {
    slug: 'travel',
    title: 'Staying charged on the road',
    metaTitle: 'Power Banks & Chargers for Travel and Trips Upcountry | GoldPlus',
    description: 'GoldPlus power banks, car chargers and cables for long trips upcountry, flights from Entebbe and days away from a socket.',
    intro: 'Long trips upcountry, a flight from Entebbe or a day with no socket: carry the power with you.',
    rows: [
      { heading: 'Power banks', search: 'power bank' },
      { heading: 'Car chargers', search: 'car charger' },
    ],
    guides: [
      { label: 'Staying charged on long trips upcountry', href: '/blog/staying-charged-on-long-trips-upcountry' },
      { label: 'Taking a power bank on a plane from Entebbe', href: '/blog/taking-a-power-bank-on-a-plane-from-entebbe-the-watt-hour-rules' },
      { label: 'Staying charged through power cuts', href: '/blog/staying-charged-through-power-cuts-a-practical-plan' },
    ],
  },
  {
    slug: 'car-charging',
    title: 'Charging in the car',
    metaTitle: 'Car Chargers for Phones in Kampala, Uganda | GoldPlus',
    description: 'GoldPlus car chargers and cables for charging your phone in the car on the daily drive and long trips.',
    intro: 'A car charger turns the 12V socket into a fast, steady charge for the daily drive and the long trip.',
    rows: [
      { heading: 'Car chargers', search: 'car charger' },
      { heading: 'Cables', search: 'cable' },
    ],
    guides: [
      { label: 'Car chargers explained: the 12V socket', href: '/blog/car-chargers-explained-the-12v-socket-and-what-a-car-charger-does' },
      { label: 'Choosing a car charger for long trips', href: '/blog/choosing-a-car-charger-for-long-trips-upcountry' },
    ],
  },
];

export const situationBySlug = (slug: string | undefined): BuyingSituation | null =>
  BUYING_SITUATIONS.find((s) => s.slug === slug) ?? null;

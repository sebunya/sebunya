/** "first", "second" … "tenth", then 11th, 12th, 13th, 21st, 22nd, 23rd … */
const WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

export function ordinalWord(n: number): string {
  if (Number.isInteger(n) && n >= 1 && n <= WORDS.length) return WORDS[n - 1];
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

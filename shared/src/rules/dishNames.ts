/**
 * Matching dish names loosely, for menus and merging. "Beer (draft)", "beers" and "BEER" are
 * the same dish (same key); "Mortadella" and "Mortadella pizza" might be (a suggestion only).
 */
export function looseDishKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')             // "(draft)", "(GF)"
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')       // punctuation
    .split(/\s+/)
    .filter((w) => w && w !== 'the' && w !== 'a')
    .map((w) => (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w))   // simple plurals
    .join(' ');
}

/** Words that name a kind of dish, not a particular one ("Pizza" isn't the same as "Diavola pizza"). */
const CATEGORY_WORDS = new Set([
  'pizza', 'pie', 'salad', 'soup', 'pasta', 'noodle', 'rice', 'sandwich', 'burger', 'taco', 'burrito', 'bowl', 'plate', 'roll',
  'beer', 'wine', 'cocktail', 'coffee', 'tea', 'juice', 'soda', 'dessert', 'cake', 'special', 'combo', 'side', 'appetizer',
  'small', 'large', 'regular', 'house', 'and', 'with', 'w',
]);

/**
 * Likely the same dish, but not certain: one name's words are all in the other's (and say more
 * than a kind of dish), or they're a typo apart.
 */
export function similarDishNames(a: string, b: string): boolean {
  const ka = looseDishKey(a), kb = looseDishKey(b);
  if (!ka || !kb || ka === kb) return Boolean(ka) && ka === kb;
  const wa = ka.split(' '), wb = kb.split(' ');
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (short.every((w) => long.includes(w)) && short.some((w) => !CATEGORY_WORDS.has(w))) return true;
  return Math.min(ka.length, kb.length) >= 6 && editDistance(ka, kb) <= 2;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

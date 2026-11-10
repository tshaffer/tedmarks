import { normalizeItemName } from '../schema/item.js';

// Adding pages to a menu: what Claude read from the new pages is compared with the menu's dish
// list (same name = same dish), checked by us, then merged in. The phone has the same rules
// (MenuDishes.swift).

/** A dish on a menu's list. */
export interface MenuDish {
  section?: string | undefined;
  name: string;
  price?: string | undefined;
  description?: string | undefined;
}

export type MenuDishStatus = 'new' | 'changed' | 'same';

export interface ComparedMenuDish extends MenuDish {
  /** new = not on the menu yet; changed = on it at another price; same = already on it as is. */
  status: MenuDishStatus;
  /** The menu's price before, when it changed. */
  previousPrice?: string | undefined;
}

const samePrice = (a: string | undefined, b: string | undefined) => (a ?? '').replace(/\s+/g, '') === (b ?? '').replace(/\s+/g, '');

/** How each dish read from the new pages compares with the menu's dishes. */
export function compareWithMenu(existing: readonly MenuDish[], read: readonly MenuDish[]): ComparedMenuDish[] {
  const byName = new Map(existing.map((d) => [normalizeItemName(d.name), d]));
  return read.map((dish) => {
    const current = byName.get(normalizeItemName(dish.name));
    if (!current) return { ...dish, status: 'new' };
    if (dish.price && !samePrice(dish.price, current.price)) return { ...dish, status: 'changed', previousPrice: current.price };
    return { ...dish, status: 'same' };
  });
}

/**
 * The menu's dishes with the checked ones added: a dish already on it (by name) gets the new
 * price and, if it had none, the description; a new one goes after the last dish of its section,
 * or at the end.
 */
export function mergeIntoMenu(existing: readonly MenuDish[], checked: readonly MenuDish[]): MenuDish[] {
  const result = existing.map((d) => ({ ...d }));
  for (const dish of checked) {
    const name = dish.name.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = normalizeItemName(name);
    const current = result.find((d) => normalizeItemName(d.name) === key);
    if (current) {
      if (dish.price) current.price = dish.price;
      if (dish.description && !current.description) current.description = dish.description;
      continue;
    }
    const added: MenuDish = { name, ...(dish.section ? { section: dish.section } : {}), ...(dish.price ? { price: dish.price } : {}), ...(dish.description ? { description: dish.description } : {}) };
    let lastOfSection = -1;
    if (dish.section) result.forEach((d, i) => { if (d.section === dish.section) lastOfSection = i; });
    if (lastOfSection >= 0) result.splice(lastOfSection + 1, 0, added);
    else result.push(added);
  }
  return result;
}

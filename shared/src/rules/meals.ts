import type { OpeningPeriodInput } from './hours.js';

export interface MealsServed { breakfast: boolean; lunch: boolean; dinner: boolean }

/** The windows a place has to be open in (on any day) to count as serving that meal. */
const WINDOWS: Record<keyof MealsServed, [number, number]> = {
  breakfast: [7 * 60, 10 * 60 + 30],
  lunch: [11 * 60 + 30, 14 * 60],
  dinner: [17 * 60 + 30, 21 * 60],
};

/**
 * A best guess at the meals a place serves, from its Google hours: open at some point during
 * the meal's window on at least one day. Undefined without hours. The place's own
 * attributes.mealsServed (set by hand) wins over this.
 */
export function mealsFromHours(periods: readonly OpeningPeriodInput[] | undefined): MealsServed | undefined {
  if (!periods || periods.length === 0) return undefined;
  if (periods.length === 1 && !periods[0]!.close && periods[0]!.open.time === '0000') {
    return { breakfast: true, lunch: true, dinner: true };   // open 24 hours
  }
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
  // Each period as minutes from the start of its opening day (closing after midnight runs past 1440).
  const spans = periods.map((p) => {
    const start = toMin(p.open.time);
    if (!p.close) return [start, start + 1440] as const;
    const days = (p.close.day - p.open.day + 7) % 7;
    let end = days * 1440 + toMin(p.close.time);
    if (end <= start) end += 7 * 1440;
    return [start, end] as const;
  });
  const serves = (meal: keyof MealsServed) => {
    const [from, to] = WINDOWS[meal];
    // The window on the opening day, or the next day for places open past midnight.
    return spans.some(([start, end]) => [0, 1440].some((shift) => start < to + shift && end > from + shift));
  };
  return { breakfast: serves('breakfast'), lunch: serves('lunch'), dinner: serves('dinner') };
}

export type Meal = keyof MealsServed;

/**
 * Whether a place is open at some point during a meal's window on a given day (0 = Sunday), in
 * its own time. Undefined without hours. (For "where can we have breakfast on Saturday?")
 */
export function openForMeal(periods: readonly OpeningPeriodInput[] | undefined, day: number, meal: Meal): boolean | undefined {
  if (!periods || periods.length === 0) return undefined;
  if (periods.length === 1 && !periods[0]!.close && periods[0]!.open.time === '0000') return true;   // 24 hours
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2, 4));
  const WEEK = 7 * 1440;
  const [from, to] = WINDOWS[meal];
  const start = day * 1440 + from, end = day * 1440 + to;
  return periods.some((p) => {
    const open = p.open.day * 1440 + toMin(p.open.time);
    let close = p.close ? p.close.day * 1440 + toMin(p.close.time) : open + 1440;
    if (close <= open) close += WEEK;
    // The period, or the same period a week earlier (for ones that wrap past Saturday night).
    return [0, -WEEK].some((shift) => open + shift < end && close + shift > start);
  });
}

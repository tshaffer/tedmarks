/** Google's weekly opening periods (shared/src/schema/place.ts OpeningPeriod). Days: 0 = Sunday. */
export interface OpeningPeriodInput {
  open: { day: number; time: string };
  close?: { day: number; time: string } | undefined;
}

export interface OpenStatus {
  isOpen: boolean;
  /** "Open until 9:30 PM", "Closed · opens 5 PM", "Closed · opens Tue 11 AM", "Open 24 hours". */
  label: string;
}

const WEEK = 7 * 1440;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const minutes = (day: number, time: string) => day * 1440 + Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4));

function clock(minuteOfWeek: number): string {
  const m = ((minuteOfWeek % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60), min = m % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

/**
 * Whether a place is open at `now`, in the place's own time zone (`utcOffsetMinutes` from
 * Google; falls back to this computer's zone). Undefined when there are no hours.
 */
export function openStatus(
  periods: readonly OpeningPeriodInput[] | undefined,
  utcOffsetMinutes: number | undefined,
  now: Date = new Date(),
): OpenStatus | undefined {
  if (!periods || periods.length === 0) return undefined;
  // Open around the clock: Google sends one period opening Sunday 00:00 with no close.
  if (periods.length === 1 && !periods[0]!.close && periods[0]!.open.day === 0 && periods[0]!.open.time === '0000') {
    return { isOpen: true, label: 'Open 24 hours' };
  }
  const offset = utcOffsetMinutes ?? -now.getTimezoneOffset();
  const local = new Date(now.getTime() + offset * 60_000);
  const t = local.getUTCDay() * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes();

  const ranges = periods.flatMap((p) => {
    const start = minutes(p.open.day, p.open.time);
    let end = p.close ? minutes(p.close.day, p.close.time) : start + 1440;
    if (end <= start) end += WEEK;
    return [{ start, end }, { start: start - WEEK, end: end - WEEK }];
  });

  const current = ranges.find((r) => t >= r.start && t < r.end);
  if (current) {
    const sameDay = Math.floor(current.end / 1440) === Math.floor(t / 1440);
    return { isOpen: true, label: `Open until ${clock(current.end)}${sameDay || current.end - t < 1440 ? '' : ` ${DAYS[Math.floor(current.end / 1440) % 7]}`}` };
  }
  // The soonest opening after now, wrapping around the week.
  const next = t + Math.min(...ranges.map((r) => ((((r.start - t) % WEEK) + WEEK) % WEEK) || WEEK));
  const sameDay = Math.floor(next / 1440) === Math.floor(t / 1440);
  return { isOpen: false, label: `Closed · opens ${sameDay ? '' : `${DAYS[Math.floor(next / 1440) % 7]} `}${clock(next)}` };
}

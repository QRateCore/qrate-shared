/**
 * Menu window math — the ONE owner-side mirror of the backend evaluator that
 * decides what guests are served (qrate-core
 * layers/shared/python/qrate_shared/menu_resolver.py `_is_in_window` +
 * `_menu_active_at`). Every owner-side "is this menu live / where does its
 * band go" question routes through here so the Schedule panel, the tab status
 * pill and the gap warning agree with what the kitchen is actually serving.
 *
 * The window math core applies, mirrored here (precedence between a `schedule` entry and the
 * row-level window still differs slightly in getMenuTabStatus / resolveDayWindow):
 *  - At (clock, dow) core reads ONLY that day's entry (`schedule[dow]`, or the
 *    row-level window when `dow in days_of_week`). The previous day's entry is
 *    never consulted.
 *  - Inside that entry, `end < start` is an OVERNIGHT window: open when
 *    `clock >= start OR clock < end`. So an overnight entry on day d is live on
 *    d from `start` to 24:00 AND on d from 00:00 to `end` — the early-morning
 *    head belongs to d's OWN entry. A Saturday 17:00–02:00 service therefore
 *    runs on into Sunday only if Sunday is itself a scheduled day whose window
 *    (overnight, or opening at 00:00) covers 00:00–02:00.
 *  - `start == end` is never open.
 *
 * Consumers: `isMenuLiveNow` (this package), `MenuTabBar.getMenuTabStatus`
 * (this package), owner `lib/menu/scheduleGap.ts` and
 * `menu-manager-view/menuSchedule.ts` (via `@qrate/shared`).
 */

export const MINUTES_PER_DAY = 24 * 60;

/**
 * `_is_in_window`: inclusive start, exclusive end, overnight when end < start,
 * never open when start == end. All values are minutes since midnight.
 */
export function isMinuteInWindow(nowMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

/**
 * The same window as the [start, end) minute segments it occupies within ONE
 * calendar day — what a timeline band for that day's entry should draw.
 *   normal     11:00–22:00 → [[660, 1320]]
 *   overnight  17:00–02:00 → [[1020, 1440], [0, 120]]
 *   zero       12:00–12:00 → []
 */
export function windowSegmentsForDay(startMin: number, endMin: number): Array<[number, number]> {
  if (startMin === endMin) return [];
  if (startMin < endMin) return [[startMin, endMin]];
  const out: Array<[number, number]> = [[startMin, MINUTES_PER_DAY]];
  if (endMin > 0) out.push([0, endMin]);
  return out;
}

/**
 * Whether a day's window, as core serves it on THAT day, covers the whole
 * early-morning stretch [00:00, untilMin). Used to decide whether the
 * previous day's overnight tail is actually served: it is only when the next
 * day's own entry covers it (an overnight window closing no earlier, or a
 * window that opens at 00:00 and closes no earlier).
 */
export function windowCoversEarlyMorning(startMin: number, endMin: number, untilMin: number): boolean {
  if (untilMin <= 0) return true;
  return windowSegmentsForDay(startMin, endMin).some(([s, e]) => s === 0 && e >= untilMin);
}

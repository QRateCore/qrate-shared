import type { MenuSummary } from '../types/restaurant';

/**
 * Decide whether a menu is "live now" in the owner's *browser* timezone.
 *
 * `restaurants.timezone` doesn't exist as a column — owners author menu
 * `start_time`/`end_time` in their own local clock, so the comparison
 * must run client-side against that same clock. Running this on the
 * server in UTC would give every non-UTC restaurant the wrong answer.
 *
 * Day numbering: 0 = Sunday … 6 = Saturday — matches both
 * `menus.days_of_week` and `Date.prototype.getDay()`.
 *
 * Evaluation order:
 *   1. `menu.active = false` → never live (owner paused the menu)
 *   2. `is_all_day` → live on any day in `days_of_week` (empty array
 *      means "every day"; matches the schema default)
 *   3. Per-day `schedule[<dow>]` overrides legacy `start_time`/`end_time`
 *      — a missing entry for the current dow means off today
 *   4. Legacy `days_of_week` + `start_time` + `end_time`. Missing
 *      bounds + day match falls through to live (no time cap)
 *
 * Window math: end_time is exclusive. `end <= start` wraps midnight
 * (dinner 17:00 → 02:00). start == end is treated as "no schedule" =
 * inactive — defending against the all-zeros default for unscheduled
 * menus, which would otherwise round-trip as permanently live.
 */
export function isMenuLiveNow(menu: MenuSummary, now: Date = new Date()): boolean {
  if (!menu.active) return false;
  const dow = now.getDay();

  if (menu.is_all_day) {
    return menu.days_of_week.length === 0 || menu.days_of_week.includes(dow);
  }

  if (menu.schedule) {
    const entry = menu.schedule[String(dow)];
    if (!entry || !entry.start || !entry.end) return false;
    return isNowInHHMMWindow(now, entry.start, entry.end);
  }

  if (menu.days_of_week.length > 0 && !menu.days_of_week.includes(dow)) return false;
  if (!menu.start_time || !menu.end_time) return true;
  return isNowInHHMMWindow(now, menu.start_time, menu.end_time);
}

function isNowInHHMMWindow(now: Date, start: string, end: string): boolean {
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null) return false;
  if (startMin === endMin) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mins = Number(m[2]);
  if (h < 0 || h > 23 || mins < 0 || mins > 59) return null;
  return h * 60 + mins;
}

/**
 * Classify a recommendation grouping member as 'active' or 'inactive'
 * against the loaded menus list. Empty `menu_ids` → inactive (orphan).
 * Any menu in `menu_ids` that resolves to a non-paused menu → active.
 *
 * Schedule windows are intentionally NOT considered: from the owner's
 * point of view a rec target sitting on the Dinner menu is "on a menu",
 * not "inactive", regardless of whether they happen to be editing at
 * 11 AM. The previous live-now predicate produced false positives in
 * the Inactive popover for every cross-menu rec whose target menu was
 * out of its time window at the moment the page rendered. Owner-paused
 * menus (active = false) still count as inactive because the owner
 * took an explicit action to take that menu offline.
 *
 * Accepts an optional pre-built `menusById` index so callers rendering
 * one row per dish don't rebuild the map per member.
 */
export function classifyRecMember(
  member: { menu_ids: readonly string[] },
  menus: readonly MenuSummary[],
  menusById?: ReadonlyMap<string, MenuSummary>,
): 'active' | 'inactive' {
  if (member.menu_ids.length === 0) return 'inactive';
  const index = menusById ?? new Map(menus.map((m) => [m.id, m]));
  for (const id of member.menu_ids) {
    const menu = index.get(id);
    if (menu && menu.active) return 'active';
  }
  return 'inactive';
}

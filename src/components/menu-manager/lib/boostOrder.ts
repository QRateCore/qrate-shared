/**
 * Boost-first dish order inside a sub-category (owner Menus workspace, Avi
 * 2026-11-15): High > Moderate > Low > no boost. Dishes with the SAME boost keep
 * the owner's manual (drag) order, so the sort is stable over that order, and a
 * dish can only be dragged among dishes of its own boost tier.
 */
import type { MenuItemJunctionSettings } from '../../../types/restaurant';

/** 3 = High, 2 = Moderate, 1 = Low, 0 = no boost. A per-course override wins
 *  over the placement's shared boost (same rule as the row's boost slider). */
export function boostRank(settings: Pick<MenuItemJunctionSettings, 'boost_level' | 'category_boost_levels'> | undefined, category: string): number {
  if (!settings) return 0;
  const raw = settings.category_boost_levels?.[category] ?? settings.boost_level;
  const n = typeof raw === 'number' ? raw : raw != null ? Number(raw) : 0;
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : 0;
}

/** Stable sort: higher boost first; ties keep their incoming (manual) order. */
export function sortByBoost<T>(items: readonly T[], rankOf: (item: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, r: rankOf(item) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.item);
}

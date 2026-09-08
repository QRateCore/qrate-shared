// Pure helpers for the addon ↔ dish association logic.
// Extracted so they can be tested without the React tree.

import type { MenuItemDisplay, AddonEntry } from '../../../types/restaurant';
import { getAddonsFromGroupings } from '../../../lib/groupings/useGroupingAddons';
import { asArray } from './menuUtils';

/**
 * Count of addons on a dish that the owner has accepted ("approved"). AI-
 * suggested but unreviewed entries are excluded so the row badge reflects
 * what's actually live on the menu.
 *
 * PDD 2026-05-10 Phase D Step 11 — addons now read from item.groupings.
 * Falls back to legacy item.addons during the rollout window for any
 * item shape that hasn't been hydrated with groupings yet — backend's
 * dual-write pattern (BYO_DUAL_WRITE_ENABLED) keeps the two consistent
 * until Phase F Step 16 cuts over.
 */
export function countApprovedAddons(
  item: Pick<MenuItemDisplay, 'addons' | 'groupings'>,
): number {
  // Prefer groupings (post-cutover source of truth). If the item has
  // no groupings array at all, fall back to legacy field; if both are
  // empty, return 0.
  // asArray, not a truthiness + length check: a double-encoded JSONB value
  // arrives as the JSON *text* of the array, and a string passes both.
  if (asArray<NonNullable<MenuItemDisplay['groupings']>[number]>(item.groupings).length > 0) {
    return getAddonsFromGroupings(item).filter((a) => a.status === 'approved').length;
  }
  return asArray<AddonEntry>(item.addons).filter((a) => a.status === 'approved').length;
}

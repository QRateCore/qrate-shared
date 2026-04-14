// Pure helpers for the addon ↔ dish association logic.
// Extracted so they can be tested without the React tree.

import type { AddonEntry, MenuItemDisplay } from '../../../types/restaurant';

/**
 * Count of addons on a dish that the owner has accepted ("approved"). AI-
 * suggested but unreviewed entries are excluded so the row badge reflects
 * what's actually live on the menu.
 */
export function countApprovedAddons(item: Pick<MenuItemDisplay, 'addons'>): number {
  return (item.addons ?? []).filter((a) => a.status === 'approved').length;
}

/**
 * Dishes whose association with `addonId` is still tracking the addon's old
 * base price (`price_override === oldBase`). These are the dishes whose
 * `price_override` should be cascaded when the addon's base price changes.
 * Dishes with an explicit per-dish override (different from oldBase) are NOT
 * returned — their owner-set price is preserved.
 */
export function computeAddonCascadeTargets(
  allItems: MenuItemDisplay[],
  addonId: string,
  oldBase: number,
): MenuItemDisplay[] {
  return allItems.filter((d) =>
    d.addons?.some((a) => a.menu_item_id === addonId && (a.price_override ?? 0) === oldBase),
  );
}

/**
 * Return the dish's addons array with every entry referencing `addonId` that
 * was tracking `oldBase` advanced to `newBase`. Custom overrides are left as-is.
 */
export function applyAddonPriceCascade(
  addons: AddonEntry[],
  addonId: string,
  oldBase: number,
  newBase: number,
): AddonEntry[] {
  return addons.map((a) =>
    a.menu_item_id === addonId && (a.price_override ?? 0) === oldBase
      ? { ...a, price_override: newBase }
      : a,
  );
}

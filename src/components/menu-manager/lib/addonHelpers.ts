// Pure helpers for the addon ↔ dish association logic.
// Extracted so they can be tested without the React tree.

import type { MenuItemDisplay } from '../../../types/restaurant';

/**
 * Count of addons on a dish that the owner has accepted ("approved"). AI-
 * suggested but unreviewed entries are excluded so the row badge reflects
 * what's actually live on the menu.
 */
export function countApprovedAddons(item: Pick<MenuItemDisplay, 'addons'>): number {
  return (item.addons ?? []).filter((a) => a.status === 'approved').length;
}

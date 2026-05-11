// ──────────────────────────────────────────────────────────────────
// Sync source: qrate-patron-webapp/src/lib/groupings/useGroupingAddons.ts
// (patron is the canonical copy because it shipped first in Phase C Step 5)
//
// When patron's helper changes, copy it here verbatim. The two files
// implement the same contract — divergence is a bug, not an extension
// point. This duplication exists because patron-webapp does not consume
// @qrate/shared (it's a separate app with its own dependency tree),
// so the helper has to live in two places. Owner-webapp + waiter-webapp
// + admin-webapp consume this file via the @qrate/shared submodule, so
// they share it automatically.
// ──────────────────────────────────────────────────────────────────
//
/**
 * useGroupingAddons — read add-on entries from a menu item's `groupings`
 * array (Phase C Step 5 of the addons/recs → groupings collapse PDD).
 *
 * Source-of-truth shift: add-ons used to live on `item.addons` (legacy
 * field, populated from `menu_item_addons` join table). They now live in
 * `item.groupings.find(g => g.kind === 'addons').items` (populated from
 * `food_item_grouping_items`). This helper projects the new shape back
 * to the same `AddonView` consumers expect, decoupling the consumer
 * migration (Steps 6–9) from the backend payload change (Step 15).
 *
 * The pure function and the hook return a `readonly AddonView[]` —
 * either an empty array or the projected items. Both forms are safe to
 * call with `null`/`undefined` items (returns `EMPTY`).
 *
 * Memoisation contract (Frontend-Dev re-vote finding):
 * - The hook (`useGroupingAddons`) memoises on `item.groupings` reference
 *   identity. Same reference → same array. New reference → new array.
 *   This prevents recompute storms in CompositionPage / RunningOrder /
 *   ledgerView whose `useMemo`/`useEffect` deps would otherwise fire on
 *   every render.
 * - The pure function (`getAddonsFromGroupings`) returns a fresh array
 *   on every call — by design, since it has no React context to hold a
 *   memo. Callers in non-React code (e.g. CartContext reducers) are
 *   responsible for caching at their own boundary.
 *
 * The returned array is intentionally `readonly` to make accidental
 * mutation a TS error.
 */

import { useMemo } from 'react';

export type AddonView = Readonly<{
  /** menu_items.id of the addon */
  menu_item_id: string;
  name: string;
  /** 0 when the addon is free; positive number when there's an upcharge */
  price_override: number;
  thumbnail_url: string | null;
  status: 'suggested' | 'approved';
  suggestion_source: 'ai' | 'manual';
}>;

/**
 * Minimal structural type for items-with-groupings — keeps the helper
 * decoupled from the (multiple, fragmented) full MenuItem definitions
 * scattered across patron-webapp. Any item shape that includes a
 * `groupings` array with the documented kinds + items will work.
 *
 * Mirrors the same pattern used by overrides.ts (ItemWithGroupings).
 */
export interface ItemWithGroupingsAndItems {
  groupings?: Array<{
    kind?: 'addons' | 'sides_and' | 'sides_or' | 'recommendations' | string | null;
    items?: Array<{
      menu_item_id: string;
      name?: string;
      thumbnail_url?: string | null;
      price_override?: number | null;
      status?: 'suggested' | 'approved';
      suggestion_source?: 'manual' | 'ai';
    }>;
  }>;
}

const EMPTY: readonly AddonView[] = Object.freeze([]) as readonly AddonView[];

/**
 * Pure projection from `item.groupings` to the legacy AddonView[] shape.
 * Returns the same shape today's `item.addons` provides so consumers can
 * swap field-by-field without changing downstream code.
 *
 * Caller MUST wrap in `useMemo` when using the return value as a React
 * dep — every call returns a fresh array reference.
 *
 * Use the `useGroupingAddons` hook from React components for the
 * memoised version.
 */
export function getAddonsFromGroupings(
  item: ItemWithGroupingsAndItems | null | undefined,
): readonly AddonView[] {
  if (!item || !item.groupings || item.groupings.length === 0) return EMPTY;

  const addonsGrouping = item.groupings.find((g) => g.kind === 'addons');
  if (!addonsGrouping || !addonsGrouping.items || addonsGrouping.items.length === 0) {
    return EMPTY;
  }

  return addonsGrouping.items.map((gi) => ({
    menu_item_id: gi.menu_item_id,
    name: gi.name ?? '',
    // Legacy AddonEntry has price_override: number (not nullable).
    // Preserve the contract: NULL → 0 (free addon).
    price_override: gi.price_override ?? 0,
    thumbnail_url: gi.thumbnail_url ?? null,
    // GroupingItem treats status/suggestion_source as optional with
    // defaults; the legacy AddonEntry treated them as required. Keep
    // the legacy contract by defaulting to the same values the backend
    // applies on insert.
    status: gi.status ?? 'approved',
    suggestion_source: gi.suggestion_source ?? 'manual',
  }));
}

/**
 * React hook variant — memoised on `item.groupings` reference. Use
 * this from React components instead of calling `getAddonsFromGroupings`
 * directly, to avoid recompute storms.
 *
 * Identity contract:
 *   - `item.groupings` reference unchanged → returned array reference unchanged
 *   - `item.groupings` reference changed → returned array is fresh
 *   - `item` itself null/undefined → always returns the frozen EMPTY array
 *     (stable identity across renders)
 */
export function useGroupingAddons(
  item: ItemWithGroupingsAndItems | null | undefined,
): readonly AddonView[] {
  // Depend on the groupings reference so the memo invalidates exactly
  // when the source data changes. We pull it out of `item` because
  // pure-function callers should be able to pass any item with the
  // same groupings reference and get the same result.
  const groupings = item?.groupings;
  return useMemo(
    () => getAddonsFromGroupings(item),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- groupings reference is the load-bearing dep
    [groupings],
  );
}

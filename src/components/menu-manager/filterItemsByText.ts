/**
 * Case-insensitive substring match on a menu item's name + description.
 *
 * Shared by two surfaces so they stay behaviourally identical:
 *   - the item-pool filter in MenuManagerClient (left panel), and
 *   - the chosen-menu builder filter in MenuBuilder (right panel), driven by
 *     the app-shell search via PageSearchContext (2026-07-05).
 */

export interface TextSearchableItem {
  name?: string | null;
  description?: string | null;
}

/** True when `query` is empty (match-all) or occurs in the item's name/description. */
export function matchesItemText(item: TextSearchableItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    (item.name ?? '').toLowerCase().includes(needle) ||
    (item.description ?? '').toLowerCase().includes(needle)
  );
}

/** Filter a list by `matchesItemText`. Empty/whitespace query → copy of input. */
export function filterItemsByText<T extends TextSearchableItem>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => matchesItemText(item, needle));
}

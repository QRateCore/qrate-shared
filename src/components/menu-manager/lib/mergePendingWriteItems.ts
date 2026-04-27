import type { MenuItemDisplay } from '../../../types/restaurant';

/**
 * STR-409: Merge a refreshed server snapshot (`initialItems`) with the
 * current locally-rendered items (`prevItems`) while preserving the
 * optimistic state of any item whose id is in `pending`.
 *
 * Used by `MenuManagerClient`'s refresh-edge `useEffect` so that a
 * `refreshing` true → false transition does not clobber items whose
 * server write (PUT/POST) is still in flight.
 *
 * Behaviour:
 *   - Empty `pending`     → returns `initialItems` (wholesale replace).
 *   - Non-empty `pending` → returns the server list, but for any id in
 *     `pending` substitute the matching `prevItems` entry (optimistic).
 *
 * Edge case (stale-pending-id): if a server snapshot omits an in-flight
 * item id, the optimistic entry is dropped (the `.map` only iterates
 * server-supplied items). The in-flight write will fail or 404 on settle
 * and the catch path runs.
 */
export function mergePendingWriteItems(
  initialItems: MenuItemDisplay[],
  prevItems: MenuItemDisplay[],
  pending: Set<string>,
): MenuItemDisplay[] {
  if (pending.size === 0) return initialItems;
  return initialItems.map((nextItem) => {
    if (!pending.has(nextItem.id)) return nextItem;
    return prevItems.find((p) => p.id === nextItem.id) ?? nextItem;
  });
}

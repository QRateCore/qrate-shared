import { useState, useRef, useCallback } from 'react';

type AnchorEntry = { itemId: string; listKey?: string } | null;

/**
 * Multi-select hook with shift-click range selection, Cmd/Ctrl toggle,
 * and plain-click toggle. Use this everywhere a table or list supports
 * multi-select — never reimplement selection logic inline.
 *
 * Plain click   → toggle item, update anchor
 * Shift+click   → select range from anchor to clicked item (replaces selection)
 * Cmd/Ctrl+click → toggle item without disturbing other selections
 *
 * @param listKey - Optional. When multiple independent lists share the same
 *   view (e.g. Item Pool + per-menu builder rows), pass a listKey per list so
 *   that shift+click only ranges within the same list.
 */
export function useRangeSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<AnchorEntry>(null);

  const handleSelectClick = useCallback(
    (
      e: { shiftKey: boolean; metaKey?: boolean; ctrlKey?: boolean },
      itemId: string,
      orderedIds: string[],
      listKey?: string,
    ) => {
      const anchor = anchorRef.current;

      if (e.shiftKey && anchor !== null) {
        // Cross-list shift+click: fall back to plain toggle, reset anchor.
        if (listKey !== undefined && anchor.listKey !== listKey) {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
            return next;
          });
          anchorRef.current = { itemId, listKey };
          return;
        }
        const fromIdx = orderedIds.indexOf(anchor.itemId);
        const toIdx = orderedIds.indexOf(itemId);
        if (fromIdx === -1 || toIdx === -1) {
          // Anchor filtered out of current view — fall back to plain toggle.
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
            return next;
          });
          anchorRef.current = { itemId, listKey };
          return;
        }
        const lo = Math.min(fromIdx, toIdx);
        const hi = Math.max(fromIdx, toIdx);
        setSelected(new Set(orderedIds.slice(lo, hi + 1)));
        // Anchor stays put on shift-click (standard Explorer/Finder behaviour).
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
          return next;
        });
        anchorRef.current = { itemId, listKey };
        return;
      }

      // Plain click — toggle (checkbox behaviour).
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
        return next;
      });
      anchorRef.current = { itemId, listKey };
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
    anchorRef.current = null;
  }, []);

  return { selected, setSelected, handleSelectClick, clearSelection, selectAll };
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings, AddonEntry, FoodTags } from '../../types/restaurant';
import {
  buildAssignments,
  buildJunctionSettings,
  getMenuColor,
  CANONICAL_CATEGORIES,
  toCanonical,
  type MenuColor,
} from './lib/menuUtils';
import ItemPool from './components/ItemPool';
import MenuBuilder, { type ModifierUpdatePayload } from './components/MenuBuilder';
import MobileMenuManagerLayout from './components/MobileMenuManagerLayout';
import BulkActionsPanel from './components/BulkActionsPanel';
import BulkModifierPanel from './components/BulkModifierPanel';
import EditModal from './components/EditModal';
import MenuEditPanel from './components/MenuEditPanel';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { MenuManagerService } from '../../types/restaurant';
import { MenuManagerServiceProvider } from './context';
import { useTrackAction } from './track-action-context';

// ── Types ────────────────────────────────────────────────────────────────────

export type BulkMode = 'assign' | 'remove' | 'boost' | 'special' | 'availability' | 'delete';

export interface DragState {
  itemIds: string[];
  fromMenuId: string | null;
  fromCat: string | null;
}

interface Props {
  service: MenuManagerService;
  restaurantId: string;
  initialItems: MenuItemDisplay[];
  initialMenus: MenuSummary[];
  /** Called when the user requests a data refresh (re-fetch menus + items from the server). */
  onRefresh?: () => void;
  /** True while a background refresh is in flight — used to show a spinner on the refresh button. */
  refreshing?: boolean;
  /** Optional: auto-open this item's edit modal on mount (e.g. navigated from another page). */
  openItemId?: string | null;
  /**
   * Optional gate called before a dropped item is added as a recommendation.
   * Consumer apps (e.g., owner dashboard) use this to prompt for canonical
   * categories when the dropped item is not yet on the current menu, and to
   * make the `addItemToMenu` API call before accepting the drop.
   *
   * Return `true` to proceed, `false` to cancel. When this prop is not
   * provided, drops proceed silently (backward compat).
   *
   * See ItemModifierZones for the full contract.
   */
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /**
   * Optional gate called before an item is removed from a menu. Consumer apps
   * use this to warn the owner when the removal would deactivate existing
   * recommendations — per Step 9 of the rec-lifecycle PDD, the "last
   * occurrence" case.
   *
   * Shared computes `isLastActiveMenuPlacement` from the current items +
   * menu_associations state. The consumer is responsible for deciding whether
   * to show a confirmation dialog (typically: skip the dialog if not last
   * occurrence OR if no recommendations reference the item; show otherwise).
   *
   * Return `true` to proceed with the removal, `false` to cancel. When this
   * prop is not provided, removals proceed silently (backward compat).
   */
  onConfirmItemRemoval?: (params: {
    item: MenuItemDisplay;
    menuId: string;
    isLastActiveMenuPlacement: boolean;
  }) => Promise<boolean>;
  /**
   * Feature flag: when true, renders the Sides editor as two stacked drop zones
   * — Included (always-free, backend side_type='and') and Choice (one-of,
   * side_type='or'). When false (default), legacy single drop zone + AND/OR
   * dropdown is rendered. Gates both the UI and the PATCH body shape:
   *   ON  → `{ sides_and, sides_or, recommendations }`
   *   OFF → `{ sides, sides_selection_mode, recommendations }` (legacy)
   * STR-342.
   */
  enableAndOrSplit?: boolean;
}

// ── Drag-enter counter ref (prevents flicker on child element crossings) ─────
// One ref per droppable zone; increment on enter, decrement on leave,
// treat as "over" only when counter > 0.

// ── Component ────────────────────────────────────────────────────────────────

export default function MenuManagerClient({ service, restaurantId, initialItems, initialMenus, onRefresh, refreshing = false, openItemId, onConfirmRecommendationDrop, onConfirmItemRemoval, enableAndOrSplit = false }: Props) {
  const trackAction = useTrackAction();
  const isMobile = useIsMobile();

  // Mobile drawer state — lifted from MobileMenuManagerLayout so the existing
  // handleDropBucket flow can close it automatically after a successful
  // pool→bucket drop. STR-251 round 2 mobile + camera.
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Drag-and-drop is intentionally DISABLED on mobile. The HTML5 native drag
  // events do not fire on touch devices and the polyfill we briefly tried
  // (mobile-drag-drop) was removed in favour of a tap-to-edit flow — see the
  // edit pencil button on MenuItemRow. Mobile users still get: ItemPool
  // drawer (read-only), tap-to-open EditModal from any menu item, photo
  // upload via the camera. STR-251 mobile + camera (2026-04-08).

  // Core data
  const [items, setItems] = useState<MenuItemDisplay[]>(initialItems);
  const [menus, setMenus] = useState<MenuSummary[]>(initialMenus);
  // Track when parent finishes a refresh so we can adopt the new data.
  // Without this, items added via external callbacks (e.g. recommendation
  // drop's addItemToMenu in the owner hook) never reach internal state
  // because useState ignores subsequent prop changes.
  const prevRefreshingRef = useRef(refreshing);
  useEffect(() => {
    if (prevRefreshingRef.current && !refreshing) {
      setItems(initialItems);
      setMenus(initialMenus);
    }
    prevRefreshingRef.current = refreshing;
  }, [refreshing, initialItems, initialMenus]);

  const [assignments, setAssignments] = useState<Record<string, Record<string, string[]>>>(() =>
    buildAssignments(initialItems, initialMenus),
  );
  const [junctionSettings, setJunctionSettings] = useState<Record<string, MenuItemJunctionSettings>>(
    () => buildJunctionSettings(initialItems),
  );

  // UI state
  const [activeMenuId, setActiveMenuId] = useState<string | null>(
    initialMenus.find((m) => m.active)?.id ?? initialMenus[0]?.id ?? null,
  );
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [visibilityFilter, setVisibilityFilter] = useState<'All' | 'Visible' | 'Hidden'>('All');
  const [itemTypeFilter, setItemTypeFilter] = useState<'dishes' | 'addons' | 'included'>('dishes');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editMenuId, setEditMenuId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null);
  const [bulkModifiersOpen, setBulkModifiersOpen] = useState(false);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dragOver, setDragOver] = useState<{ menuId: string; cat: string } | 'pool' | null>(null);
  const [scrollToItemId, setScrollToItemId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [addingMenu, setAddingMenu] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ message: string; onUndo: () => void } | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Resizable divider ─────────────────────────────────────────────────────
  const [poolWidth, setPoolWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('qrate-menu-pool-width');
      if (saved) return Math.min(Math.max(Number(saved), 200), 520);
    } catch {}
    return 272;
  });
  const [dividerActive, setDividerActive] = useState(false);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = poolWidth;
    setDividerActive(true);
    const onMouseMove = (mv: MouseEvent) => {
      const next = Math.min(Math.max(startWidth + mv.clientX - startX, 200), 520);
      setPoolWidth(next);
    };
    const onMouseUp = () => {
      setDividerActive(false);
      setPoolWidth(w => {
        try { localStorage.setItem('qrate-menu-pool-width', String(w)); } catch {}
        return w;
      });
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  // ─────────────────────────────────────────────────────────────────────────

  const poolDcRef = useRef(0); // drag-enter counter for the pool zone
  const bucketDcRef = useRef<Record<string, number>>({}); // per-bucket drag-enter counters
  // Tracks the ID of a brand-new item opened via "Add Item" — if the modal is
  // closed without saving, this item is rolled back (removed from state + deleted from backend).
  const newlyCreatedItemIdRef = useRef<string | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2400);
  }, []);

  // Undo toast — STR-251 #11. Optimistic remove + 5s window to revert.
  const showUndoToast = useCallback((message: string, onUndo: () => void) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ message, onUndo });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 5000);
  }, []);

  const dismissUndoToast = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast(null);
  }, []);

  const colorMap = useCallback((index: number): MenuColor => getMenuColor(index), []);

  const getSettings = useCallback(
    (menuId: string, itemId: string): MenuItemJunctionSettings =>
      junctionSettings[`${menuId}:${itemId}`] ?? {
        price: null,
        boost_level: null,
        chefs_special: false,
        portion_type: 'single',
        portion_serves: null,
        category_name: undefined,
      },
    [junctionSettings],
  );

  // Keep assignments + junctionSettings in sync when items/menus change.
  // junctionSettings uses a MERGE strategy — prev wins for existing keys so that
  // optimistic per-category updates (category_boost_levels, category_chefs_specials,
  // category_portions) survive any setItems call triggered by another item's API
  // response. The only exception is canonical_categories, which must reflect
  // drag-drop changes written back to items[].menu_associations.
  useEffect(() => {
    setAssignments(buildAssignments(items, menus));
    setJunctionSettings((prev) => {
      const fresh = buildJunctionSettings(items);
      const merged: Record<string, MenuItemJunctionSettings> = {};
      const allKeys = new Set([...Object.keys(fresh), ...Object.keys(prev)]);
      for (const key of allKeys) {
        const f = fresh[key];
        const p = prev[key];
        if (!f) {
          // Association removed from items — keep stale prev entry (won't be rendered)
          merged[key] = p;
        } else if (!p) {
          // New association (e.g. drag-drop just added item to menu) — use fresh
          merged[key] = f;
        } else {
          // Both exist: prev wins to preserve optimistic updates and per-category data
          // not yet backed by the backend. canonical_categories must come from fresh
          // so drag-drop category additions are reflected immediately.
          merged[key] = { ...p, canonical_categories: f.canonical_categories ?? p.canonical_categories ?? [] };
        }
      }
      return merged;
    });
  }, [items, menus]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Open edit modal for a specific item when navigated from another page (e.g. Patron Engagement)
  useEffect(() => {
    if (!openItemId || items.length === 0) return;
    setEditItemId(openItemId);
  }, [openItemId, items]);

  // ── Filtered item list for ItemPool ──────────────────────────────────────

  // Always expose all 8 canonical categories as filter options — owners should
  // always see the full canonical taxonomy, not just categories present in items.
  const canonicalCategories = useMemo(() => [...CANONICAL_CATEGORIES], []);

  const handleCollapseAll = (collapse: boolean) => {
    if (!activeMenuId) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const cat of CANONICAL_CATEGORIES) {
        next[`${activeMenuId}:${cat}`] = collapse;
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    // Filter by item type: addons, included, or dishes (dish + included).
    // 'included' items (e.g. naan, raita, sides) are orderable by patrons and belong
    // in the Dishes pool so canonical category filters (Soups, Breads, Sides) work.
    let result = itemTypeFilter === 'addons'
      ? items.filter((i) => i.item_type === 'addon')
      : itemTypeFilter === 'included'
      ? items.filter((i) => i.item_type === 'included')
      : items.filter((i) => i.item_type !== 'addon');
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) =>
        i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q),
      );
    }
    if (filterTags.length > 0) {
      // Prefer AI-pipeline canonical_category; fall back to raw→canonical mapping
      result = result.filter((i) => {
        const canon = i.canonical_category ?? toCanonical(i.category);
        return filterTags.some((tag) => canon === tag);
      });
    }
    if (visibilityFilter === 'Visible') result = result.filter((i) => i.active !== false);
    if (visibilityFilter === 'Hidden')  result = result.filter((i) => i.active === false);
    return result;
  }, [items, search, filterTags, visibilityFilter, itemTypeFilter]);

  // ── Select handlers ───────────────────────────────────────────────────────

  // Anchor used by shift+click range selection. Keyed by list ('pool' or
  // `${menuId}:${category}` for MenuBuilder rows). STR-251 #12.
  const selectionAnchorRef = useRef<{ list: string; itemId: string } | null>(null);

  // Modifier-aware click. Plain → reset to [id]; Shift → range from anchor;
  // Meta/Ctrl → toggle without resetting. STR-251 #12.
  const handleSelectClick = useCallback(
    (
      e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
      itemId: string,
      listKey: string,
      orderedIds: string[],
    ) => {
      trackAction(
        e.shiftKey ? 'menu.manager.selectRange' : 'menu.manager.selectItem',
        { restaurantId },
      );
      const anchor = selectionAnchorRef.current;
      if (e.shiftKey && anchor && anchor.list === listKey) {
        const fromIdx = orderedIds.indexOf(anchor.itemId);
        const toIdx = orderedIds.indexOf(itemId);
        if (fromIdx === -1 || toIdx === -1) {
          // Anchor item is no longer in this list — fall back to plain click
          setSelected(new Set([itemId]));
          selectionAnchorRef.current = { list: listKey, itemId };
          return;
        }
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        setSelected(new Set(orderedIds.slice(lo, hi + 1)));
        // Anchor stays put on shift-click (standard explorer behaviour)
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
          return next;
        });
        selectionAnchorRef.current = { list: listKey, itemId };
        return;
      }
      // Plain click — toggle item (checkbox behaviour). STR-268.
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
        return next;
      });
      selectionAnchorRef.current = { list: listKey, itemId };
    },
    [restaurantId, trackAction],
  );

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(filtered.map((i) => i.id)));
  }, [filtered]);

  const handleClearSelect = useCallback(() => {
    trackAction('menu.manager.clearSelect', { restaurantId });
    setSelected(new Set());
    selectionAnchorRef.current = null;
  }, [restaurantId, trackAction]);

  // Tracked filter setters — fire one metric per filter change.
  const handleCategoryFilterChange = useCallback(
    (tag: string) => {
      setFilterTags((prev) => {
        const next = tag === 'All' ? [] : prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag];
        trackAction('menu.manager.categoryFilter', { restaurantId, metadata: { tags: next } });
        return next;
      });
    },
    [restaurantId, trackAction],
  );

  const handleVisibilityFilterChange = useCallback(
    (value: 'All' | 'Visible' | 'Hidden') => {
      trackAction('menu.manager.visibilityFilter', {
        restaurantId,
        metadata: { value },
      });
      setVisibilityFilter(value);
    },
    [restaurantId, trackAction],
  );

  const handleItemTypeFilterChange = useCallback(
    (value: 'dishes' | 'addons' | 'included') => {
      trackAction('menu.manager.typeToggle', {
        restaurantId,
        metadata: { value },
      });
      setItemTypeFilter(value);
      setFilterTags([]);
      setSelected(new Set());
      selectionAnchorRef.current = null;
    },
    [restaurantId, trackAction],
  );

  const handleRefresh = useCallback(() => {
    trackAction('menu.manager.refresh', { restaurantId });
    onRefresh?.();
  }, [onRefresh, restaurantId, trackAction]);

  // ── Drag handlers (pool zone) ─────────────────────────────────────────────

  // STR-267: selection-aware drag. If the dragged item is in the selected
  // Set, drag all selected items (file-explorer convention). Otherwise,
  // drag only the single item without disturbing the selection.
  // Ref for the ephemeral drag ghost element — created on multi-select drag,
  // removed on drag end. Only shown when dragging 2+ items.
  const dragGhostRef = useRef<HTMLDivElement | null>(null);

  function attachMultiDragGhost(e: React.DragEvent, count: number) {
    if (count < 2) return;
    const ghost = document.createElement('div');
    ghost.textContent = `${count} selections`;
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      padding: '6px 14px',
      borderRadius: '8px',
      background: '#1e293b',
      color: '#fff',
      fontSize: '13px',
      fontWeight: '600',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: '9999',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    dragGhostRef.current = ghost;
  }

  function removeMultiDragGhost() {
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }
  }

  const handleDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    const ids = selected.has(itemId) ? [...selected] : [itemId];
    e.dataTransfer.setData('text/plain', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
    attachMultiDragGhost(e, ids.length);
    setDragging({ itemIds: ids, fromMenuId: null, fromCat: null });
  }, [selected]);

  const handleMenuItemDragStart = useCallback(
    (e: React.DragEvent, itemId: string, fromMenuId: string, fromCat: string) => {
      const ids = selected.has(itemId) ? [...selected] : [itemId];
      e.dataTransfer.setData('text/plain', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
      attachMultiDragGhost(e, ids.length);
      setDragging({ itemIds: ids, fromMenuId, fromCat });
    },
    [selected],
  );

  const handleDragEnd = useCallback(() => {
    removeMultiDragGhost();
    setDragging(null);
    setDragOver(null);
    poolDcRef.current = 0;
    bucketDcRef.current = {};
  }, []);

  const handleDragEnterPool = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    poolDcRef.current += 1;
    if (poolDcRef.current === 1) setDragOver('pool');
  }, []);

  const handleDragLeavePool = useCallback(() => {
    poolDcRef.current -= 1;
    if (poolDcRef.current === 0) setDragOver((prev) => (prev === 'pool' ? null : prev));
  }, []);

  // STR-267: multi-item pool drop (remove from menu)
  const handleDropPool = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      poolDcRef.current = 0;
      setDragOver(null);
      const snap = dragging;
      setDragging(null);

      // Only remove from menu if the items were dragged from a menu bucket
      if (!snap || snap.fromMenuId === null) return;
      const { itemIds, fromMenuId } = snap;

      const idsInMenu = itemIds.filter((id) => {
        const item = items.find((i) => i.id === id);
        return item?.menu_associations?.some((a) => a.menu_id === fromMenuId);
      });
      if (idsInMenu.length === 0) return;

      trackAction('menu.manager.dragToPool', {
        restaurantId,
        metadata: {
          itemCount: idsInMenu.length,
          fromMenuId,
          multiSelect: idsInMenu.length > 1,
        },
      });

      const idSet = new Set(idsInMenu);

      // Optimistic batch: remove menu association for all dragged items
      const prevItems = items;
      setItems((prev) =>
        prev.map((item) =>
          !idSet.has(item.id)
            ? item
            : {
                ...item,
                menu_associations: (item.menu_associations ?? []).filter(
                  (a) => a.menu_id !== fromMenuId,
                ),
              },
        ),
      );

      // Sequential API calls — best-effort, per-item rollback on failure
      let failed = 0;
      const processRemovals = async () => {
        for (const id of idsInMenu) {
          try {
            const associations = await service.removeItemFromMenu(id, fromMenuId);
            setItems((prev) =>
              prev.map((item) =>
                item.id !== id ? item : { ...item, menu_associations: associations },
              ),
            );
          } catch {
            failed++;
            // Rollback this single item
            const original = prevItems.find((i) => i.id === id);
            if (original) {
              setItems((prev) =>
                prev.map((item) => (item.id !== id ? item : original)),
              );
            }
          }
        }
        if (failed > 0) {
          showToast(`${idsInMenu.length - failed} removed, ${failed} failed`);
        } else {
          showToast(idsInMenu.length === 1 ? 'Removed from menu' : `Removed ${idsInMenu.length} items from menu`);
        }
        // Clear selection after multi-item drop
        if (idsInMenu.length > 1) setSelected(new Set());
      };
      processRemovals();
    },
    [dragging, items, restaurantId, showToast, trackAction],
  );

  // ── Bucket drag handlers ──────────────────────────────────────────────────

  const handleDragEnterBucket = useCallback((e: React.DragEvent, menuId: string, cat: string) => {
    e.preventDefault();
    const key = `${menuId}:${cat}`;
    bucketDcRef.current[key] = (bucketDcRef.current[key] ?? 0) + 1;
    if (bucketDcRef.current[key] === 1) setDragOver({ menuId, cat });
  }, []);

  const handleDragLeaveBucket = useCallback((menuId: string, cat: string) => {
    const key = `${menuId}:${cat}`;
    bucketDcRef.current[key] = Math.max(0, (bucketDcRef.current[key] ?? 1) - 1);
    if (bucketDcRef.current[key] === 0) {
      setDragOver((prev) =>
        prev !== null && prev !== 'pool' && prev.menuId === menuId && prev.cat === cat ? null : prev,
      );
    }
  }, []);

  // STR-267: multi-item bucket drop (add/move to menu)
  const handleDropBucket = useCallback(
    (e: React.DragEvent, menuId: string, cat: string) => {
      e.preventDefault();
      const key = `${menuId}:${cat}`;
      bucketDcRef.current[key] = 0;
      setDragOver(null);
      const snap = dragging;
      setDragging(null);

      if (!snap) return;
      const { itemIds, fromMenuId, fromCat } = snap;

      // Same menu, same bucket → no-op
      if (fromMenuId === menuId && fromCat === cat) return;

      const menu = menus.find((m) => m.id === menuId);
      if (!menu) {
        showToast('Menu not found — please refresh the page and try again');
        return;
      }

      // Resolve items to process — block add-on items from menu assignment
      const allResolved = itemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is MenuItemDisplay => i != null);
      if (allResolved.length === 0) return;

      const blockedAddons = allResolved.filter((i) => i.item_type === 'addon');
      if (blockedAddons.length > 0) {
        showToast(
          blockedAddons.length === 1
            ? `"${blockedAddons[0].name}" is an add-on — manage it in the item editor`
            : `${blockedAddons.length} add-on items can't be added to menus directly`,
        );
      }
      const toProcess = allResolved.filter((i) => i.item_type !== 'addon');
      if (toProcess.length === 0) return;

      trackAction('menu.manager.dragToMenu', {
        restaurantId,
        metadata: {
          itemCount: toProcess.length,
          fromMenuId,
          toMenuId: menuId,
          toCategory: cat,
          multiSelect: toProcess.length > 1,
        },
      });

      // Partition items by whether they are already associated with the
      // target menu. Items already in the menu need their canonical_categories
      // merged (Case A). Items not yet in the menu get a new association
      // (Case B). This partition is source-agnostic: a drag from the item
      // pool (fromMenuId === null) onto a second bucket correctly takes the
      // merge path if the item was previously assigned to the same menu.
      const alreadyInMenu = toProcess.filter((i) =>
        (i.menu_associations ?? []).some((a) => a.menu_id === menuId),
      );
      const notInMenu = toProcess.filter(
        (i) => !(i.menu_associations ?? []).some((a) => a.menu_id === menuId),
      );
      const alreadyInMenuIds = new Set(alreadyInMenu.map((i) => i.id));

      // ── Case A: items already in this menu — add to canonical_categories ──
      if (alreadyInMenu.length > 0) {
        const prevItems = items;
        setItems((prev) =>
          prev.map((i) => {
            if (!alreadyInMenuIds.has(i.id)) return i;
            return {
              ...i,
              menu_associations: (i.menu_associations ?? []).map((a) => {
                if (a.menu_id !== menuId) return a;
                const existing = a.canonical_categories ?? [];
                const updated = existing.includes(cat)
                  ? existing
                  : [...existing, cat];
                return { ...a, canonical_categories: updated };
              }),
            };
          }),
        );
        const processCategories = async () => {
          let failed = 0;
          for (const item of alreadyInMenu) {
            try {
              const assoc = item.menu_associations?.find((a) => a.menu_id === menuId);
              const existing = assoc?.canonical_categories ?? [];
              if (!existing.includes(cat)) {
                const updated = [...existing, cat];
                const associations = await service.updateMenuItemInMenu(item.id, menuId, { canonical_categories: updated });
                setItems((prev) =>
                  prev.map((i) => (i.id !== item.id ? i : { ...i, menu_associations: associations })),
                );
              }
            } catch {
              failed++;
              const original = prevItems.find((o) => o.id === item.id);
              if (original) setItems((prev) => prev.map((i) => (i.id !== item.id ? i : original)));
            }
          }
          if (failed > 0) {
            showToast(`${alreadyInMenu.length - failed} moved, ${failed} failed`);
          } else if (notInMenu.length === 0) {
            showToast(alreadyInMenu.length === 1 ? `Added to ${cat}` : `Added ${alreadyInMenu.length} items to ${cat}`);
          }
          if (toProcess.length > 1) setSelected(new Set());
        };
        processCategories();
      }

      // If there are no new items to assign, we're done.
      if (notInMenu.length === 0) return;

      // ── Case B: assigning to this menu (from pool or from a different menu) ─
      const prevItems = items;
      const initialCats = [cat];
      const notInMenuIds = new Set(notInMenu.map((i) => i.id));
      // Optimistic batch: add association for items not yet in the menu
      setItems((prev) =>
        prev.map((i) => {
          if (!notInMenuIds.has(i.id)) return i;
          const optimisticAssoc = {
            menu_id: menuId,
            menu_name: menu.name,
            price: i.price ?? null,
            category_name: cat,
            canonical_categories: initialCats,
            boost_level: null,
            chefs_special: false,
            portion_type: 'single' as const,
            portion_serves: null,
          };
          return {
            ...i,
            menu_associations: [
              ...(i.menu_associations ?? []).filter((a) => a.menu_id !== menuId),
              optimisticAssoc,
            ],
          };
        }),
      );
      // Auto-close mobile drawer once (pool → bucket only)
      if (fromMenuId === null) {
        setMobileDrawerOpen(false);
      }
      // Sequential API calls — best-effort, per-item rollback on failure
      const processAssigns = async () => {
        let failed = 0;
        for (const item of notInMenu) {
          try {
            const associations = await service.addItemToMenu(item.id, menuId, item.price ?? 0, cat, { canonical_categories: initialCats });
            setItems((prev) =>
              prev.map((i) => (i.id !== item.id ? i : { ...i, menu_associations: associations })),
            );
          } catch {
            failed++;
            // Rollback this single item
            const original = prevItems.find((o) => o.id === item.id);
            if (original) setItems((prev) => prev.map((i) => (i.id !== item.id ? i : original)));
          }
        }
        if (failed > 0) {
          showToast(`${notInMenu.length - failed} added, ${failed} failed`);
        } else {
          showToast(notInMenu.length === 1 ? `Added to ${menu.name}` : `Added ${notInMenu.length} items to ${menu.name}`);
        }
        // Clear selection after multi-item drop
        if (toProcess.length > 1) setSelected(new Set());
      };
      processAssigns();
    },
    [dragging, items, menus, restaurantId, showToast, trackAction],
  );

  // ── Update item modifiers (sides + recommendations) ─────────────────────────
  // Optimistically updates the parent item's modifiers and PUTs to the API.
  // Add-ons are managed per item in the Edit modal (Add-ons tab).
  //
  // Auto-add to menu: when a recommendation item is dropped that is NOT yet on
  // the active menu, automatically assign it to the menu under the parent
  // item's canonical category. This makes pool→recommendation drops seamless —
  // the item appears in the correct menu bucket and inherits the standard
  // "needs attention" red border if it has no price.
  const handleUpdateModifiers = useCallback(
    async (
      parentId: string,
      payload: ModifierUpdatePayload,
    ) => {
      const prevItems = items;

      // Map ModifierEntry[] addons back to AddonEntry[] by merging with the existing
      // entries on the item — this preserves id, status, and suggestion_source for
      // addons that were already saved, and stamps new drag-drop entries as manual/approved.
      let mergedAddons: AddonEntry[] | undefined;
      if (payload.addons !== undefined) {
        const currentItem = items.find((i) => i.id === parentId);
        const existingAddonMap = new Map<string, AddonEntry>(
          (currentItem?.addons ?? []).map((a) => [a.menu_item_id, a]),
        );
        mergedAddons = payload.addons.map((a) => {
          const existing = existingAddonMap.get(a.menu_item_id);
          if (existing) return existing;
          return {
            menu_item_id: a.menu_item_id,
            name: a.name,
            price_override: a.price_override ?? 0,
            thumbnail_url: a.thumbnail_url ?? null,
            status: 'approved' as const,
            suggestion_source: 'manual' as const,
          };
        });
      }

      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== parentId) return i;
          return {
            ...i,
            sides: payload.sides,
            recommendations: payload.recommendations.map((r) => ({
              ...r,
              price_override: r.price_override ?? 0,
            })),
            sides_selection_mode: payload.sides_selection_mode,
            // STR-342: when flag is ON, payload carries sides_and / sides_or.
            // Mirror them into local state so the UI reflects the pending save.
            ...(enableAndOrSplit
              ? {
                  sides_and: payload.sides_and ?? [],
                  sides_or: payload.sides_or ?? [],
                }
              : {}),
            ...(mergedAddons !== undefined ? { addons: mergedAddons } : {}),
          };
        }),
      );
      try {
        // STR-342: flag-gate the PATCH body. Backend rejects mixing legacy
        // `sides` with split `sides_and` / `sides_or` (400) — we only ever
        // send one shape.
        if (enableAndOrSplit) {
          await service.updateItemModifiers(parentId, {
            sides_and: payload.sides_and ?? [],
            sides_or: payload.sides_or ?? [],
            recommendations: payload.recommendations.map((r) => ({
              ...r,
              price_override: r.price_override ?? 0,
            })),
            ...(mergedAddons !== undefined ? { addons: mergedAddons } : {}),
          });
        } else {
          await service.updateItemModifiers(parentId, {
            sides: payload.sides,
            recommendations: payload.recommendations.map((r) => ({
              ...r,
              price_override: r.price_override ?? 0,
            })),
            sides_selection_mode: payload.sides_selection_mode,
            ...(mergedAddons !== undefined ? { addons: mergedAddons } : {}),
          });
        }
      } catch {
        setItems(prevItems);
        showToast('Failed to save modifiers — please try again');
        return; // Don't proceed to auto-add if modifier save failed
      }

      // ── Auto-add new recommendation items to the active menu ────────────
      if (!activeMenuId) return;

      const parent = items.find((i) => i.id === parentId);
      if (!parent) return;

      // Items already added to the menu by an external hook (e.g. the
      // category-selection modal). Skip these — a second addItemToMenu
      // would overwrite the user's canonical category selection.
      const hookHandled = new Set(payload._hookHandledItemIds ?? []);

      // Detect newly added recommendations (items in payload but not in current state)
      const currentRecIds = new Set(
        ((parent.recommendations ?? []) as Array<{ menu_item_id: string }>).map((r) => r.menu_item_id),
      );
      const newRecItems = payload.recommendations.filter(
        (r) => !currentRecIds.has(r.menu_item_id) && !hookHandled.has(r.menu_item_id),
      );
      if (newRecItems.length === 0) return;

      // Determine the parent's canonical category on the active menu
      const parentAssoc = parent.menu_associations?.find((a) => a.menu_id === activeMenuId);
      const parentCats = parentAssoc?.canonical_categories ?? [];
      const targetCat = parentCats[0] ?? 'Entrees';

      const activeMenu = menus.find((m) => m.id === activeMenuId);
      if (!activeMenu) return;

      // For each new recommendation, check if it's already on the active menu
      for (const rec of newRecItems) {
        const recItem = items.find((i) => i.id === rec.menu_item_id);
        if (!recItem) continue;

        const alreadyOnMenu = (recItem.menu_associations ?? []).some(
          (a) => a.menu_id === activeMenuId,
        );
        if (alreadyOnMenu) continue;

        // Auto-add to active menu under parent's canonical category
        const initialCats = [targetCat];
        const optimisticAssoc = {
          menu_id: activeMenuId,
          menu_name: activeMenu.name,
          price: recItem.price ?? null,
          category_name: targetCat,
          canonical_categories: initialCats,
          boost_level: null,
          chefs_special: false,
          portion_type: 'single' as const,
          portion_serves: null,
        };
        setItems((prev) =>
          prev.map((i) => {
            if (i.id !== recItem.id) return i;
            return {
              ...i,
              menu_associations: [
                ...(i.menu_associations ?? []).filter((a) => a.menu_id !== activeMenuId),
                optimisticAssoc,
              ],
            };
          }),
        );

        try {
          const associations = await service.addItemToMenu(
            recItem.id,
            activeMenuId,
            recItem.price ?? 0,
            targetCat,
            { canonical_categories: initialCats },
          );
          setItems((prev) =>
            prev.map((i) => (i.id !== recItem.id ? i : { ...i, menu_associations: associations })),
          );
        } catch {
          // Rollback optimistic add on failure
          setItems((prev) =>
            prev.map((i) => {
              if (i.id !== recItem.id) return i;
              return {
                ...i,
                menu_associations: (i.menu_associations ?? []).filter(
                  (a) => a.menu_id !== activeMenuId,
                ),
              };
            }),
          );
        }
      }

      if (newRecItems.length > 0) {
        const addedCount = newRecItems.length;
        const itemNames = newRecItems.map((r) => r.name).join(', ');
        showToast(
          addedCount === 1
            ? `"${itemNames}" auto-added to ${targetCat} in ${activeMenu.name}`
            : `${addedCount} items auto-added to ${targetCat} in ${activeMenu.name}`,
        );
      }
    },
    [items, menus, activeMenuId, showToast, service, enableAndOrSplit],
  );

  // ── Remove item from menu — STR-251 #11 ─────────────────────────────────
  const handleRemoveItemFromMenu = useCallback(
    async (itemId: string, menuId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      const assoc = item.menu_associations?.find((a) => a.menu_id === menuId);
      if (!assoc) return;
      const menu = menus.find((m) => m.id === menuId);
      const menuName = menu?.name ?? 'menu';

      // Step 9 (rec lifecycle PDD) preflight gate — if a consumer provides
      // onConfirmItemRemoval, ask it whether to proceed before any mutation
      // runs. Consumer is expected to fetch the recommendation-count and
      // show a deactivation-warning popup on "last occurrence" removals.
      // Presence in menu_associations = active placement (backend filters
      // inactive), so "last active" means there's only ONE entry.
      if (onConfirmItemRemoval) {
        const activeAssocs = item.menu_associations ?? [];
        const isLastActiveMenuPlacement = activeAssocs.length === 1 && activeAssocs[0].menu_id === menuId;
        const proceed = await onConfirmItemRemoval({ item, menuId, isLastActiveMenuPlacement });
        if (!proceed) return;
      }

      // Snapshot for undo
      const snapshot = {
        price: assoc.price,
        category_name: assoc.category_name ?? undefined,
      };

      // Optimistic removal
      const prevItems = items;
      setItems((prev) =>
        prev.map((i) =>
          i.id !== itemId
            ? i
            : {
                ...i,
                menu_associations: (i.menu_associations ?? []).filter((a) => a.menu_id !== menuId),
              },
        ),
      );

      service
        .removeItemFromMenu(itemId, menuId)
        .then((associations) => {
          setItems((prev) =>
            prev.map((i) => (i.id !== itemId ? i : { ...i, menu_associations: associations })),
          );
        })
        .catch((err) => {
          setItems(prevItems);
          dismissUndoToast();
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to remove — please try again';
          showToast(msg);
        });

      showUndoToast(`Removed from ${menuName}`, () => {
        // Re-add with the snapshot. The backend's ON CONFLICT upsert handles
        // the soft-delete reactivation cleanly.
        service
          .addItemToMenu(itemId, menuId, snapshot.price, snapshot.category_name)
          .then((associations) => {
            setItems((prev) =>
              prev.map((i) => (i.id !== itemId ? i : { ...i, menu_associations: associations })),
            );
            dismissUndoToast();
          })
          .catch(() => {
            showToast('Could not undo — please retry');
          });
      });
    },
    [items, menus, dismissUndoToast, showUndoToast, showToast, onConfirmItemRemoval],
  );

  // ── Settings update ───────────────────────────────────────────────────────

  const handleUpdateSettings = useCallback(
    async (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => {
      const key = `${menuId}:${itemId}`;
      const prev = junctionSettings[key] ?? {
        price: null,
        boost_level: null,
        chefs_special: false,
        portion_type: 'single' as const,
        portion_serves: null,
        category_name: undefined,
      };
      // Optimistic update
      setJunctionSettings((s) => ({ ...s, [key]: { ...prev, ...patch } }));
      try {
        const associations = await service.updateMenuItemInMenu(itemId, menuId, patch);
        // STR-262: Write server-returned associations back into items so the
        // useEffect rebuild (buildJunctionSettings) stays in sync. Without this,
        // any subsequent setItems call would overwrite the optimistic junction
        // settings with stale data from items[].menu_associations.
        if (Array.isArray(associations)) {
          setItems((prev) =>
            prev.map((i) => (i.id !== itemId ? i : { ...i, menu_associations: associations })),
          );
        }
      } catch {
        // Rollback
        setJunctionSettings((s) => ({ ...s, [key]: prev }));
        showToast('Failed to save — please try again');
      }
    },
    [junctionSettings, showToast],
  );

  // ── Add item ──────────────────────────────────────────────────────────────

  // Deferred-creation: open the modal with a local-only draft item. The DB row is
  // only written when the user clicks Save (via handleSaveNewItem → onSaveNewItem).
  // This eliminates orphaned "New item" rows that previously appeared when the modal
  // was dismissed or the fire-and-forget delete failed.
  const handleAddItem = useCallback(() => {
    const tempId = `__draft__${Date.now()}`;
    const draft: MenuItemDisplay = {
      id: tempId,
      name: 'New item',
      description: null,
      price: null,
      category: '',
      food_tags: {},
      thumbnail_url: null,
      gallery_urls: [],
      active: true,
      menu_associations: [],
    };
    setItems((prev) => [draft, ...prev]);
    newlyCreatedItemIdRef.current = tempId;
    setEditItemId(tempId);
    trackAction('menu.manager.addNewItem', { restaurantId });
  }, [restaurantId, trackAction]);

  // Called from EditModal (via onSaveNewItem) when the user saves a new item.
  // Creates the DB row with the completed form data.
  const handleSaveNewItem = useCallback(
    async (data: {
      name: string;
      description: string;
      category: string;
      food_tags: FoodTags;
      item_type: 'dish' | 'addon';
      price?: number | null;
    }) => {
      const created = await service.addMenuItem(restaurantId, {
        name: data.name,
        description: data.description,
        price: data.price ?? undefined,
        category: data.category,
      });
      // If the user chose addon type, set it in a follow-up update
      // (add_owner_menu_item defaults to 'dish').
      if (data.item_type === 'addon') {
        const updated = await service.updateMenuItem(created.id, { item_type: 'addon' });
        return { ...created, ...updated, item_type: 'addon' as const };
      }
      return { ...created, food_tags: data.food_tags };
    },
    [restaurantId, service],
  );

  // ── Edit complete ─────────────────────────────────────────────────────────

  const handleEditComplete = useCallback(
    (updated: MenuItemDisplay & { _deleted?: boolean }) => {
      // Capture the draft ID before clearing — needed to locate the draft entry
      // in state when the saved item comes back with a different (real server) ID.
      const draftId = newlyCreatedItemIdRef.current;
      newlyCreatedItemIdRef.current = null;

      if (updated._deleted) {
        setItems((prev) => prev.filter((i) => i.id !== updated.id && i.id !== draftId));
        showToast('Item deleted');
      } else {
        if (draftId?.startsWith('__draft__')) {
          // Replace the local draft entry (temp ID) with the saved item (real server ID).
          setItems((prev) => prev.map((i) => (i.id === draftId ? updated : i)));
        } else {
          setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        }
        showToast('Item saved');
      }
      setEditItemId(null);
    },
    [showToast],
  );

  // ── Dish-addon association changed from EditModal ────────────────────────
  // Fired when the user adds/removes dishes on an addon's "Dishes" tab.
  // The mutation already hit the backend via updateItemModifiers(dishId, ...);
  // we reflect it in local state so the association is visible both on reopen
  // of the addon modal AND when later editing the dish directly.
  const handleDishAddonsChanged = useCallback((dishId: string, nextAddons: AddonEntry[]) => {
    setItems((prev) => prev.map((i) => (i.id === dishId ? { ...i, addons: nextAddons } : i)));
  }, []);

  // Close handler — rolls back brand-new unsaved items
  const handleCloseEditModal = useCallback(() => {
    const newId = newlyCreatedItemIdRef.current;
    if (newId) {
      setItems((prev) => prev.filter((i) => i.id !== newId));
      newlyCreatedItemIdRef.current = null;
      if (!newId.startsWith('__draft__')) {
        // Real DB row (legacy path, should not be reached with deferred creation).
        // Keep the delete as a safety net for any transition period.
        void service.deleteMenuItem(newId).catch(() => {});
      }
      // Draft items are local-only — no backend call needed.
    }
    setEditItemId(null);
  }, [service]);

  // ── Navigate from EditModal to a menu tab + scroll to item ───────────────

  const handleNavigateToMenu = useCallback((menuId: string, itemId: string) => {
    setEditItemId(null);
    setActiveMenuId(menuId);
    setScrollToItemId(itemId);
  }, []);

  // ── Bulk complete ─────────────────────────────────────────────────────────

  const handleBulkComplete = useCallback(
    (updatedItems: MenuItemDisplay[], clearedIds: Set<string>) => {
      setItems(updatedItems);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of clearedIds) next.delete(id);
        return next;
      });
      setBulkMode(null);
      showToast('Bulk action applied');
    },
    [showToast],
  );

  // ── Bulk modifier assign complete ─────────────────────────────────────────
  const handleBulkModifiersComplete = useCallback(
    (updatedItems: MenuItemDisplay[]) => {
      const updatedIds = new Set(updatedItems.map((u) => u.id));
      setItems((prev) =>
        prev
          .filter((i) => updatedIds.has(i.id))
          .map((i) => {
            const updated = updatedItems.find((u) => u.id === i.id);
            return updated ?? i;
          }),
      );
      setBulkModifiersOpen(false);
      setSelected(new Set());
      showToast('Done');
    },
    [showToast],
  );

  // ── Menu CRUD ─────────────────────────────────────────────────────────────

  const handleCreateMenu = useCallback(
    async (name: string) => {
      const start = Date.now();
      try {
        const created = await service.createMenu(restaurantId, { name });
        setMenus((prev) => [...prev, created]);
        setActiveMenuId(created.id);
        trackAction('menu.manager.createMenu', {
          restaurantId,
          success: true,
          durationMs: Date.now() - start,
        });
      } catch (err) {
        trackAction('menu.manager.createMenu', {
          restaurantId,
          success: false,
          durationMs: Date.now() - start,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    [restaurantId, service, trackAction],
  );

  const handleUpdateMenu = useCallback((updated: MenuSummary) => {
    setMenus((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditMenuId(null);
    showToast('Menu saved');
  }, [showToast]);

  const handleDeleteMenu = useCallback(
    (menuId: string) => {
      setMenus((prev) => {
        const next = prev.filter((m) => m.id !== menuId);
        setActiveMenuId(next.find((m) => m.active)?.id ?? next[0]?.id ?? null);
        return next;
      });
      setEditMenuId(null);
      showToast('Menu deleted');
    },
    [showToast],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <MenuManagerServiceProvider value={service}>
    <div className="flex flex-col fixed-height-page-shell" data-testid="menu-manager">
      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg"
          data-testid="menu-manager-toast"
        >
          {toast}
        </div>
      )}

      {/* Undo toast — STR-251 #11 */}
      {undoToast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-3"
          data-testid="menu-manager-undo-toast"
        >
          <span>{undoToast.message}</span>
          <button
            type="button"
            onClick={() => undoToast.onUndo()}
            data-testid="menu-manager-undo-btn"
            className="text-blue-300 font-semibold uppercase text-xs tracking-wide hover:text-blue-200"
          >
            Undo
          </button>
        </div>
      )}

      {/* Edit Item Modal */}
      {editItemId && (() => {
        const editItem = items.find((i) => i.id === editItemId);
        return editItem ? (
          <EditModal
            item={editItem}
            restaurantId={restaurantId}
            menus={menus}
            allItems={items.filter((i) => i.item_type !== 'addon')}
            onClose={handleCloseEditModal}
            onComplete={handleEditComplete}
            onNavigateToMenu={handleNavigateToMenu}
            onDishAddonsChange={handleDishAddonsChanged}
            isNewItem={newlyCreatedItemIdRef.current === editItemId}
            onSaveNewItem={handleSaveNewItem}
          />
        ) : null;
      })()}

      {/* Menu Edit Panel */}
      {editMenuId && (() => {
        const editMenu = menus.find((m) => m.id === editMenuId);
        return editMenu ? (
          <MenuEditPanel
            menu={editMenu}
            allMenus={menus}
            restaurantId={restaurantId}
            onClose={() => setEditMenuId(null)}
            onUpdate={handleUpdateMenu}
            onDelete={handleDeleteMenu}
          />
        ) : null;
      })()}

      {/* Bulk Actions Panel */}
      {bulkMode && selected.size > 0 && (
        <BulkActionsPanel
          selected={selected}
          items={items}
          menus={menus}
          initialMode={bulkMode}
          onClose={() => setBulkMode(null)}
          onComplete={handleBulkComplete}
        />
      )}

      {/* Bulk Modifier Panel — assign addons to dishes */}
      {bulkModifiersOpen && selected.size > 0 && (
        <BulkModifierPanel
          restaurantId={restaurantId}
          selectedAddons={items.filter((i) => selected.has(i.id))}
          dishItems={items}
          onClose={() => setBulkModifiersOpen(false)}
          onComplete={handleBulkModifiersComplete}
        />
      )}

      {/* Mobile branch — STR-251 mobile + camera (2026-04-08).
          Same handlers, same state, just a different shell. Desktop branch
          below remains byte-for-byte identical to the historical layout. */}
      {isMobile ? (
        <MobileMenuManagerLayout
          itemsCount={items.length}
          drawerOpen={mobileDrawerOpen}
          onDrawerOpenChange={setMobileDrawerOpen}
          itemPoolProps={{
            items,
            menus,
            filtered,
            selected,
            search,
            filterTags,
            canonicalCategories,
            dragOver: dragOver === 'pool' ? 'pool' : null,
            dragging,
            editItemId,
            onSearchChange: setSearch,
            onFilterChange: handleCategoryFilterChange,
            visibilityFilter,
            onVisibilityFilterChange: handleVisibilityFilterChange,
            itemTypeFilter,
            onItemTypeFilterChange: handleItemTypeFilterChange,
            onSelectClick: handleSelectClick,
            onSelectAll: handleSelectAll,
            onClearSelect: handleClearSelect,
            onEditItem: setEditItemId,
            onAddItem: handleAddItem,
            onOpenBulk: (mode) => setBulkMode(mode),
            onOpenBulkModifiers: () => setBulkModifiersOpen(true),
            onDragStart: handleDragStart,
            onDragEnd: handleDragEnd,
            onDragEnterPool: handleDragEnterPool,
            onDragLeavePool: handleDragLeavePool,
            onDropPool: handleDropPool,
            colorMap,
          }}
          menuBuilderProps={{
            items,
            menus,
            assignments,
            junctionSettings,
            activeMenuId,
            collapsed,
            dragging,
            dragOver,
            colorMap,
            getSettings,
            onTabChange: setActiveMenuId,
            onToggleCollapse: (key) =>
              setCollapsed((prev) => ({ ...prev, [key]: !prev[key] })),
            onCollapseAll: handleCollapseAll,
            onUpdateSettings: handleUpdateSettings,
            onDragStart: handleMenuItemDragStart,
            onDragEnd: handleDragEnd,
            onDragEnterBucket: handleDragEnterBucket,
            onDragLeaveBucket: (menuId, cat) => handleDragLeaveBucket(menuId, cat),
            onDropBucket: handleDropBucket,
            onCreateMenu: handleCreateMenu,
            onEditMenu: setEditMenuId,
            onRemoveItemFromMenu: handleRemoveItemFromMenu,
            onEditItem: setEditItemId,
            onUpdateModifiers: handleUpdateModifiers,
            scrollToItemId,
            onScrollComplete: () => setScrollToItemId(null),
          }}
        />
      ) : (
        /* Two-panel layout — desktop with resizable divider */
        <div
          style={{
            display: 'flex',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* Left panel — ItemPool (resizable) */}
          <div style={{ width: poolWidth, flexShrink: 0, minHeight: 0 }}>
          <ItemPool
            items={items}
            menus={menus}
            filtered={filtered}
            selected={selected}
            search={search}
            filterTags={filterTags}
            canonicalCategories={canonicalCategories}
            dragOver={dragOver === 'pool' ? 'pool' : null}
            dragging={dragging}
            editItemId={editItemId}
            onSearchChange={setSearch}
            onFilterChange={handleCategoryFilterChange}
            visibilityFilter={visibilityFilter}
            onVisibilityFilterChange={handleVisibilityFilterChange}
            itemTypeFilter={itemTypeFilter}
            onItemTypeFilterChange={handleItemTypeFilterChange}
            onSelectClick={handleSelectClick}
            onSelectAll={handleSelectAll}
            onClearSelect={handleClearSelect}
            onEditItem={setEditItemId}
            onAddItem={handleAddItem}
            onOpenBulk={(mode) => setBulkMode(mode)}
            onOpenBulkModifiers={() => setBulkModifiersOpen(true)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragEnterPool={handleDragEnterPool}
            onDragLeavePool={handleDragLeavePool}
            onDropPool={handleDropPool}
            colorMap={colorMap}
          />
          </div>

          {/* Draggable divider */}
          <div
            onMouseDown={handleDividerMouseDown}
            title="Drag to resize panels"
            style={{
              width: 12,
              flexShrink: 0,
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              zIndex: 10,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                transition: 'background 120ms',
                background: dividerActive ? 'rgba(255, 107, 43, 0.1)' : 'transparent',
              }}
            />
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    background: dividerActive ? '#FF6B2B' : 'var(--border, #e2e8f0)',
                    transition: 'background 120ms',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Right panel — MenuBuilder (flex fills remaining space) */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <MenuBuilder
            items={items}
            menus={menus}
            assignments={assignments}
            junctionSettings={junctionSettings}
            activeMenuId={activeMenuId}
            collapsed={collapsed}
            dragging={dragging}
            dragOver={dragOver}
            colorMap={colorMap}
            getSettings={getSettings}
            onTabChange={setActiveMenuId}
            onToggleCollapse={(key) =>
              setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
            }
            onCollapseAll={handleCollapseAll}
            onUpdateSettings={handleUpdateSettings}
            onDragStart={handleMenuItemDragStart}
            onDragEnd={handleDragEnd}
            onDragEnterBucket={handleDragEnterBucket}
            onDragLeaveBucket={(menuId, cat) => handleDragLeaveBucket(menuId, cat)}
            onDropBucket={handleDropBucket}
            onCreateMenu={handleCreateMenu}
            onEditMenu={setEditMenuId}
            onRemoveItemFromMenu={handleRemoveItemFromMenu}
            onEditItem={setEditItemId}
            onUpdateModifiers={handleUpdateModifiers}
            onConfirmRecommendationDrop={onConfirmRecommendationDrop}
            scrollToItemId={scrollToItemId}
            onScrollComplete={() => setScrollToItemId(null)}
            onRefresh={onRefresh ? handleRefresh : undefined}
            refreshing={refreshing}
            enableAndOrSplit={enableAndOrSplit}
            onCrossGroupDuplicate={(group) =>
              showToast(
                `Already in ${group === 'included' ? 'Includes All' : 'Includes one by choice'} — remove first`,
              )
            }
          />
          </div>
        </div>
      )}
    </div>
    </MenuManagerServiceProvider>
  );
}

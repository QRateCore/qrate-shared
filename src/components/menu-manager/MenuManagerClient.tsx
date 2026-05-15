'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRangeSelection } from '../../hooks/useRangeSelection';
import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings, AddonEntry, FoodTags } from '../../types/restaurant';
import {
  buildAssignments,
  buildJunctionSettings,
  getMenuColor,
  CANONICAL_CATEGORIES,
  toCanonical,
  type MenuColor,
} from './lib/menuUtils';
import { mergePendingWriteItems } from './lib/mergePendingWriteItems';
import ItemPool from './components/ItemPool';
import MenuBuilder, { type ModifierUpdatePayload, itemHasAttention } from './components/MenuBuilder';
import MobileMenuManagerLayout from './components/MobileMenuManagerLayout';
import BulkActionsPanel from './components/BulkActionsPanel';
import BulkModifierPanel from './components/BulkModifierPanel';
import EditModal, { type DietaryTagService } from './components/EditModal';
import MenuEditPanel from './components/MenuEditPanel';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { MenuManagerService } from '../../types/restaurant';
import { MenuManagerServiceProvider } from './context';
import { useTrackAction } from './track-action-context';

// ── Types ────────────────────────────────────────────────────────────────────

export type BulkMode = 'assign' | 'remove' | 'boost' | 'special' | 'availability' | 'delete' | 'spice' | 'sweetness' | 'dietary' | 'spiceModifier';

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
  /** Optional: pre-select this menu tab on mount (e.g. navigated from a menu chip on the food-item profile). */
  initialMenuId?: string | null;
  /** Optional: scroll to + expand this item on mount without opening the modal. Useful for "where is this item?" navigation from the food-item profile. */
  initialScrollToItemId?: string | null;
  /** When true, render the menu-stats banner above the page. Shows the
   *  count of crawler-discovered menus and a per-active-menu "items missing
   *  price" filter pill. Default false so other consumers (e.g.
   *  qrate-waiter-webapp) don't get the owner-only banner. */
  showMenuStatsBanner?: boolean;
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
   * BYO PDD Step 7b — bundle of optional callbacks for BYO authoring.
   * When provided, MenuBuilder forwards them to ItemModifierZones, which
   * renders [+ Add grouping], [⋮] menu, rule pill, and inline rename.
   */
  byoHandlers?: import('./components/ItemModifierZones').BYOHandlers;
  /** When false, the per-item Add-ons drop zone is hidden in the menu builder. Default true. */
  showAddons?: boolean;
  /** When false, the per-item Recommendations drop zone is hidden in the menu builder. Default true. */
  showRecommendations?: boolean;
  /** When false, the per-item [+ Add grouping] button is hidden in the menu builder. Default true. */
  showAddGrouping?: boolean;
  /** When false, the Visible / Hidden toggle is hidden in the ItemPool filter row. Default true. */
  showVisibilityFilter?: boolean;
  /** When provided, allergens and dietary restrictions in EditModal use the dietary-tags API. */
  dietaryTagService?: DietaryTagService;
  /** Optional: bulk spice level update for the Spice tab in BulkActionsPanel. */
  onBulkSpice?: (heatLabel: string, itemIds: string[]) => Promise<void>;
  /** Optional: bulk dietary/allergen tag add for the Dietary tab in BulkActionsPanel. */
  onBulkDietary?: (tags: Array<{ name: string; type: 'allergen' | 'dietary' }>, itemIds: string[]) => Promise<void>;
  /** Optional: bulk sweetness update for the Sweetness tab in BulkActionsPanel. */
  onBulkSweetness?: (label: string, itemIds: string[]) => Promise<void>;
  /** Optional: called when the owner changes the sweetness label on a Desserts item in EditModal. */
  onSweetnessUpdate?: (itemId: string, label: string | null) => Promise<void>;
  /** Optional: called when the owner changes the heat/spice label in EditModal. */
  onHeatSpiceUpdate?: (itemId: string, label: string | null) => Promise<void>;
  /** Per-restaurant spice scale labels forwarded to BulkActionsPanel and EditModal. */
  heatLabels?: string[];
  /** Per-restaurant sweetness scale labels forwarded to BulkActionsPanel and EditModal. */
  sweetnessLabels?: string[];
  /** Optional render-prop slot forwarded to EditModal — see EditModal.imageLibrarySlot. */
  imageLibrarySlot?: (handlers: {
    itemId: string;
    itemName: string;
    onPicked: (thumbnailUrl: string) => void;
  }) => ReactNode;
  /**
   * Optional render-prop slot for the EditModal "Groupings" tab. When
   * provided AND the slot returns a non-null node, the tab renders.
   * Mirrors the Food Items Library drawer (FoodItemsManagerClient) so
   * the two entry points to the same EditModal look identical.
   *
   * The slot can return `undefined` to suppress the tab for a specific
   * item (e.g. drafts that haven't been saved yet, or item_type='addon').
   */
  groupingsSlot?: (handlers: {
    item: MenuItemDisplay;
    isNewItem: boolean;
    /**
     * PDD 2026-05-15 — the currently-active menu in the MenuManager
     * sidebar, or null if the slot is rendered outside a menu context
     * (e.g. the Food Library item drawer). When non-null, the slot's
     * `GroupingsSection` (or equivalent) can render the per-menu
     * Includes/Choose-One override affordances.
     */
    currentMenu: { id: string; name: string } | null;
  }) => ReactNode;
  /**
   * When true, the EditModal opens inside the same right-side drawer chrome
   * the Food Item Library uses (`food-library-drawer-overlay` +
   * `food-library-drawer` from owner-webapp globals). EditModal renders in
   * `displayMode="inline"` and fills the drawer body. Default false preserves
   * the historical centered-modal behavior for consumers (waiter-webapp) that
   * do not ship the drawer CSS.
   */
  editItemDrawerMode?: boolean;
}

// ── Drag-enter counter ref (prevents flicker on child element crossings) ─────
// One ref per droppable zone; increment on enter, decrement on leave,
// treat as "over" only when counter > 0.

// ── Component ────────────────────────────────────────────────────────────────

export default function MenuManagerClient({ service, restaurantId, initialItems, initialMenus, onRefresh, refreshing = false, openItemId, initialMenuId, initialScrollToItemId, showMenuStatsBanner = false, onConfirmRecommendationDrop, onConfirmItemRemoval, byoHandlers, showAddons = true, showRecommendations = true, showAddGrouping = true, showVisibilityFilter = true, dietaryTagService, onBulkSpice, onBulkDietary, onBulkSweetness, onSweetnessUpdate, onHeatSpiceUpdate, heatLabels, sweetnessLabels, imageLibrarySlot, groupingsSlot, editItemDrawerMode = false }: Props) {
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
  // STR-409: items with an in-flight server write (PUT/POST). The refresh-edge
  // useEffect below preserves the optimistic state of any item still in this
  // set. STR-398 closed the immediate race for handleUpdateModifiers; this
  // ref is a defense-in-depth backstop for every other optimistic-write path.
  // Each write site adds the item id before its `await service.<X>()` call
  // and deletes it in `finally` (covers both success and rollback).
  // Out of scope (different semantics): handleSaveNewItem (id unknown at PUT
  // init), handleCloseEditModal soft-delete (we WANT the deletion preserved
  // on race), and bulk paths (writes happen inside child components).
  //
  // Same-id concurrent-write caveat: a Set ignores duplicate adds. If two
  // sites are ever wired to track the SAME itemId concurrently (e.g. a future
  // optimistic-write surface that overlaps with handleUpdateSettings), the
  // first site's `finally` will delete the id while the second is still in
  // flight, and a refresh-edge in the remaining window will clobber the
  // second's optimistic state. The 7 sites instrumented in STR-409 are
  // mutually exclusive at the user-action level (different drag/edit/menu
  // surfaces), so this is currently academic. If a new same-id site is added,
  // upgrade this to `Map<string, number>` (refcount) — increment on add,
  // decrement on settle, treat any non-zero count as pending. STR-411 P3
  // follow-up tracks this.
  const pendingWriteItemIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (prevRefreshingRef.current && !refreshing) {
      // STR-409: merge the server snapshot with local optimistic state for
      // any item whose write is still in flight. Pure logic lives in
      // `mergePendingWriteItems` for direct unit testing.
      setItems((prev) => mergePendingWriteItems(initialItems, prev, pendingWriteItemIdsRef.current));
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
  const [activeMenuId, setActiveMenuId] = useState<string | null>(() => {
    // Pre-selected menu tab from URL beats the default-active fallback. Only
    // honoured when the supplied id matches one of this restaurant's menus —
    // a stale id from another restaurant would otherwise leave the page tab-
    // less.
    if (initialMenuId && initialMenus.some((m) => m.id === initialMenuId)) {
      return initialMenuId;
    }
    return initialMenus.find((m) => m.active)?.id ?? initialMenus[0]?.id ?? null;
  });
  const [visibilityFilter, setVisibilityFilter] = useState<'All' | 'Visible' | 'Hidden'>('All');
  const [itemTypeFilter, setItemTypeFilter] = useState<'dishes' | 'addons' | 'included'>('dishes');
  const [search, setSearch] = useState('');
  const {
    selected,
    setSelected,
    handleSelectClick: _rangeSelectClick,
    clearSelection: _clearSelection,
    selectAll: _selectAll,
  } = useRangeSelection();
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editMenuId, setEditMenuId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null);
  const [bulkModifiersOpen, setBulkModifiersOpen] = useState(false);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dragOver, setDragOver] = useState<{ menuId: string; cat: string } | 'pool' | null>(null);
  const [scrollToItemId, setScrollToItemId] = useState<string | null>(initialScrollToItemId ?? null);
  // Banner-driven filter — pulls every category bucket down to only the
  // items missing a price within the active menu. Shared across menu tabs
  // so flipping it on then switching tabs surfaces the same problem set.
  const [missingPriceFilter, setMissingPriceFilter] = useState(false);
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

  // Scroll-to-item navigation — used by the "Appears in" menu chips on the
  // food-item profile drawer. The MenuBuilder scroll effect queries the DOM
  // for [data-item-row-id]; that element only renders when the item's
  // canonical category bucket is expanded. Uncollapse every bucket the item
  // belongs to within the active menu so the row is in the DOM before the
  // 150ms scroll timer fires. Runs once when items hydrate so a deep-link
  // landing on a still-loading page doesn't miss the item.
  useEffect(() => {
    if (!initialScrollToItemId || items.length === 0 || !activeMenuId) return;
    const item = items.find((i) => i.id === initialScrollToItemId);
    if (!item) return;
    const assoc = item.menu_associations?.find((a) => a.menu_id === activeMenuId);
    const cats = assoc?.canonical_categories ?? [];
    if (cats.length === 0) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const cat of cats) {
        next[`${activeMenuId}:${cat}`] = false;
      }
      return next;
    });
    // Re-arm the scroll trigger after the buckets uncollapse so the
    // MenuBuilder effect runs against rendered rows.
    setScrollToItemId(initialScrollToItemId);
  }, [initialScrollToItemId, items, activeMenuId]);

  // Auto-expand every category bucket in the active menu while the
  // missing-price filter is on. The filter is the owner's "show me what
  // needs a price" affordance — leaving any bucket collapsed would hide
  // matching rows behind a chevron and defeat the point. Re-runs on tab
  // switch so flipping menus while the filter is on keeps every bucket
  // open. Turning the filter off does NOT auto-collapse — the owner can
  // tidy up manually.
  useEffect(() => {
    if (!missingPriceFilter || !activeMenuId) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const cat of CANONICAL_CATEGORIES) {
        next[`${activeMenuId}:${cat}`] = false;
      }
      return next;
    });
  }, [missingPriceFilter, activeMenuId]);

  // ── Filtered item list for ItemPool ──────────────────────────────────────

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
    // The menu manager pool surfaces dishes alongside any items that have
    // been flipped to item_type='included' by the sides flow — owners need
    // to see them in the pool to drag/edit/move them. Addons remain the
    // only excluded type (their UI lives on the Food Items page).
    let result = items.filter((i) => i.item_type !== 'addon');
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) =>
        i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q),
      );
    }
    if (visibilityFilter === 'Visible') result = result.filter((i) => i.active !== false);
    if (visibilityFilter === 'Hidden')  result = result.filter((i) => i.active === false);
    return result;
  }, [items, search, visibilityFilter]);

  // Stats banner — count menus the crawler discovered (source_url present)
  // and the per-active-menu missing-price item count. Only consumed when
  // showMenuStatsBanner is true, but the memo runs unconditionally so the
  // dep arrays are stable across re-renders.
  const crawlerMenuCount = useMemo(
    () => menus.filter((m) => !!m.source_url).length,
    [menus],
  );
  const missingPriceCountForActiveMenu = useMemo(() => {
    if (!activeMenuId) return 0;
    const menuAssign = assignments[activeMenuId] ?? {};
    const itemIdsInMenu = new Set<string>();
    for (const cat of Object.keys(menuAssign)) {
      for (const id of menuAssign[cat] ?? []) itemIdsInMenu.add(id);
    }
    let n = 0;
    for (const id of itemIdsInMenu) {
      const item = items.find((i) => i.id === id);
      if (!item) continue;
      if (itemHasAttention(item, getSettings(activeMenuId, id))) n++;
    }
    return n;
  }, [activeMenuId, assignments, items, getSettings]);

  // ── Select handlers ───────────────────────────────────────────────────────

  // Modifier-aware click. Delegates range/toggle logic to useRangeSelection;
  // adds trackAction instrumentation on top. STR-251 #12.
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
      _rangeSelectClick(e, itemId, orderedIds, listKey);
    },
    [restaurantId, trackAction, _rangeSelectClick],
  );

  const handleSelectAll = useCallback(() => {
    _selectAll(filtered.map((i) => i.id));
  }, [filtered, _selectAll]);

  const handleClearSelect = useCallback(() => {
    trackAction('menu.manager.clearSelect', { restaurantId });
    _clearSelection();
  }, [restaurantId, trackAction, _clearSelection]);

  const handleSelectCategoryItems = useCallback((ids: string[], selectAll: boolean) => {
    setSelected((prev: Set<string>) => {
      const next = new Set(prev);
      if (selectAll) {
        ids.forEach((id) => next.add(id));
      } else {
        ids.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, []);

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
      _clearSelection();
    },
    [restaurantId, trackAction, _clearSelection],
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

      // STR-409: track every id as in-flight up-front so a refresh-edge
      // mid-loop preserves later items' optimistic state until their PUT runs.
      for (const id of idsInMenu) pendingWriteItemIdsRef.current.add(id);

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
          } finally {
            pendingWriteItemIdsRef.current.delete(id);
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
        // STR-409: track all merge-candidate ids up-front so a refresh-edge
        // mid-loop preserves later items' optimistic canonical_categories.
        for (const item of alreadyInMenu) pendingWriteItemIdsRef.current.add(item.id);
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
            } finally {
              pendingWriteItemIdsRef.current.delete(item.id);
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
      // STR-409: track all assign-candidate ids up-front so a refresh-edge
      // mid-loop preserves later items' optimistic association.
      for (const item of notInMenu) pendingWriteItemIdsRef.current.add(item.id);
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
          } finally {
            pendingWriteItemIdsRef.current.delete(item.id);
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
            recommendations: payload.recommendations.map((r) => ({
              ...r,
              price_override: r.price_override ?? 0,
            })),
            ...(mergedAddons !== undefined ? { addons: mergedAddons } : {}),
          };
        }),
      );
      // STR-409: track parent as in-flight so a refresh-edge mid-PUT does
      // not clobber the optimistic recs/addons state above. `finally` runs
      // even when the catch block returns early.
      pendingWriteItemIdsRef.current.add(parentId);
      try {
        // Sides authoring was removed from this code path in 2026-05 —
        // only recommendations + addons flow through here now.
        await service.updateItemModifiers(parentId, {
          recommendations: payload.recommendations.map((r) => ({
            ...r,
            price_override: r.price_override ?? 0,
          })),
          ...(mergedAddons !== undefined ? { addons: mergedAddons } : {}),
        });
      } catch {
        setItems(prevItems);
        showToast('Failed to save modifiers — please try again');
        return; // Don't proceed to auto-add if modifier save failed
      } finally {
        pendingWriteItemIdsRef.current.delete(parentId);
      }

      // Note: the item_type='included' sync that used to live here is gone
      // along with the sides drop zones — only recommendations + addons can
      // mutate from this handler now, and neither flips item_type. If a
      // future surface re-adds sides authoring it should re-introduce the
      // sync (or migrate it onto the groupings backend write path).

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
      if (newRecItems.length === 0) {
        // STR-398: hook-handled drop with no other new recs — refresh now to
        // pull fresh menu_associations + the just-PUT recommendation in one
        // coherent snapshot. Doing this earlier (in the hook's onSuccess)
        // raced the PUT and clobbered the optimistic recommendation insert.
        if (hookHandled.size > 0) onRefresh?.();
        return;
      }

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

        // STR-409: track per-iteration auto-add as in-flight so a
        // refresh-edge mid-loop preserves this rec's optimistic association.
        pendingWriteItemIdsRef.current.add(recItem.id);
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
        } finally {
          pendingWriteItemIdsRef.current.delete(recItem.id);
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

      // STR-398: hook-handled drop where auto-add also ran — refresh now
      // (after both PUT and auto-add POSTs settled) so the page snapshot
      // includes the new recommendation, the new menu placement of the
      // hook-added item, and any auto-add side effects.
      if (hookHandled.size > 0) onRefresh?.();
    },
    [items, menus, activeMenuId, showToast, service, onRefresh],
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

      // STR-409: track removal as in-flight so a refresh-edge mid-DELETE
      // does not re-merge the just-removed association from initialItems.
      pendingWriteItemIdsRef.current.add(itemId);
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
        })
        .finally(() => {
          pendingWriteItemIdsRef.current.delete(itemId);
        });

      showUndoToast(`Removed from ${menuName}`, () => {
        // STR-409: track undo's add as in-flight independently of the
        // removal — by the time undo runs, the removal has already settled
        // (so its pending entry is gone). The undo's own add/rollback is a
        // fresh write-window that needs its own pending entry.
        pendingWriteItemIdsRef.current.add(itemId);
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
          })
          .finally(() => {
            pendingWriteItemIdsRef.current.delete(itemId);
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
      // STR-409: track this PATCH as in-flight so a refresh-edge mid-call
      // does not clobber the optimistic junction settings via items[]
      // adoption. `finally` runs on both success and rollback paths.
      pendingWriteItemIdsRef.current.add(itemId);
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
      } finally {
        pendingWriteItemIdsRef.current.delete(itemId);
      }
    },
    [junctionSettings, showToast],
  );

  // Add-item from the menu page is gone — new dishes are authored solely
  // on /owner/food-items. The handleSaveNewItem path below remains because
  // the EditModal can still surface a Save flow for items that were drafted
  // elsewhere and routed into the menu page via openItemId.

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
      setSelected((prev: Set<string>) => {
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

  const handleCloneMenu = useCallback(
    async (sourceMenuId: string, name: string) => {
      const start = Date.now();
      try {
        if (!service.cloneMenu) {
          throw new Error('cloneMenu is not implemented by this service');
        }
        const cloned = await service.cloneMenu(restaurantId, sourceMenuId, { name });
        setMenus((prev) => [...prev, cloned]);
        setActiveMenuId(cloned.id);
        trackAction('menu.manager.cloneMenu', {
          restaurantId,
          success: true,
          durationMs: Date.now() - start,
          metadata: { sourceMenuId, clonedMenuId: cloned.id },
        });
        showToast('Menu cloned (inactive — toggle live in menu settings)');
        if (onRefresh) onRefresh();
      } catch (err) {
        trackAction('menu.manager.cloneMenu', {
          restaurantId,
          success: false,
          durationMs: Date.now() - start,
          errorMessage: err instanceof Error ? err.message : String(err),
          metadata: { sourceMenuId },
        });
        throw err;
      }
    },
    [restaurantId, service, trackAction, showToast, onRefresh],
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
    <div className="flex flex-col fixed-height-page-shell tight-page-top" data-testid="menu-manager">
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

      {/* Menu stats banner — owner /owner/menu only.
          Mirrors the dark-gradient stat banner on the food-items page so the
          two pages feel like a pair. The "items missing price" pill is the
          actionable affordance: click to filter every category bucket down
          to just those items in the active menu. */}
      {showMenuStatsBanner && (menus.length > 0) && (
        <div
          data-testid="menu-stats-banner"
          style={{
            margin: '0 14px',
            padding: '14px 18px',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #2a1f3d 100%)',
            borderRadius: 14,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            position: 'relative',
            overflow: 'hidden',
            flexWrap: 'wrap',
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: -40,
              right: -20,
              width: 160,
              height: 160,
              borderRadius: 999,
              background: 'radial-gradient(circle, rgba(255,140,66,.3), transparent 60%)',
            }}
          />
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'var(--brand-gradient, linear-gradient(135deg,#ff8c42,#ff6b2b))',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              position: 'relative',
              fontSize: 18,
            }}
          >
            🍽
          </div>
          <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {crawlerMenuCount === 0
                ? 'No crawler-discovered menus yet — add menus manually to get started'
                : `${crawlerMenuCount} ${crawlerMenuCount === 1 ? 'menu' : 'menus'} discovered from your website`}
              {missingPriceCountForActiveMenu > 0 && (
                <span style={{ color: 'rgba(255,255,255,.7)', fontWeight: 500 }}>
                  {' '}· Some items in this menu need a price
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <BannerFilterPill
                label="Missing a price"
                count={missingPriceCountForActiveMenu}
                active={missingPriceFilter}
                disabled={missingPriceCountForActiveMenu === 0 && !missingPriceFilter}
                onClick={() => setMissingPriceFilter((p) => !p)}
                testId="menu-banner-filter-missing-price"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit Item Modal — opens centered (legacy) or inside the right-side
          drawer chrome that mirrors /owner/food-items when editItemDrawerMode
          is on. The drawer path uses the same `food-library-drawer*` classes
          (defined in owner-webapp globals.css) and EditModal `displayMode=inline`. */}
      {editItemId && (() => {
        const editItem = items.find((i) => i.id === editItemId);
        if (!editItem) return null;
        const editModal = (
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
            dietaryTagService={dietaryTagService}
            heatLabels={heatLabels}
            sweetnessLabels={sweetnessLabels}
            onSweetnessUpdate={onSweetnessUpdate}
            onHeatSpiceUpdate={onHeatSpiceUpdate}
            imageLibrarySlot={imageLibrarySlot}
            groupingsSlot={
              groupingsSlot
                ? groupingsSlot({
                    item: editItem,
                    isNewItem: newlyCreatedItemIdRef.current === editItemId,
                    currentMenu: (() => {
                      if (!activeMenuId) return null;
                      const m = menus.find((mm) => mm.id === activeMenuId);
                      return m ? { id: m.id, name: m.name } : null;
                    })(),
                  })
                : undefined
            }
            displayMode={editItemDrawerMode ? 'inline' : 'modal'}
          />
        );
        if (!editItemDrawerMode) return editModal;
        return (
          <>
            <div
              className="food-library-drawer-overlay"
              data-testid="food-item-edit-drawer-overlay"
              onClick={handleCloseEditModal}
              aria-hidden
            />
            <div
              className="food-library-drawer"
              data-testid="food-item-edit-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={editItem.name || 'Edit item'}
              onKeyDown={(e) => { if (e.key === 'Escape') handleCloseEditModal(); }}
            >
              <div data-testid="food-item-profile" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {editModal}
              </div>
            </div>
          </>
        );
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
          {...{
            selected,
            items,
            menus,
            initialMode: bulkMode,
            onClose: () => setBulkMode(null),
            onComplete: handleBulkComplete,
            onBulkSpice,
            onBulkDietary,
            onBulkSweetness,
            heatLabels,
            sweetnessLabels,
          }}
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
            dragOver: dragOver === 'pool' ? 'pool' : null,
            dragging,
            editItemId,
            onSearchChange: setSearch,
            visibilityFilter,
            onVisibilityFilterChange: handleVisibilityFilterChange,
            itemTypeFilter,
            onItemTypeFilterChange: handleItemTypeFilterChange,
            onSelectClick: handleSelectClick,
            onSelectAll: handleSelectAll,
            onClearSelect: handleClearSelect,
            onSelectCategoryItems: handleSelectCategoryItems,
            onEditItem: setEditItemId,
            onOpenBulk: (mode) => setBulkMode(mode),
            onOpenBulkModifiers: () => setBulkModifiersOpen(true),
            onDragStart: handleDragStart,
            onDragEnd: handleDragEnd,
            onDragEnterPool: handleDragEnterPool,
            onDragLeavePool: handleDragLeavePool,
            onDropPool: handleDropPool,
            colorMap,
            showVisibilityFilter,
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
              setCollapsed((prev) => ({ ...prev, [key]: !(prev[key] ?? true) })),
            onCollapseAll: handleCollapseAll,
            onUpdateSettings: handleUpdateSettings,
            onDragStart: handleMenuItemDragStart,
            onDragEnd: handleDragEnd,
            onDragEnterBucket: handleDragEnterBucket,
            onDragLeaveBucket: (menuId, cat) => handleDragLeaveBucket(menuId, cat),
            onDropBucket: handleDropBucket,
            onCreateMenu: handleCreateMenu,
            onCloneMenu: handleCloneMenu,
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
            dragOver={dragOver === 'pool' ? 'pool' : null}
            dragging={dragging}
            editItemId={editItemId}
            onSearchChange={setSearch}
            visibilityFilter={visibilityFilter}
            onVisibilityFilterChange={handleVisibilityFilterChange}
            itemTypeFilter={itemTypeFilter}
            onItemTypeFilterChange={handleItemTypeFilterChange}
            onSelectClick={handleSelectClick}
            onSelectAll={handleSelectAll}
            onClearSelect={handleClearSelect}
            onSelectCategoryItems={handleSelectCategoryItems}
            onEditItem={setEditItemId}
            onOpenBulk={(mode) => setBulkMode(mode)}
            onOpenBulkModifiers={() => setBulkModifiersOpen(true)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragEnterPool={handleDragEnterPool}
            onDragLeavePool={handleDragLeavePool}
            onDropPool={handleDropPool}
            colorMap={colorMap}
            showVisibilityFilter={showVisibilityFilter}
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
              setCollapsed((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }))
            }
            onCollapseAll={handleCollapseAll}
            onUpdateSettings={handleUpdateSettings}
            onDragStart={handleMenuItemDragStart}
            onDragEnd={handleDragEnd}
            onDragEnterBucket={handleDragEnterBucket}
            onDragLeaveBucket={(menuId, cat) => handleDragLeaveBucket(menuId, cat)}
            onDropBucket={handleDropBucket}
            onCreateMenu={handleCreateMenu}
            onCloneMenu={handleCloneMenu}
            onEditMenu={setEditMenuId}
            onRemoveItemFromMenu={handleRemoveItemFromMenu}
            onEditItem={setEditItemId}
            onUpdateModifiers={handleUpdateModifiers}
            onConfirmRecommendationDrop={onConfirmRecommendationDrop}
            scrollToItemId={scrollToItemId}
            onScrollComplete={() => setScrollToItemId(null)}
            onRefresh={onRefresh ? handleRefresh : undefined}
            refreshing={refreshing}
            byoHandlers={byoHandlers}
            showAddons={showAddons}
            showRecommendations={showRecommendations}
            showAddGrouping={showAddGrouping}
            missingPriceFilter={missingPriceFilter}
          />
          </div>
        </div>
      )}
    </div>
    </MenuManagerServiceProvider>
  );
}

interface BannerFilterPillProps {
  label: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}

function BannerFilterPill({ label, count, active, disabled = false, onClick, testId }: BannerFilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: active ? '#fff' : 'rgba(255,255,255,.12)',
        color: active ? '#1a1a2e' : 'rgba(255,255,255,.92)',
        border: '1px solid rgba(255,255,255,.18)',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        fontFamily: 'inherit',
        transition: 'background .15s, color .15s',
      }}
    >
      {label}
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          padding: '1px 7px',
          borderRadius: 999,
          background: active ? '#1a1a2e' : 'rgba(255,255,255,.16)',
          color: active ? '#fff' : 'rgba(255,255,255,.92)',
        }}
      >
        {count}
      </span>
    </button>
  );
}

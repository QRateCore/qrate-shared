'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRangeSelection } from '../../hooks/useRangeSelection';
import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings, AddonEntry, FoodTags, RawCategorySummary, ServingOption, MenuStructure, MenuSubcategory } from '../../types/restaurant';
import { isSubcategoryV2Enabled } from '../../constants/feature-flags';
import {
  buildAssignments,
  buildJunctionSettings,
  getMenuColor,
  CANONICAL_CATEGORIES,
  toCanonical,
  UNGROUPED_KEY,
  sectionForCanonical,
  dedupeRawCategoryLabels,
  isDrinkItem,
  resolveMoveCanonicals,
  sortedSubCategoryLabels,
  orderSubcategoryLabels,
  buildReorderedSubcategoryIds,
  normalizeSubcatKey,
  type MenuColor,
} from './lib/menuUtils';
import { mergePendingWriteItems } from './lib/mergePendingWriteItems';
import ItemPool from './components/ItemPool';
import MenuBuilder, { type ModifierUpdatePayload, itemHasAttention } from './components/MenuBuilder';
import { filterItemsByText } from './filterItemsByText';
import MenuTabBar, { getMenuTabStatus } from './components/MenuTabBar';
import { CloneMenuModal } from './components/CloneMenuModal';
import { ItemPlacementModal } from './components/ItemPlacementModal';
import MobileMenuManagerLayout from './components/MobileMenuManagerLayout';
import BulkActionsPanel from './components/BulkActionsPanel';
import BulkMenuSidesPanel from './components/BulkMenuSidesPanel';
import BulkModifierPanel from './components/BulkModifierPanel';
import EditModal, { type DietaryTagService } from './components/EditModal';
import MenuEditPanel from './components/MenuEditPanel';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { MenuManagerService } from '../../types/restaurant';
import { MenuManagerServiceProvider } from './context';
import { useTrackAction } from './track-action-context';

// ── Types ────────────────────────────────────────────────────────────────────

export type BulkMode = 'assign' | 'remove' | 'removeFromMenu' | 'boost' | 'special' | 'availability' | 'delete' | 'spice' | 'sweetness' | 'dietary' | 'spiceModifier' | 'enrich' | 'grouping' | 'removeGrouping' | 'rawCategory' | 'serving';

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
  /** Restaurant-wide count of items appearing on 2+ active menus with
   *  per-menu attribute diffs. When > 0 (and showMenuStatsBanner is true)
   *  renders an "Overlap · N" pill next to the missing-price pill. The
   *  count comes from a consumer-owned hook (owner-app's useOverlapSummary)
   *  so this shared component stays auth-/transport-agnostic. */
  overlapTotal?: number;
  /** Click handler for the Overlap pill. Consumer typically opens its own
   *  OverlapModal in response. Required only when overlapTotal > 0. */
  onOverlapPillClick?: () => void;
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
   * Click handler for the per-row "Bring into Menu" button on the
   * Inactive Recs popover (PDD 2026-05-27). When wired (owner-webapp
   * only), the MenuBuilder's recommendations grouping renders as two
   * chips — Active and Inactive — and clicking a member's button opens
   * the canonical-category picker. The handler typically forwards to
   * the same useCategoryPromptForRecommendationDrop hook the drag flow
   * uses, with the rec target as the dropped item and `ownerMenuId` as
   * the destination menu (the row's menu — passed through unchanged).
   *
   * When omitted (waiter / admin), the split chips still render (they
   * just classify by schedule), but the action button is suppressed.
   */
  onBringIntoMenu?: (memberId: string, ownerMenuId: string) => void;
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
  /** When false, the per-item Add-ons drop zone is hidden in the mobile menu builder. Default true. */
  showAddons?: boolean;
  /** When false, the per-item Recommendations drop zone is hidden in the mobile menu builder. Default true. */
  showRecommendations?: boolean;
  /** When false, the per-item [+ Add grouping] button is hidden in the mobile menu builder. Default true. */
  showAddGrouping?: boolean;
  /**
   * PDD 2026-05-15 v2 — per-menu Includes/Choose-One sides adapter
   * forwarded to MenuBuilder → desktop ItemModifierZones. The two
   * drop zones in the expanded dish row use this to GET/PUT per-menu
   * sides via the owner API. Omitted = no per-menu sides UI
   * (e.g. waiter-webapp consumers without the routes deployed).
   */
  perMenuSides?: import('./components/ItemModifierZones').PerMenuSidesAdapter;
  /**
   * Off-menu drop gate for Includes (sides_and) / Choose-One (sides_or)
   * zones. PDD 2026-05-20 v2 — when the dropped item is not on the
   * current menu, the consumer pops the same category-selection modal
   * it uses for recommendation drops. Returns `true` to proceed,
   * `false` to skip. See ItemModifierZones for the full contract.
   */
  onConfirmIncludeDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /** When false, the Visible / Hidden toggle is hidden in the ItemPool filter row. Default true. */
  showVisibilityFilter?: boolean;
  /** When provided, allergens and dietary restrictions in EditModal use the dietary-tags API. */
  dietaryTagService?: DietaryTagService;
  /** Per-restaurant custom allergens / dietary + their effective canonical
   *  defaults (canonical minus hidden). Forwarded verbatim to EditModal so the
   *  allergen/dietary pill picker matches the Food Items page exactly — without
   *  these, the Menu Builder drawer shows only the hardcoded canonical lists
   *  (no custom entries like "Jain", and hidden defaults like kosher/halal
   *  still appear). Consumer loads these from /customization/{allergens,dietary}. */
  customAllergens?: string[];
  customDietary?: string[];
  allergenDefaults?: string[];
  dietaryDefaults?: string[];
  /** Optional: bulk spice level update for the Spice tab in BulkActionsPanel. */
  onBulkSpice?: (heatLabel: string, itemIds: string[]) => Promise<void>;
  /** Optional: bulk dietary/allergen tag add for the Dietary tab in BulkActionsPanel. */
  onBulkDietary?: (tags: Array<{ name: string; type: 'allergen' | 'dietary' }>, itemIds: string[]) => Promise<void>;
  /** Optional: bulk sweetness update for the Sweetness tab in BulkActionsPanel. */
  onBulkSweetness?: (label: string, itemIds: string[]) => Promise<void>;
  /** Optional: bulk wine serving sizes (PDD 2026-06-15) for the Serving sizes tab. */
  onBulkServingSizes?: (servingOptions: ServingOption[], itemIds: string[]) => Promise<void>;
  /**
   * Admin-only: bulk AI enrich for the Enrich tab in BulkActionsPanel.
   * When provided, the panel surfaces an Enrich mode. Consumer is
   * responsible for chunking >100 items (admin-webapp's
   * restaurantService.enrichMenuItemsBatch handles this internally).
   */
  onBulkEnrich?: (itemIds: string[]) => Promise<{ enriched: number; skipped: number; failed: number }>;
  /**
   * PDD 2026-05-21 — apply one custom grouping spec to N selected parents.
   * Wired by owner-webapp from the Food Item Library page; admin/waiter
   * don't pass it so the Grouping tab stays hidden. Must throw — the
   * shared panel discriminates on `error.name === 'BulkApplyGroupingConflictError'`
   * to surface the conflict banner.
   */
  onBulkApplyGrouping?: (
    itemIds: string[],
    body: {
      name: string;
      rule: { min_select: number; max_select: number | null; default_select: 'all' | 'none' | 'first' };
      members: Array<{ item_id: string; position?: number }>;
    },
  ) => Promise<void>;
  /**
   * PDD 2026-05-21 sibling — bulk REMOVE one grouping spec from N parents.
   * Throw-only contract: 409 PARTIAL_MISMATCH surfaces via an error whose
   * `.name === 'BulkRemoveGroupingMismatchError'` with a `.mismatches`
   * array. Requires `loadGroupingsForItem` to also be passed (the panel
   * uses it for client-side discovery of shared groupings).
   */
  onBulkRemoveGrouping?: (
    itemIds: string[],
    body: {
      name: string;
      rule: { min_select: number; max_select: number | null; default_select: 'all' | 'none' | 'first' };
      member_ids: string[];
    },
  ) => Promise<void>;
  /**
   * PDD 2026-05-21 sibling — discovery loader used by the Remove grouping
   * tab. Owner-webapp wires this to `ownerGroupingsService.listGroupings`.
   * Required (along with `onBulkRemoveGrouping`) for the tab to surface.
   * Also reused by the PDD 2026-05-22 add-to-existing mode.
   */
  loadGroupingsForItem?: (itemId: string) => Promise<Array<{
    id: string;
    name: string;
    is_default: boolean;
    min_select: number;
    max_select: number | null;
    default_select: 'all' | 'none' | 'first';
    items?: Array<{ menu_item_id: string }>;
  }>>;
  /**
   * PDD 2026-05-22 — bulk-add members to a shared grouping. When wired,
   * the BulkActionsPanel Grouping tab surfaces a mode selector at the top:
   * "Add to existing" vs "Create new". Owner-webapp wires this to
   * `ownerGroupingsService.bulkAddMembersToGrouping`.
   */
  onBulkAddMembersToGrouping?: (
    itemIds: string[],
    body: {
      name: string;
      rule: { min_select: number; max_select: number | null; default_select: 'all' | 'none' | 'first' };
      current_member_ids: string[];
    },
    newMemberIds: string[],
  ) => Promise<void>;
  /**
   * PDD 2026-05-22 — Menu Builder bulk Includes/Choose-One.
   * Opt-in trio: when all three are wired, the MenuBuilder surfaces a
   * checkbox column + bulk-action button on the active menu, and the
   * drawer (BulkMenuSidesPanel) hooks into these adapters on Apply.
   */
  onBulkAddSidesToMenuItems?: (
    menuId: string,
    itemIds: string[],
    body: { side_type: 'and' | 'or'; side_ids: string[] },
  ) => Promise<{
    updated: Array<{
      menu_item_menu_id: string;
      food_item_id: string;
      food_item_name: string;
      sides_added: number;
      sides_skipped: number;
    }>;
  }>;
  onBulkRemoveSidesFromMenuItems?: (
    menuId: string,
    itemIds: string[],
    body: { side_type: 'and' | 'or'; side_ids: string[] },
  ) => Promise<{
    updated: Array<{
      menu_item_menu_id: string;
      food_item_id: string;
      food_item_name: string;
      sides_removed: number;
      sides_skipped: number;
    }>;
  }>;
  /** Discovery loader for the Remove-Includes tab — fans out per parent. */
  loadPerMenuSides?: (
    menuId: string,
    itemId: string,
  ) => Promise<{
    sides_and: Array<{ id: string; name: string }>;
    sides_or: Array<{ id: string; name: string }>;
  }>;
  /**
   * PDD 2026-05-22 amendment 3 — invoked when a menu-tab change clears
   * the bulk selection while the drawer was open. Consumer wires this
   * to their toast infra (owner-webapp uses sonner). Shared stays
   * toast-agnostic — peer deps are React + lucide-react only.
   */
  onBulkSelectionClearedByTabChange?: () => void;
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
  /**
   * Admin-only: shows the Dish / Add-ons filter toggle in the items pool.
   * Retired from the default pool — see ItemPool.tsx showItemTypeFilter.
   * Default: false.
   */
  showItemTypeFilter?: boolean;
  /**
   * When true, the left item pool groups by RAW sub-category label
   * (item.category — Food Items rail parity) instead of the 4 canonical course
   * sections. Forwarded to ItemPool. Owner menu page opts in. Default: false.
   */
  poolGroupByRawCategory?: boolean;
  /**
   * Admin-only: enables the "Enrich with AI" button in EditModal's action
   * bar. Owner-webapp + waiter-webapp don't pass this — they get the
   * default (button hidden). Admin-webapp wires it to the recommender's
   * /enrich endpoint. See EditModal.onEnrichItem for the contract.
   */
  onEnrichItem?: (itemId: string) => Promise<{
    food_tags?: MenuItemDisplay['food_tags'];
    enrichment_status?: string;
    food_tags_source?: string;
    skipped_reason?: string;
  }>;
  /**
   * Optional duplicate-item action. When provided, EditModal renders a
   * Duplicate button that opens a clone draft of the current item. The
   * draft is rendered as a second EditModal in cloneMode — owner only
   * has to rename the dish (must differ from source AND must not contain
   * "Copy" case-insensitive) and click Save Copy. The new item is created
   * server-side via POST /owner/menu/items/{sourceId}/clone (which
   * deep-copies food_tags, dietary, spice, menu placements, sides,
   * addons, and groupings in one transaction).
   *
   * Consumer wires this to the typed client method that hits the clone
   * endpoint; resolved shape mirrors the backend response.
   */
  cloneMenuItem?: (sourceId: string, name: string) => Promise<{
    id: string;
    name: string;
    restaurant_id: string;
    item_type?: string;
    source_id?: string;
  }>;
  /**
   * Free-text filter for the chosen menu's rows (the right Menu Builder panel),
   * driven by the app-shell search on the owner Menu page (2026-07-05).
   * Forwarded to MenuBuilder. Optional + defaults to no filtering so
   * waiter/admin consumers are unaffected. Independent of the left item-pool
   * "Search items…" box, which keeps its own `search` state.
   */
  builderSearchQuery?: string;
}

// ── Drag-enter counter ref (prevents flicker on child element crossings) ─────
// One ref per droppable zone; increment on enter, decrement on leave,
// treat as "over" only when counter > 0.

/**
 * Refcount-backed pending-write tracker (STR-409 / STR-411 follow-up).
 * A plain Set breaks when two writes target the SAME itemId concurrently — the
 * first finally() removes the id while the second is still in flight, and a
 * refresh-edge then clobbers the second's optimistic state. Step 8 adds exactly
 * such a same-id surface (label chip writes overlap with handleUpdateSettings),
 * so we count concurrent writes and only treat an id as settled at count 0.
 * Exposes add/delete/has so existing call sites (and mergePendingWriteItems,
 * which only reads .has) are unchanged.
 */
function makeRefCountSet() {
  const counts = new Map<string, number>();
  return {
    add(id: string) { counts.set(id, (counts.get(id) ?? 0) + 1); },
    delete(id: string) {
      const n = (counts.get(id) ?? 0) - 1;
      if (n <= 0) counts.delete(id); else counts.set(id, n);
    },
    has(id: string) { return counts.has(id); },
    get size() { return counts.size; },
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MenuManagerClient({ service, restaurantId, initialItems, initialMenus, onRefresh, refreshing = false, openItemId, initialMenuId, initialScrollToItemId, showMenuStatsBanner = false, overlapTotal = 0, onOverlapPillClick, onConfirmRecommendationDrop, onBringIntoMenu, onConfirmItemRemoval, byoHandlers, showAddons = true, showRecommendations = true, showAddGrouping = true, perMenuSides, onConfirmIncludeDrop, showVisibilityFilter = true, dietaryTagService, customAllergens, customDietary, allergenDefaults, dietaryDefaults, onBulkSpice, onBulkDietary, onBulkSweetness, onBulkServingSizes, onBulkEnrich, onBulkApplyGrouping, onBulkRemoveGrouping, loadGroupingsForItem, onBulkAddMembersToGrouping, onBulkAddSidesToMenuItems, onBulkRemoveSidesFromMenuItems, loadPerMenuSides, onBulkSelectionClearedByTabChange, onSweetnessUpdate, onHeatSpiceUpdate, heatLabels, sweetnessLabels, imageLibrarySlot, groupingsSlot, editItemDrawerMode = false, showItemTypeFilter = false, onEnrichItem, cloneMenuItem, builderSearchQuery, poolGroupByRawCategory = false }: Props) {
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
  const pendingWriteItemIdsRef = useRef(makeRefCountSet());
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

  // ── First-class sub-category structure (PDD 2026-06-19 Phase 3) ────────────
  // When the flag is ON, the builder's grouped view is the SINGLE source from
  // GET /owner/menus/{menuId}/structure (course → sub-categories → item ids) —
  // not menu_item_menus.raw_categories[]. We keep a per-menu cache of the loaded
  // structure and PROJECT it into the existing `assignments` + `raw_categories`
  // shapes the renderer already consumes, so the entire render path (MenuBuilder
  // / CategoryBucket / SubCategoryGroup) is untouched. When OFF, none of this
  // runs and the legacy path is byte-for-byte preserved.
  const subcatV2 = isSubcategoryV2Enabled()
    && !!service.getMenuStructure
    && !!service.assignItemToSubcategory;
  const [structureByMenu, setStructureByMenu] = useState<Record<string, MenuStructure>>({});
  // Bumped after every structure write so the loader re-fetches the active menu.
  const [structureRefreshKey, setStructureRefreshKey] = useState(0);

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
  // STR-858 wall-clock-live default (MOBILE only) — the initializer picks the
  // first ENABLED menu, but on a phone mid-service the owner expects to open on
  // the menu being SERVED right now. Once (post-hydration, when isMobile
  // resolves true) and only if the owner didn't deep-link a menu, switch to the
  // menu whose schedule is live at the current wall-clock time. Client-only
  // effect → SSR-safe (no hydration mismatch from new Date()); mobile-only →
  // desktop + E2E (desktop width) behaviour unchanged. Guarded once so it never
  // fights a manual switch. See [[reference_ssr_ismobile_usestate_default_race]].
  const liveDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (liveDefaultAppliedRef.current) return;
    if (!isMobile) return;
    if (initialMenuId && initialMenus.some((m) => m.id === initialMenuId)) {
      liveDefaultAppliedRef.current = true;
      return;
    }
    liveDefaultAppliedRef.current = true;
    const liveNow = menus.find((m) => m.active !== false && getMenuTabStatus(m, new Date()) === 'active');
    if (liveNow && liveNow.id !== activeMenuId) setActiveMenuId(liveNow.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
  // PDD 2026-05-22 — Menu Builder bulk selection state. Per-active-menu —
  // switching menu tabs clears it (amendment 3). Only surfaces when the
  // consumer wires the bulk-sides adapters.
  const bulkSidesEnabled =
    !!onBulkAddSidesToMenuItems
    && !!onBulkRemoveSidesFromMenuItems
    && !!loadPerMenuSides;
  const [bulkMenuSelection, setBulkMenuSelection] = useState<Set<string>>(new Set());
  const [bulkMenuSidesOpen, setBulkMenuSidesOpen] = useState(false);
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
  // Clone-draft source — when set, the second EditModal below renders in
  // cloneMode pre-seeded with this item's fields. Set by EditModal's
  // Duplicate button (closes the current edit modal first), cleared on
  // close or after a successful Save Copy.
  const [cloneDraftSource, setCloneDraftSource] = useState<MenuItemDisplay | null>(null);
  const [editMenuId, setEditMenuId] = useState<string | null>(null);
  // CloneMenuModal lives at this level (was inside MenuBuilder) so the open
  // trigger from MenuTabBar (which spans both panels) can drive it directly.
  const [cloneOpen, setCloneOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<BulkMode | null>(null);
  const [bulkModifiersOpen, setBulkModifiersOpen] = useState(false);
  const [dragging, setDragging] = useState<DragState | null>(null);
  // `label` distinguishes a sub-category drop zone from the canonical bucket's
  // general area (menu raw sub-categories, 2026-06-09). Absent = bucket hover.
  const [dragOver, setDragOver] = useState<{ menuId: string; cat: string; label?: string } | 'pool' | null>(null);
  // 7b — general-area drop → pick/create popup. Holds the pending drop; the
  // modal's confirm applies the chosen label via applyRawCategoryMove.
  const [subCatPrompt, setSubCatPrompt] = useState<{
    menuId: string;
    cat: string;
    toProcess: MenuItemDisplay[];
    /** Existing sub-categories already under this course (deduped). */
    labels: RawCategorySummary[];
    /** Most-common raw category across the dropped selection — seeds the
     *  popup's create field / matches an existing sub-category. */
    defaultLabel: string;
    /** Human label for the dragged selection (item name or "N items"). */
    selectionLabel: string;
    /** Source course the drag started from (null for a pool drag). When set and
     *  ≠ the target course, the apply MOVES (drops the source canonical) — #6a. */
    fromCat: string | null;
  } | null>(null);
  // STR-858 Phase B — mobile tap-to-place. Native drag can't place a pool item
  // on a phone; this drives a course-picker ItemPlacementModal so the owner taps
  // "＋ Add to menu" on a pool card, picks a course (+ optional sub-category),
  // and the item lands on the ACTIVE menu via the same applyRawCategoryMove
  // write the drop path uses (which creates the menu association when absent).
  // fromCat null ⇒ ADD (new placement from the pool); a course ⇒ MOVE an item
  // already on the menu to a different course (re-file), reusing the same modal.
  const [placePrompt, setPlacePrompt] = useState<{ item: MenuItemDisplay; fromCat: string | null } | null>(null);
  const handlePlaceItem = useCallback((item: MenuItemDisplay) => {
    setMobileDrawerOpen(false);
    setPlacePrompt({ item, fromCat: null });
  }, []);
  const handleMoveItem = useCallback((item: MenuItemDisplay, fromCat: string) => {
    setPlacePrompt({ item, fromCat });
  }, []);
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
      // ItemPool now lives on the LEFT panel — dragging the divider rightwards
      // should GROW the pool (and shrink the menu builder on the right), which
      // means we add the cursor delta to the stored width.
      const next = Math.min(Math.max(startWidth + (mv.clientX - startX), 200), 520);
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
          // not yet backed by the backend. canonical_categories AND raw_categories
          // must come from fresh so drag-drop category additions and sub-category
          // rename/delete (which update items[], not junctionSettings directly) are
          // reflected immediately in the nested render via getSettings.
          merged[key] = {
            ...p,
            canonical_categories: f.canonical_categories ?? p.canonical_categories ?? [],
            raw_categories: f.raw_categories ?? p.raw_categories ?? [],
          };
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

  // ── Structure loader (flag ON only) ─────────────────────────────────────────
  // Fetch the active menu's first-class structure on tab change + after each
  // structure write (structureRefreshKey bump). Cached per-menu so switching
  // back to a loaded tab is instant; re-fetch keeps it fresh after writes.
  useEffect(() => {
    if (!subcatV2 || !activeMenuId || !service.getMenuStructure) return;
    let cancelled = false;
    service
      .getMenuStructure(activeMenuId)
      .then((structure) => {
        if (cancelled) return;
        setStructureByMenu((prev) => ({ ...prev, [activeMenuId]: structure }));
      })
      .catch(() => {
        // Non-fatal: leave any cached structure in place. The projection memos
        // fall back to the legacy assignments for menus with no loaded structure.
      });
    return () => { cancelled = true; };
  }, [subcatV2, activeMenuId, structureRefreshKey, service]);

  // Course (canonical) an item is assigned to within a loaded structure, plus
  // the sub-category name it sits under. Used to project into the legacy shapes
  // AND to resolve the source course/sub-category for writes.
  const structureItemIndex = useMemo(() => {
    // menuId -> itemId -> { course, subName, subId }
    const idx: Record<string, Record<string, { course: string; subName: string; subId: string }>> = {};
    if (!subcatV2) return idx;
    for (const [menuId, structure] of Object.entries(structureByMenu)) {
      const perItem: Record<string, { course: string; subName: string; subId: string }> = {};
      for (const [course, subs] of Object.entries(structure.courses ?? {})) {
        for (const sub of subs as MenuSubcategory[]) {
          for (const itemId of sub.item_ids ?? []) {
            perItem[itemId] = { course, subName: sub.name, subId: sub.subcategory_id };
          }
        }
      }
      idx[menuId] = perItem;
    }
    return idx;
  }, [subcatV2, structureByMenu]);

  // Sub-category name -> id within a course, for a given menu (write resolution).
  const findSubcategoryId = useCallback(
    (menuId: string, course: string, name: string): string | undefined => {
      const subs = structureByMenu[menuId]?.courses?.[course as keyof MenuStructure['courses']];
      if (!subs) return undefined;
      const target = name.trim().toLowerCase();
      return (subs as MenuSubcategory[]).find((s) => s.name.trim().toLowerCase() === target)?.subcategory_id;
    },
    [structureByMenu],
  );

  // Sub-category name -> { subId } scanning every course on a menu. Used by the
  // menu-scoped rename/delete handlers, which receive only (menuId, label) and
  // no course. Sub-category names are course-unique in practice, so the first
  // match is correct.
  const findSubcategoryByName = useCallback(
    (menuId: string, name: string): { subId: string; course: string } | undefined => {
      const structure = structureByMenu[menuId];
      if (!structure) return undefined;
      const target = name.trim().toLowerCase();
      for (const [course, subs] of Object.entries(structure.courses ?? {})) {
        const hit = (subs as MenuSubcategory[]).find((s) => s.name.trim().toLowerCase() === target);
        if (hit) return { subId: hit.subcategory_id, course };
      }
      return undefined;
    },
    [structureByMenu],
  );

  // Projected assignments + per-item settings (flag ON). For any menu with a
  // loaded structure, course membership and the sub-category label come from the
  // structure (the single source). Items on the menu but not yet in any
  // sub-category still appear (merged from legacy assignments) under Ungrouped,
  // so a freshly-dropped or just-unassigned item is never invisible. Menus
  // without a loaded structure (and the whole flag-OFF path) fall through to the
  // legacy `assignments` / `junctionSettings` unchanged.
  const effectiveAssignments = useMemo(() => {
    if (!subcatV2) return assignments;
    const out: Record<string, Record<string, string[]>> = { ...assignments };
    for (const [menuId, perItem] of Object.entries(structureItemIndex)) {
      const legacy = assignments[menuId] ?? {};
      // Start from a blank set of canonical buckets, then fill from structure.
      const next: Record<string, string[]> = {};
      for (const cat of CANONICAL_CATEGORIES) next[cat] = [];
      const seen = new Set<string>();
      for (const [itemId, info] of Object.entries(perItem)) {
        if (next[info.course] && !seen.has(`${info.course}:${itemId}`)) {
          next[info.course].push(itemId);
          seen.add(`${info.course}:${itemId}`);
        }
      }
      // Merge legacy placements not represented in the structure (items on the
      // menu but unassigned to any sub-category) so they still render (Ungrouped).
      for (const [cat, ids] of Object.entries(legacy)) {
        if (next[cat] === undefined) { next[cat] = [...ids]; continue; }
        for (const id of ids) {
          if (!perItem[id] && !next[cat].includes(id)) next[cat].push(id);
        }
      }
      out[menuId] = next;
    }
    return out;
  }, [subcatV2, assignments, structureItemIndex]);

  const effectiveGetSettings = useCallback(
    (menuId: string, itemId: string): MenuItemJunctionSettings => {
      const base = junctionSettings[`${menuId}:${itemId}`] ?? {
        price: null,
        boost_level: null,
        chefs_special: false,
        portion_type: 'single',
        portion_serves: null,
        category_name: undefined,
      };
      if (!subcatV2) return base;
      const info = structureItemIndex[menuId]?.[itemId];
      if (!structureByMenu[menuId]) return base; // structure not loaded for this menu
      // Override grouping fields from the structure: single course + single
      // sub-category label (single-membership). Unassigned → no labels (Ungrouped).
      return {
        ...base,
        canonical_categories: info ? [info.course] : (base.canonical_categories ?? []),
        raw_categories: info && info.subName ? [info.subName] : [],
      };
    },
    [subcatV2, junctionSettings, structureItemIndex, structureByMenu],
  );

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
    // Default (dishes): the menu manager pool surfaces dishes alongside any
    // items that have been flipped to item_type='included' by the sides
    // flow — owners need to see them in the pool to drag/edit/move them.
    // Addons are excluded (their UI lives on the Food Items page).
    //
    // Admin-only override (itemTypeFilter='addons'): show ONLY addon items
    // so admin staff can navigate to addons from the same food library.
    // Gated upstream by showItemTypeFilter — when the toggle isn't
    // rendered, itemTypeFilter stays at its default 'dishes' and this
    // branch never fires for owner/waiter pools.
    let result: typeof items;
    if (itemTypeFilter === 'addons') {
      result = items.filter((i) => i.item_type === 'addon');
    } else {
      result = items.filter((i) => i.item_type !== 'addon');
    }
    if (search.trim()) {
      result = filterItemsByText(result, search);
    }
    if (visibilityFilter === 'Visible') result = result.filter((i) => i.active !== false);
    if (visibilityFilter === 'Hidden')  result = result.filter((i) => i.active === false);
    return result;
  }, [items, search, visibilityFilter, itemTypeFilter]);

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

  // Drag a whole pool category → stage ALL its items as a pool-source drag, so
  // dropping on a course adds every item at once (PDD 2026-06-12 #4). No
  // multi-select / expand needed.
  const handleCategoryDragStart = useCallback((e: React.DragEvent, itemIds: string[]) => {
    if (itemIds.length === 0) return;
    e.dataTransfer.setData('text/plain', JSON.stringify(itemIds));
    e.dataTransfer.effectAllowed = 'move';
    attachMultiDragGhost(e, itemIds.length);
    setDragging({ itemIds, fromMenuId: null, fromCat: null });
  }, []);

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
        // Flag ON: re-derive the grouped view so removed items drop out of the
        // structure-projected buckets (the cached structure still listed them).
        if (subcatV2) setStructureRefreshKey((k) => k + 1);
        // Clear selection after multi-item drop
        if (idsInMenu.length > 1) setSelected(new Set());
      };
      processRemovals();
    },
    [dragging, items, restaurantId, showToast, trackAction, subcatV2],
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

  // Shared popup opener: gather the sub-categories already under this course and
  // open the pick/create modal, pre-selecting `defaultLabel`. Used by BOTH the
  // generic-bucket drop AND a drop onto a specific sub-category group — so EVERY
  // drop into a course area surfaces the chooser (the owner no longer has to
  // find the small generic strip to trigger it).
  const openSubCatPrompt = useCallback(
    (
      menuId: string,
      cat: string,
      toProcess: MenuItemDisplay[],
      fromCat: string | null,
      defaultLabel: string,
    ) => {
      let labels: RawCategorySummary[];
      if (subcatV2 && structureByMenu[menuId]) {
        // Flag ON: the chooser's existing sub-categories come from the loaded
        // first-class structure for this course (the single source) — not from
        // legacy raw_categories on items.
        const subs = (structureByMenu[menuId].courses?.[cat as keyof MenuStructure['courses']] ?? []) as MenuSubcategory[];
        labels = subs
          .map((s) => ({ label: s.name, item_count: s.count }))
          .sort((a, b) => a.label.localeCompare(b.label));
      } else {
        const members = sectionForCanonical(cat)?.members ?? [cat];
        const subcatCounts = new Map<string, number>();
        for (const it of items) {
          const assoc = it.menu_associations?.find((a) => a.menu_id === menuId);
          if (!assoc) continue;
          const inSection = (assoc.canonical_categories ?? []).some((c) => members.includes(c));
          if (!inSection) continue;
          for (const lbl of assoc.raw_categories ?? []) {
            const t = (lbl ?? '').trim();
            if (t) subcatCounts.set(t, (subcatCounts.get(t) ?? 0) + 1);
          }
        }
        labels = dedupeRawCategoryLabels(
          [...subcatCounts.entries()].map(([label, item_count]) => ({ label, item_count })),
        ).sort((a, b) => a.label.localeCompare(b.label));
      }
      const selectionLabel =
        toProcess.length === 1 ? toProcess[0].name : `${toProcess.length} items`;
      setSubCatPrompt({ menuId, cat, toProcess, labels, defaultLabel, selectionLabel, fromCat });
    },
    [items, subcatV2, structureByMenu],
  );

  // General-area bucket drop (menu raw sub-categories, 7b). Instead of assigning
  // the canonical directly, capture the items and open the pick/create popup so
  // the owner files them under a chosen/created sub-category (or Ungrouped). The
  // actual write happens in the modal's onConfirm → applyRawCategoryMove, which
  // also ensures the canonical placement.
  const handleDropBucket = useCallback(
    async (e: React.DragEvent, menuId: string, cat: string) => {
      e.preventDefault();
      bucketDcRef.current[`${menuId}:${cat}`] = 0;
      setDragOver(null);
      const snap = dragging;
      setDragging(null);
      if (!snap) return;

      // Same menu, same bucket → no-op
      if (snap.fromMenuId === menuId && snap.fromCat === cat) return;

      const menu = menus.find((m) => m.id === menuId);
      if (!menu) {
        showToast('Menu not found — please refresh the page and try again');
        return;
      }

      // Resolve items, blocking add-ons (inline to avoid TDZ on resolveDragItems).
      const allResolved = snap.itemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is MenuItemDisplay => i != null);
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
          fromMenuId: snap.fromMenuId,
          toMenuId: menuId,
          toCategory: cat,
          multiSelect: toProcess.length > 1,
        },
      });

      if (snap.fromMenuId === null) setMobileDrawerOpen(false);

      // Default sub-category = the most-common raw category (item.category)
      // across the dropped selection, ignoring blank/Uncategorized. The popup's
      // existing-label list is computed by openSubCatPrompt.
      const rawCounts = new Map<string, number>();
      for (const it of toProcess) {
        const c = (it.category ?? '').trim();
        if (c && c.toLowerCase() !== 'uncategorized') {
          rawCounts.set(c, (rawCounts.get(c) ?? 0) + 1);
        }
      }
      let defaultLabel = '';
      let best = 0;
      for (const [c, n] of rawCounts) {
        if (n > best) { best = n; defaultLabel = c; }
      }

      openSubCatPrompt(menuId, cat, toProcess, snap.fromCat, defaultLabel);
    },
    [dragging, items, menus, restaurantId, showToast, trackAction, service, openSubCatPrompt],
  );

  // ── Sub-category drop (menu raw sub-categories, 2026-06-09) ──────────────────
  // Hover/leave use a 3-axis counter key (`${menuId}:${cat}:${label}`) and
  // stopPropagation so the parent bucket's enter/drop don't also fire (nested
  // dragenter bubbling — confidence-vote condition #4).
  const handleDragEnterSubCategory = useCallback((e: React.DragEvent, menuId: string, cat: string, label: string) => {
    e.preventDefault();
    e.stopPropagation();
    const key = `${menuId}:${cat}:${label}`;
    bucketDcRef.current[key] = (bucketDcRef.current[key] ?? 0) + 1;
    if (bucketDcRef.current[key] === 1) setDragOver({ menuId, cat, label });
  }, []);

  const handleDragLeaveSubCategory = useCallback((menuId: string, cat: string, label: string) => {
    const key = `${menuId}:${cat}:${label}`;
    bucketDcRef.current[key] = Math.max(0, (bucketDcRef.current[key] ?? 1) - 1);
    if (bucketDcRef.current[key] === 0) {
      setDragOver((prev) =>
        prev !== null && prev !== 'pool' && prev.menuId === menuId && prev.cat === cat && prev.label === label ? null : prev,
      );
    }
  }, []);

  // MOVE / re-file: replace the dragged items' raw_categories with [label] on
  // this menu and ensure `cat` is in canonical_categories. Creates the menu
  // association if the item isn't on the menu yet. Optimistic + per-item
  // rollback, mirroring handleDropBucket.
  // Resolve a drag snapshot into the droppable items (filter out add-ons).
  const resolveDragItems = useCallback(
    (snap: DragState): MenuItemDisplay[] =>
      snap.itemIds
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is MenuItemDisplay => i != null)
        .filter((i) => i.item_type !== 'addon'),
    [items],
  );

  // Shared write for "file these items under `label` in (menu, cat)". Used by
  // the sub-group drop (7a) and the general-area pick/create popup (7b).
  // ADDITIVE (2026-06-11): a real label is APPENDED to the item's existing
  // raw_categories (multi-membership — nothing is wiped). UNGROUPED_KEY is a
  // no-op on labels; it just ensures canonical membership. Removal is via the
  // ✕ chips, not a drop. The paired menu_item_subcategories table is written in
  // its default 'add' mode for the same reason.
  const applyRawCategoryMove = useCallback(
    (toProcess: MenuItemDisplay[], menuId: string, cat: string, label: string,
     fromCat?: string | null) => {
      if (toProcess.length === 0) return;
      const menu = menus.find((m) => m.id === menuId);
      if (!menu) {
        showToast('Menu not found — please refresh the page and try again');
        return;
      }

      // ── Flag ON: write through the first-class sub-category structure API ──
      // No legacy raw_categories / junction dual-write. Resolve (or create) the
      // sub-category under `cat`, then assign each item to it (the API replaces
      // within the course). Ungrouped → unassign within the course. The grouped
      // view is re-derived from /structure on success (structureRefreshKey bump).
      if (subcatV2 && service.assignItemToSubcategory) {
        const ungrouped = label === UNGROUPED_KEY;
        const moveLabelV2 = ungrouped ? 'Ungrouped' : label;
        const runV2 = async () => {
          let subId: string | undefined;
          if (!ungrouped) {
            subId = findSubcategoryId(menuId, cat, label);
            if (!subId && service.createMenuSubcategory) {
              try {
                const created = await service.createMenuSubcategory(menuId, { course: cat, name: label });
                subId = created.subcategory_id;
              } catch {
                showToast(`Couldn't create sub-category "${label}" — try again`);
                return;
              }
            }
            if (!subId) { showToast(`Couldn't file under "${label}" — try again`); return; }
          }
          let failed = 0;
          let firstError = '';
          for (const item of toProcess) {
            try {
              if (ungrouped) {
                await service.unassignItemFromSubcategory?.(menuId, item.id, cat);
              } else {
                await service.assignItemToSubcategory!(menuId, item.id, subId!);
              }
            } catch (e) {
              failed++;
              if (!firstError) firstError = e instanceof Error ? e.message : String(e);
            }
          }
          // Surface the actual failure reason — never silently drop a failed
          // file. A swallowed error here looks to the owner like the drag
          // worked when the item was never added to the menu.
          if (failed > 0) showToast(`Couldn't file ${failed} of ${toProcess.length} under ${moveLabelV2}${firstError ? ` — ${firstError}` : ''}`);
          else showToast(toProcess.length === 1 ? `Filed under ${moveLabelV2}` : `Filed ${toProcess.length} items under ${moveLabelV2}`);
          if (toProcess.length > 1) setSelected(new Set());
          // Re-fetch the structure so the grouped view reflects the write.
          setStructureRefreshKey((k) => k + 1);
        };
        void runV2();
        return;
      }

      const prevItems = items;
      const isUngroupedTarget = label === UNGROUPED_KEY;
      const newLabels = isUngroupedTarget ? [] : [label];
      const moveLabel = isUngroupedTarget ? 'Ungrouped' : label;
      const ids = new Set(toProcess.map((i) => i.id));

      // MOVE between courses (PDD 2026-06-12 #6a, decision D): when the drag came
      // FROM a different section, resolveMoveCanonicals drops the source section's
      // canonicals so the item leaves the old course rather than being added to
      // both. A pool drag (fromCat null) / same-course drop just adds `cat`.
      const resolveCanonicals = (cats: readonly string[]): string[] =>
        resolveMoveCanonicals(cats, cat, fromCat);
      // Append `label` to an item's existing labels (case-insensitive dedupe),
      // preserving what's already there. Ungrouped adds nothing.
      const addLabel = (existing?: readonly string[] | null): string[] => {
        const cur = existing ? [...existing] : [];
        if (isUngroupedTarget) return cur;
        return cur.some((l) => l.toLowerCase() === label.toLowerCase()) ? cur : [...cur, label];
      };

      setItems((prev) =>
        prev.map((i) => {
          if (!ids.has(i.id)) return i;
          const assocs = i.menu_associations ?? [];
          const existing = assocs.find((a) => a.menu_id === menuId);
          if (existing) {
            return {
              ...i,
              menu_associations: assocs.map((a) => {
                if (a.menu_id !== menuId) return a;
                const cats = a.canonical_categories ?? [];
                return {
                  ...a,
                  raw_categories: addLabel(a.raw_categories),
                  canonical_categories: resolveCanonicals(cats),
                };
              }),
            };
          }
          const optimisticAssoc = {
            menu_id: menuId,
            menu_name: menu.name,
            price: i.price ?? null,
            category_name: cat,
            canonical_categories: [cat],
            raw_categories: newLabels,
            boost_level: null,
            chefs_special: false,
            portion_type: 'single' as const,
            portion_serves: null,
          };
          return { ...i, menu_associations: [...assocs.filter((a) => a.menu_id !== menuId), optimisticAssoc] };
        }),
      );

      for (const item of toProcess) pendingWriteItemIdsRef.current.add(item.id);
      const run = async () => {
        let failed = 0;
        let firstError = '';
        for (const item of toProcess) {
          try {
            const assoc = item.menu_associations?.find((a) => a.menu_id === menuId);
            let associations;
            if (assoc) {
              const cats = assoc.canonical_categories ?? [];
              const mergedCats = resolveCanonicals(cats);
              associations = await service.updateMenuItemInMenu(item.id, menuId, {
                raw_categories: addLabel(assoc.raw_categories),
                canonical_categories: mergedCats,
              });
            } else {
              associations = await service.addItemToMenu(item.id, menuId, item.price ?? 0, cat, {
                canonical_categories: [cat],
                raw_categories: newLabels,
              });
            }
            setItems((prev) => prev.map((i) => (i.id !== item.id ? i : { ...i, menu_associations: associations })));
            // Dual-write the paired sub-category model (PDD 2026-06-11): the
            // label is bound to THIS canonical (cat). Best-effort — the legacy
            // raw_categories write above is the builder's own read source, so a
            // failure here doesn't roll back the move. Feeds the patron pills
            // once the env is backfilled.
            if (service.setItemSubcategories) {
              try { await service.setItemSubcategories(menuId, item.id, cat, newLabels); }
              catch { /* non-fatal — paired-model write is additive */ }
            }
          } catch (e) {
            failed++;
            if (!firstError) firstError = e instanceof Error ? e.message : String(e);
            const original = prevItems.find((o) => o.id === item.id);
            if (original) setItems((prev) => prev.map((i) => (i.id !== item.id ? i : original)));
          } finally {
            pendingWriteItemIdsRef.current.delete(item.id);
          }
        }
        // Surface the actual failure reason — never silently drop a failed
        // file. A swallowed error here looks to the owner like the drag
        // worked when the item was never added to the menu.
        if (failed > 0) showToast(`Couldn't file ${failed} of ${toProcess.length} under ${moveLabel}${firstError ? ` — ${firstError}` : ''}`);
        else showToast(toProcess.length === 1 ? `Filed under ${moveLabel}` : `Filed ${toProcess.length} items under ${moveLabel}`);
        if (toProcess.length > 1) setSelected(new Set());
      };
      run();
    },
    [items, menus, service, showToast, subcatV2, findSubcategoryId],
  );

  // 7a — drop onto an existing sub-group → MOVE/re-file directly (no popup).
  const handleDropSubCategory = useCallback(
    (e: React.DragEvent, menuId: string, cat: string, label: string) => {
      e.preventDefault();
      e.stopPropagation();
      bucketDcRef.current[`${menuId}:${cat}:${label}`] = 0;
      setDragOver(null);
      const snap = dragging;
      setDragging(null);
      if (!snap) return;
      const toProcess = resolveDragItems(snap);
      if (toProcess.length === 0) return;
      trackAction('menu.manager.dragToSubCategory', {
        restaurantId,
        metadata: { itemCount: toProcess.length, toMenuId: menuId, toCategory: cat, label },
      });
      // Open the SAME chooser as a generic-area drop, but pre-select the group
      // the items landed on. Every course-area drop now confirms through the
      // popup (the owner can keep this sub-category or pick/create another),
      // rather than some drops filing silently and others opening the chooser.
      openSubCatPrompt(menuId, cat, toProcess, snap.fromCat, label);
    },
    [dragging, resolveDragItems, restaurantId, trackAction, openSubCatPrompt],
  );

  // ── Sub-category rename / delete (menu raw sub-categories, Step 9) ───────────
  // Bulk, menu-scoped: rename/delete a label across EVERY item on the menu.
  // Optimistic with full-list rollback (the bulk op isn't per-item).
  const handleRenameSubCategory = useCallback(
    async (menuId: string, from: string, to: string) => {
      const next = to.trim();
      if (!next || next === from) return;

      // ── Flag ON: rename the first-class sub-category by id ──────────────────
      if (subcatV2 && service.updateMenuSubcategory) {
        const found = findSubcategoryByName(menuId, from);
        if (!found) { showToast(`Couldn't find "${from}" — try again`); return; }
        try {
          await service.updateMenuSubcategory(menuId, found.subId, { name: next });
          showToast(`Renamed "${from}" to "${next}"`);
          setStructureRefreshKey((k) => k + 1);
        } catch {
          showToast(`Couldn't rename "${from}" — try again`);
        }
        return;
      }

      if (!service.renameMenuRawCategory) return;
      const prevItems = items;
      setItems((prev) =>
        prev.map((i) => ({
          ...i,
          menu_associations: (i.menu_associations ?? []).map((a) => {
            if (a.menu_id !== menuId) return a;
            const labels = a.raw_categories ?? [];
            if (!labels.includes(from)) return a;
            const replaced = labels.map((l) => (l === from ? next : l));
            const deduped = replaced.filter(
              (l, idx) => replaced.findIndex((x) => x.toLowerCase() === l.toLowerCase()) === idx,
            );
            return { ...a, raw_categories: deduped };
          }),
        })),
      );
      try {
        await service.renameMenuRawCategory(menuId, from, next);
        showToast(`Renamed "${from}" to "${next}"`);
      } catch {
        setItems(prevItems);
        showToast(`Couldn't rename "${from}" — try again`);
      }
    },
    [items, service, showToast, subcatV2, findSubcategoryByName],
  );

  // Create a new (empty) sub-category in a course. subcatV2 only — the legacy
  // raw_categories model has no first-class sub-category row to create empty.
  // The new row starts item-less; `orderSubCategories` surfaces it (count 0)
  // so its box appears, ready for the owner to file items into. It becomes
  // patron-visible once it holds a visible item.
  const handleCreateSubCategory = useCallback(
    async (menuId: string, category: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      if (!(subcatV2 && service.createMenuSubcategory)) return;
      try {
        await service.createMenuSubcategory(menuId, { course: category, name: n });
        showToast(`Added "${n}"`);
        setStructureRefreshKey((k) => k + 1);
      } catch {
        showToast(`Couldn't add "${n}" — try again`);
      }
    },
    [service, showToast, subcatV2],
  );

  const handleDeleteSubCategory = useCallback(
    async (menuId: string, label: string) => {
      // ── Flag ON: delete the first-class sub-category by id ──────────────────
      if (subcatV2 && service.deleteMenuSubcategory) {
        const found = findSubcategoryByName(menuId, label);
        if (!found) { showToast(`Couldn't find "${label}" — try again`); return; }
        try {
          await service.deleteMenuSubcategory(menuId, found.subId);
          showToast(`Deleted "${label}"`);
          setStructureRefreshKey((k) => k + 1);
        } catch {
          showToast(`Couldn't delete "${label}" — try again`);
        }
        return;
      }

      if (!service.deleteMenuRawCategory) return;
      const prevItems = items;
      setItems((prev) =>
        prev.map((i) => ({
          ...i,
          menu_associations: (i.menu_associations ?? []).map((a) => {
            if (a.menu_id !== menuId) return a;
            const labels = a.raw_categories ?? [];
            if (!labels.includes(label)) return a;
            return { ...a, raw_categories: labels.filter((l) => l !== label) };
          }),
        })),
      );
      try {
        await service.deleteMenuRawCategory(menuId, label);
        showToast(`Deleted "${label}"`);
      } catch {
        setItems(prevItems);
        showToast(`Couldn't delete "${label}" — try again`);
      }
    },
    [items, service, showToast, subcatV2, findSubcategoryByName],
  );

  // STR-775 — order a course's sub-category labels by the owner's sort_order
  // from the first-class structure (flag ON + structure loaded); else alphabetical.
  // UNGROUPED_KEY is always last; labels with no structure row yet (just-scraped,
  // never reordered) sort after the ordered ones, alphabetically.
  const orderSubCategories = useCallback(
    (menuId: string, category: string, labels: string[]): string[] => {
      if (!subcatV2 || !structureByMenu[menuId]) return sortedSubCategoryLabels(labels);
      const subs = (structureByMenu[menuId].courses?.[category as keyof MenuStructure['courses']] ?? []) as MenuSubcategory[];
      // Surface EMPTY sub-categories (count 0) — they have no items to derive a
      // rail label from, so without this an owner-created sub-category stays
      // invisible until an item is filed into it. Populated subs already arrive
      // via `labels` (item-derived); dedupe by normalized key so one is never
      // double-rendered.
      const present = new Set(labels.map((l) => normalizeSubcatKey(l)));
      const emptyNames = subs
        .filter((s) => s.count === 0 && !present.has(normalizeSubcatKey(s.name)))
        .map((s) => s.name);
      return orderSubcategoryLabels([...labels, ...emptyNames], subs);
    },
    [subcatV2, structureByMenu],
  );

  // STR-775 — persist a new sub-category order for a course. Resolves each
  // displayed label to its first-class row, CREATING any missing row seeded with
  // its NEW position (so a course whose rows don't exist yet never collapses to
  // 0 — C2), then appends any existing rows not currently displayed (e.g. empty
  // sub-categories) so ordered_ids is the COMPLETE permutation the API requires.
  // `category` is already the canonical course (Beverages/Appetizers/Entrees/
  // Desserts) the bucket renders, which is exactly what the endpoint expects.
  const handleReorderSubCategories = useCallback(
    async (menuId: string, category: string, orderedLabels: string[]) => {
      if (!subcatV2 || !service.reorderMenuSubcategories) return;
      const real = orderedLabels.filter((l) => l !== UNGROUPED_KEY);
      const courseKey = category as keyof MenuStructure['courses'];

      // OPTIMISTIC — reorder the in-memory structure IMMEDIATELY so the list
      // snaps before any network round-trip (the network-then-render lag was the
      // STR-775 "buttons don't work / clunky" defect). Matched by normalized key
      // (the same collapse the builder groups by); rows not in the displayed set
      // keep their relative order at the end. Rolled back on failure.
      const prevStructure = structureByMenu[menuId];
      setStructureByMenu((prev) => {
        const cur = prev[menuId];
        if (!cur) return prev;
        const subs = (cur.courses?.[courseKey] ?? []) as MenuSubcategory[];
        if (subs.length < 2) return prev;
        const orderIndex = new Map(real.map((l, i) => [normalizeSubcatKey(l), i] as const));
        const rank = (name: string) => {
          const k = normalizeSubcatKey(name);
          return orderIndex.has(k) ? orderIndex.get(k)! : Number.MAX_SAFE_INTEGER;
        };
        const reordered = [...subs]
          .sort((a, b) => rank(a.name) - rank(b.name))
          .map((s, i) => ({ ...s, sort_order: i }));
        return { ...prev, [menuId]: { ...cur, courses: { ...cur.courses, [courseKey]: reordered } } };
      });

      try {
        const existing = (prevStructure?.courses?.[courseKey] ?? []) as MenuSubcategory[];
        // Create-on-demand for any displayed label that has NO backing row yet,
        // matched by NORMALIZED key (not exact name) so a punctuation/spacing
        // variant of an existing row (e.g. "Bread (Kulcha)" vs "Bread Kulcha")
        // never spawns a DUPLICATE row — duplicate rows that collide on the
        // normalized key are the root cause of the snap-to-bottom defect.
        const haveKey = new Set(existing.map((s) => normalizeSubcatKey(s.name)));
        const createdIdByLabel = new Map<string, string>();
        for (let i = 0; i < real.length; i++) {
          const key = normalizeSubcatKey(real[i]);
          if (!key || haveKey.has(key) || !service.createMenuSubcategory) continue;
          const created = await service.createMenuSubcategory(menuId, { course: category, name: real[i], sort_order: i });
          createdIdByLabel.set(real[i], created.subcategory_id);
          haveKey.add(key);
        }
        // Complete permutation = displayed pills (new order, with ALL rows that
        // share a pill's normalized key kept together) + created rows + any
        // existing row not displayed (e.g. empty sub-categories), so the
        // endpoint's set-equality holds and colliding siblings never strand at
        // the bottom.
        const ids = buildReorderedSubcategoryIds(real, existing, createdIdByLabel);
        await service.reorderMenuSubcategories(menuId, { course: category, ordered_ids: ids });
        // Silent reconcile (created rows' real ids / server sort_order). The
        // optimistic order already matches, so nothing visibly moves.
        setStructureRefreshKey((k) => k + 1);
      } catch {
        showToast("Couldn't reorder sub-categories — try again");
        // Roll back the optimistic move, then resync from server truth.
        if (prevStructure) setStructureByMenu((prev) => ({ ...prev, [menuId]: prevStructure }));
        setStructureRefreshKey((k) => k + 1);
      }
    },
    [subcatV2, service, structureByMenu, showToast],
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
  // STR-858 — 1-tap 86 / restore from the mobile menu row. Toggles the item's
  // GLOBAL availability (item.active — hidden on EVERY menu, matching the
  // EditModal Visible/Hidden control; the #1 in-shift action). Optimistic with
  // rollback + failure toast; tracks the write as in-flight so a refresh-edge
  // mid-PUT doesn't clobber the optimistic state (STR-409 pattern).
  const handleToggleItemActive = useCallback(
    async (itemId: string, nextActive: boolean) => {
      const prevItems = items;
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, active: nextActive } : i)));
      pendingWriteItemIdsRef.current.add(itemId);
      try {
        await service.toggleMenuItemActive(itemId, nextActive);
        showToast(nextActive ? 'Item available' : 'Item 86’d — hidden on all menus');
      } catch {
        setItems(prevItems); // rollback — flaky in-restaurant wifi must not silently drop a 86
        showToast('Could not update — check connection and retry');
      } finally {
        pendingWriteItemIdsRef.current.delete(itemId);
      }
    },
    [items, service, showToast],
  );

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
          // Flag ON: re-derive so the removed item leaves the structure buckets.
          if (subcatV2) setStructureRefreshKey((k) => k + 1);
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
            if (subcatV2) setStructureRefreshKey((k) => k + 1);
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
    [items, menus, dismissUndoToast, showUndoToast, showToast, onConfirmItemRemoval, subcatV2],
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

      // ── Flag ON: grouping mutations route to the structure API ──────────────
      // The scoped row-trash and the ✕/＋ chips both call this with
      // `patch.raw_categories` (the new label set). In the single-membership v2
      // model that's either one sub-category (assign) or none (unassign) within
      // the item's current course. No legacy raw_categories write, no junction
      // dual-write. Non-grouping patches (price/boost/special/portion) fall
      // through to the normal updateMenuItemInMenu path below.
      if (subcatV2 && patch.raw_categories !== undefined && service.assignItemToSubcategory) {
        const resolvedCourse = structureItemIndex[menuId]?.[itemId]?.course;
        const newLabels = (patch.raw_categories ?? []).filter((l) => l !== UNGROUPED_KEY);
        const runGrouping = async () => {
          if (!resolvedCourse) { showToast('Couldn’t update — refresh and try again'); return; }
          try {
            if (newLabels.length === 0) {
              await service.unassignItemFromSubcategory?.(menuId, itemId, resolvedCourse);
            } else {
              const name = newLabels[newLabels.length - 1];
              let subId = findSubcategoryId(menuId, resolvedCourse, name);
              if (!subId && service.createMenuSubcategory) {
                const created = await service.createMenuSubcategory(menuId, { course: resolvedCourse, name });
                subId = created.subcategory_id;
              }
              if (!subId) { showToast('Couldn’t file — try again'); return; }
              await service.assignItemToSubcategory!(menuId, itemId, subId);
            }
            setStructureRefreshKey((k) => k + 1);
          } catch {
            showToast('Failed to save — please try again');
          }
        };
        void runGrouping();
        return;
      }

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
        // Dual-write the paired sub-category model (PDD 2026-06-11) when the
        // ✕/＋ chips change raw_categories. The legacy raw_categories[] are flat
        // (menu-wide), so mirror each added/removed label across the item's
        // canonicals on this menu. Best-effort — the legacy write above is the
        // builder's own read source, so a failure here doesn't roll back.
        if (!subcatV2 && patch.raw_categories !== undefined && service.setItemSubcategories) {
          const norm = (s: string) => s.trim().toLowerCase();
          const oldL = (prev.raw_categories ?? []).filter((l) => l !== UNGROUPED_KEY);
          const newL = (patch.raw_categories ?? []).filter((l) => l !== UNGROUPED_KEY);
          const oldKeys = new Set(oldL.map(norm));
          const newKeys = new Set(newL.map(norm));
          const added = newL.filter((l) => !oldKeys.has(norm(l)));
          const removed = oldL.filter((l) => !newKeys.has(norm(l)));
          const assoc = items.find((i) => i.id === itemId)?.menu_associations?.find((a) => a.menu_id === menuId);
          const cats = assoc?.canonical_categories ?? [];
          const setSub = service.setItemSubcategories;
          await Promise.allSettled([
            ...cats.flatMap((c) => added.map((l) => setSub(menuId, itemId, c, [l], 'add'))),
            ...cats.flatMap((c) => removed.map((l) => setSub(menuId, itemId, c, [l], 'remove'))),
          ]);
        }
      } catch {
        // Rollback
        setJunctionSettings((s) => ({ ...s, [key]: prev }));
        showToast('Failed to save — please try again');
      } finally {
        pendingWriteItemIdsRef.current.delete(itemId);
      }
    },
    [junctionSettings, showToast, items, service, subcatV2, structureItemIndex, findSubcategoryId],
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
      // Refetch the active menu's first-class structure. A delete OR a save
      // that changed placements (convert dish→addon strips ALL menu placements
      // server-side; menu-association edits inside the modal already write to
      // /structure) must be reflected in the rendered menu without a page
      // refresh. The refetch is cheap (single GET per active menu) and only
      // runs once per save.
      if (subcatV2) setStructureRefreshKey((k) => k + 1);
      // Also invalidate the page-level TanStack Query cache so navigations
      // (leave and return to Menu Builder, switch restaurants) read the fresh
      // server state rather than the pre-save snapshot.
      onRefresh?.();
      setEditItemId(null);
    },
    [showToast, subcatV2, onRefresh],
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
              {overlapTotal > 0 && onOverlapPillClick && (
                <BannerFilterPill
                  label="Overlap"
                  count={overlapTotal}
                  active={false}
                  onClick={onOverlapPillClick}
                  testId="menu-banner-pill-overlap"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Item Modal — opens centered (legacy) or inside the right-side
          drawer chrome that mirrors /owner/food-items when editItemDrawerMode
          is on. The drawer path uses the same `food-library-drawer*` classes
          (defined in owner-webapp globals.css) and EditModal `displayMode=inline`.
          When the owner clicks Clone, the same drawer hosts the cloneMode
          EditModal — no second popup — so the visual treatment of editing
          and cloning is identical. */}
      {(editItemId || (cloneDraftSource && cloneMenuItem)) && (() => {
        const editItem = editItemId ? items.find((i) => i.id === editItemId) : null;
        if (editItemId && !editItem) return null;
        const cloneEditor = (cloneDraftSource && cloneMenuItem) ? (
          <EditModal
            key={`clone-${cloneDraftSource.id}`}
            item={{
              ...cloneDraftSource,
              // Pre-fill the name with a "(Copy)" suffix — the input is
              // amber-tinted + red-bordered until the owner mutates it
              // enough to remove "Copy" and diverge from the source.
              name: `${cloneDraftSource.name} (Copy)`,
            }}
            restaurantId={restaurantId}
            menus={menus}
            allItems={items.filter((i) => i.item_type !== 'addon')}
            onClose={() => setCloneDraftSource(null)}
            onComplete={(created) => {
              // Patch the new item into local state so it surfaces in the
              // pool without a full refetch. Full hydration happens on
              // next click into the editor (GET /owner/menu/items/{id}).
              setItems((prev) => [created, ...prev]);
              setCloneDraftSource(null);
              // Open the cloned item in the regular editor so the owner
              // can immediately tweak fields they may have wanted to vary.
              setEditItemId(created.id);
            }}
            isNewItem={false}
            cloneMode
            cloneSourceName={cloneDraftSource.name}
            sourceItemId={cloneDraftSource.id}
            onCloneSave={cloneMenuItem}
            dietaryTagService={dietaryTagService}
            customAllergens={customAllergens}
            customDietary={customDietary}
            allergenDefaults={allergenDefaults}
            dietaryDefaults={dietaryDefaults}
            heatLabels={heatLabels}
            sweetnessLabels={sweetnessLabels}
            imageLibrarySlot={imageLibrarySlot}
            displayMode={editItemDrawerMode ? 'inline' : 'modal'}
          />
        ) : null;
        const regularEditor = editItem ? (
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
            customAllergens={customAllergens}
            customDietary={customDietary}
            allergenDefaults={allergenDefaults}
            dietaryDefaults={dietaryDefaults}
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
                  })
                : undefined
            }
            // BYO toggle gates on grouping presence — backend hard-blocks
            // PUT is_byo=true with 400 BYO_REQUIRES_GROUPINGS when the
            // item has zero groupings. Surface the live count so the
            // toggle's disabled state + inline hint match server reality.
            groupingsCount={editItem.groupings?.length ?? 0}
            displayMode={editItemDrawerMode ? 'inline' : 'modal'}
            onEnrichItem={onEnrichItem}
            onCloneRequest={cloneMenuItem ? (sourceItem) => {
              // Hand the same drawer over to the clone draft — close the
              // original item first so the chrome stays mounted but the
              // body swaps to the cloneMode EditModal in the next render.
              setEditItemId(null);
              setCloneDraftSource(sourceItem);
            } : undefined}
          />
        ) : null;
        const body = cloneEditor ?? regularEditor;
        if (!editItemDrawerMode) return body;
        // Drawer mode — reuse the chrome for both regular and clone editors.
        const drawerLabel = cloneDraftSource
          ? `Clone of ${cloneDraftSource.name || 'item'}`
          : (editItem?.name || 'Edit item');
        const closeFn = cloneDraftSource
          ? () => setCloneDraftSource(null)
          : handleCloseEditModal;
        return (
          <>
            <div
              className="food-library-drawer-overlay"
              data-testid="food-item-edit-drawer-overlay"
              onClick={closeFn}
              aria-hidden
            />
            <div
              className="food-library-drawer"
              data-testid="food-item-edit-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={drawerLabel}
              onKeyDown={(e) => { if (e.key === 'Escape') closeFn(); }}
            >
              <div
                data-testid={cloneDraftSource ? 'food-item-clone-draft' : 'food-item-profile'}
                style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
              >
                {body}
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
            onBulkServingSizes,
            onBulkEnrich,
            onBulkApplyGrouping,
            onBulkRemoveGrouping,
            loadGroupingsForItem,
            onBulkAddMembersToGrouping,
            heatLabels,
            sweetnessLabels,
            customAllergens,
            customDietary,
            allergenDefaults,
            dietaryDefaults,
            // Menu Builder is a single-menu context → enable bulk "Remove from
            // menu" (placement removal; items stay in catalogue) — PDD #8.
            currentMenuId: activeMenuId ?? undefined,
            currentMenuName: menus.find((m) => m.id === activeMenuId)?.name,
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
          onBulkEnrich={onBulkEnrich}
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
          menus={menus}
          activeMenuId={activeMenuId}
          onSelectMenu={setActiveMenuId}
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
            onCategoryDragStart: handleCategoryDragStart,
            onDragEnd: handleDragEnd,
            onDragEnterPool: handleDragEnterPool,
            onDragLeavePool: handleDragLeavePool,
            onDropPool: handleDropPool,
            colorMap,
            showVisibilityFilter,
            showItemTypeFilter,
            // STR-858 Phase B — mobile tap-to-place (native drag is dead on
            // touch). ItemPool renders a "＋ Add to menu" button per card on
            // mobile when this is wired.
            onPlaceItem: handlePlaceItem,
          }}
          menuBuilderProps={{
            items,
            menus,
            assignments: effectiveAssignments,
            junctionSettings,
            activeMenuId,
            collapsed,
            dragging,
            dragOver,
            colorMap,
            getSettings: effectiveGetSettings,
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
            onDragEnterSubCategory: handleDragEnterSubCategory,
            onDragLeaveSubCategory: handleDragLeaveSubCategory,
            onDropSubCategory: handleDropSubCategory,
            onRenameSubCategory: handleRenameSubCategory,
            onDeleteSubCategory: handleDeleteSubCategory,
            orderSubCategories,
            // Gate the reorder UI on the feature flag — without this the grip +
            // ▲▼ render but no-op when subcatV2 is off (e.g. prod), because the
            // handler is always defined. Render gate must match capability.
            onReorderSubCategory: subcatV2 ? handleReorderSubCategories : undefined,
            onCreateMenu: handleCreateMenu,
            onCloneMenu: handleCloneMenu,
            onEditMenu: setEditMenuId,
            onRemoveItemFromMenu: handleRemoveItemFromMenu,
            onEditItem: setEditItemId,
            onUpdateModifiers: handleUpdateModifiers,
            onBringIntoMenu,
            // STR-858 — mobile-only 1-tap 86/restore in the builder row (desktop
            // uses EditModal). MenuBuilder renders the control only when this is
            // present, so desktop is unaffected.
            onToggleItemActive: handleToggleItemActive,
            // STR-858 Phase B — mobile "Move to…" (re-file a row's course via
            // the same tap-driven course picker; native drag is dead on touch).
            onMoveItemCourse: handleMoveItem,
            // STR-858 Phase B prop-parity — these were omitted on mobile,
            // silently disabling sub-category creation + the rec/include drop
            // prompts on a phone. Match desktop.
            onCreateSubCategory: subcatV2 ? handleCreateSubCategory : undefined,
            onConfirmRecommendationDrop,
            onConfirmIncludeDrop,
            perMenuSides,
            scrollToItemId,
            onScrollComplete: () => setScrollToItemId(null),
          }}
        />
      ) : (
        /* Two-panel layout — desktop. The menu tab bar spans both panels at
           the top; below, ItemPool (the Food Item Library) lives on the LEFT
           (fixed/resizable width) and MenuBuilder fills the RIGHT. The three
           panels are laid out with an explicit flex `order` (pool=1, divider=2,
           builder=3) so the visual left→right order is pool → divider → builder
           regardless of source order. */
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <MenuTabBar
            menus={menus}
            activeMenuId={activeMenuId}
            onTabChange={(menuId) => {
              if (bulkMenuSelection.size > 0 || bulkMenuSidesOpen) {
                const hadSelection = bulkMenuSelection.size > 0;
                setBulkMenuSelection(new Set());
                setBulkMenuSidesOpen(false);
                if (hadSelection && menuId !== activeMenuId) {
                  onBulkSelectionClearedByTabChange?.();
                }
              }
              setActiveMenuId(menuId);
            }}
            onEditMenu={setEditMenuId}
            onCreateMenu={handleCreateMenu}
            onCloneMenu={service.cloneMenu ? () => setCloneOpen(true) : undefined}
          />

          <div
            style={{
              display: 'flex',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
          {/* Right panel — MenuBuilder (flex fills remaining space) */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, order: 3 }}>
          <MenuBuilder
            items={items}
            menus={menus}
            assignments={effectiveAssignments}
            junctionSettings={junctionSettings}
            activeMenuId={activeMenuId}
            collapsed={collapsed}
            dragging={dragging}
            dragOver={dragOver}
            colorMap={colorMap}
            getSettings={effectiveGetSettings}
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
            onDragEnterSubCategory={handleDragEnterSubCategory}
            onDragLeaveSubCategory={handleDragLeaveSubCategory}
            onDropSubCategory={handleDropSubCategory}
            onRenameSubCategory={handleRenameSubCategory}
            onDeleteSubCategory={handleDeleteSubCategory}
            orderSubCategories={orderSubCategories}
            onReorderSubCategory={subcatV2 ? handleReorderSubCategories : undefined}
            onCreateSubCategory={subcatV2 ? handleCreateSubCategory : undefined}
            onCreateMenu={handleCreateMenu}
            onCloneMenu={handleCloneMenu}
            onEditMenu={setEditMenuId}
            onRemoveItemFromMenu={handleRemoveItemFromMenu}
            onEditItem={setEditItemId}
            onUpdateModifiers={handleUpdateModifiers}
            onConfirmRecommendationDrop={onConfirmRecommendationDrop}
            onBringIntoMenu={onBringIntoMenu}
            onConfirmIncludeDrop={onConfirmIncludeDrop}
            scrollToItemId={scrollToItemId}
            builderSearchQuery={builderSearchQuery}
            onScrollComplete={() => setScrollToItemId(null)}
            onRefresh={onRefresh ? handleRefresh : undefined}
            refreshing={refreshing}
            byoHandlers={byoHandlers}
            showAddons={showAddons}
            showRecommendations={showRecommendations}
            showAddGrouping={showAddGrouping}
            perMenuSides={perMenuSides}
            missingPriceFilter={missingPriceFilter}
            bulkSelectionEnabled={bulkSidesEnabled}
            bulkSelection={bulkMenuSelection}
            onToggleBulkSelection={(itemId) =>
              setBulkMenuSelection((prev) => {
                const next = new Set(prev);
                if (next.has(itemId)) next.delete(itemId);
                else next.add(itemId);
                return next;
              })
            }
            onOpenBulkPanel={() => setBulkMenuSidesOpen(true)}
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
              order: 2,
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

          {/* Left panel — ItemPool / Food Item Library (fixed width, resizable) */}
          <div style={{ width: poolWidth, flexShrink: 0, minHeight: 0, order: 1 }}>
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
            onCategoryDragStart={handleCategoryDragStart}
            onDragEnd={handleDragEnd}
            onDragEnterPool={handleDragEnterPool}
            onDragLeavePool={handleDragLeavePool}
            onDropPool={handleDropPool}
            colorMap={colorMap}
            showVisibilityFilter={showVisibilityFilter}
            showItemTypeFilter={showItemTypeFilter}
            groupByRawCategory={poolGroupByRawCategory}
          />
          </div>
          </div>

          {service.cloneMenu && cloneOpen && (
            <CloneMenuModal
              sourceMenus={menus}
              onClose={() => setCloneOpen(false)}
              onConfirm={async (sourceMenuId, name) => {
                await handleCloneMenu(sourceMenuId, name);
                setCloneOpen(false);
              }}
            />
          )}
        </div>
      )}

      {/* PDD 2026-05-22 — Menu Builder bulk Includes drawer.
          Drinks have no "Includes" sides — exclude them from the bulk apply and
          tell the owner how many were skipped (PDD 2026-06-12 #9). */}
      {bulkSidesEnabled
        && bulkMenuSidesOpen
        && activeMenuId
        && bulkMenuSelection.size > 0 && (
        <BulkMenuSidesPanel
          menuId={activeMenuId}
          menuName={menus.find((m) => m.id === activeMenuId)?.name}
          selectedItems={items
            .filter((i) => bulkMenuSelection.has(i.id) && !isDrinkItem(i))
            .map((i) => ({ id: i.id, name: i.name }))}
          skippedDrinkCount={
            items.filter((i) => bulkMenuSelection.has(i.id) && isDrinkItem(i)).length
          }
          pool={items}
          loadPerMenuSides={(itemId) => loadPerMenuSides!(activeMenuId, itemId)}
          onBulkAddSides={(itemIds, body) =>
            onBulkAddSidesToMenuItems!(activeMenuId, itemIds, body)
          }
          onBulkRemoveSides={(itemIds, body) =>
            onBulkRemoveSidesFromMenuItems!(activeMenuId, itemIds, body)
          }
          onClose={() => setBulkMenuSidesOpen(false)}
          onComplete={() => {
            setBulkMenuSidesOpen(false);
            setBulkMenuSelection(new Set());
            void onRefresh?.();
          }}
        />
      )}

      {/* Drop onto a course / sub-category → the course is already known, so the
          unified modal locks the category and leads with the sub-category step. */}
      <ItemPlacementModal
        open={subCatPrompt !== null}
        lockedCategory={subCatPrompt?.cat ?? null}
        lockedCategoryLabel={
          // Show the 4-section label (Drinks / Starters / Mains / Desserts)
          // rather than the underlying canonical (Beverages / Appetizers /
          // Entrees / Desserts). Routes through sectionForCanonical so the
          // labels can never drift out of sync with MENU_SECTIONS.
          subCatPrompt
            ? sectionForCanonical(subCatPrompt.cat)?.label ?? subCatPrompt.cat
            : ''
        }
        itemCount={subCatPrompt?.toProcess.length ?? 0}
        selectionLabel={subCatPrompt?.selectionLabel ?? ''}
        labels={subCatPrompt?.labels ?? []}
        defaultLabel={subCatPrompt?.defaultLabel ?? ''}
        testid="subcategory-pick-modal"
        onConfirm={({ subLabel }) => {
          if (subCatPrompt) {
            applyRawCategoryMove(subCatPrompt.toProcess, subCatPrompt.menuId, subCatPrompt.cat, subLabel, subCatPrompt.fromCat);
          }
          setSubCatPrompt(null);
        }}
        onCancel={() => setSubCatPrompt(null)}
      />

      {/* STR-858 Phase B — mobile tap-to-place course picker. The owner taps
          "＋ Add to menu" on a pool card → this modal (course picker, since the
          course is unknown for a fresh placement) → the item lands on the ACTIVE
          menu via applyRawCategoryMove (fromCat=null ⇒ ADD, not move). */}
      <ItemPlacementModal
        open={placePrompt !== null}
        categories={CANONICAL_CATEGORIES}
        itemCount={1}
        selectionLabel={placePrompt?.item.name ?? ''}
        labels={[]}
        defaultLabel={placePrompt?.item.category ?? ''}
        testid="mobile-place-item-modal"
        onConfirm={({ category, subLabel }) => {
          if (placePrompt && activeMenuId && category) {
            // fromCat set ⇒ MOVE (drops the source course); null ⇒ ADD.
            applyRawCategoryMove([placePrompt.item], activeMenuId, category, subLabel, placePrompt.fromCat);
          }
          setPlacePrompt(null);
        }}
        onCancel={() => setPlacePrompt(null)}
      />
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

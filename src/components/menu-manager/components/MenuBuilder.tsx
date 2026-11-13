'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Star, Pencil, Trash2, Ban, RotateCcw, FolderInput, GripVertical, MoreHorizontal, Layers, Eye, EyeOff, ListTree } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings, Grouping, ServingOption } from '../../../types/restaurant';
import WineEnrichmentBanner from './WineEnrichmentBanner';
import { type MenuColor, intToBoostLabel, BOOST_LABELS, UNGROUPED_KEY, sortedSubCategoryLabels, MENU_SECTIONS, sectionsForMenu, isDrinksMenu, normalizeSubcatKey, preferScrapedLabel, asArray } from '../lib/menuUtils';
import { matchesItemText } from '../filterItemsByText';
import { useBuilderSearchHighlight } from '../builderSearchHighlight';
import { BuilderWorkspaceContext, useBuilderWorkspace, selectionState, DROP_RING, DRAG_EXPAND_MS, type BuilderWorkspaceMode } from '../builderWorkspace';
import { SubCategoryGroup } from './SubCategoryGroup';
import { SubCategoryCreateBox } from './SubCategoryCreateBox';
import { ManageSectionsModal, type ManageSection } from './ManageSectionsModal';
import { COLOR_WARNING } from '../../../constants/colors';
import { countApprovedAddons } from '../lib/addonHelpers';
import Select from '../../common/Select';
import type { DragState } from '../MenuManagerClient';
import ItemModifierZones, { type ModifierEntry, type ModifierUpdatePayload } from './ItemModifierZones';
import MobileItemModifierPicker from './MobileItemModifierPicker';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTrackAction } from '../track-action-context';
import { SWEETNESS_VISIBLE } from '../../../constants/feature-flags';
import { parsePriceInput } from '../../../utils/price';
import { useCurrencySymbol } from '../../../context/CurrencyContext';

export type { ModifierUpdatePayload };
export type { ModifierEntry };

/**
 * What a custom row chrome (MenuBuilder `rowChrome`) gets: the row's data and
 * its already-wired handlers, so the consumer only draws. Desktop only.
 */
export interface MenuRowChromeProps {
  item: MenuItemDisplay;
  /** Set while the Item library search highlights this row (mark the name with it). */
  searchQuery?: string;
  menuId: string;
  /** The canonical bucket the row is rendered under. */
  cat: string;
  settings: MenuItemJunctionSettings;
  saving: boolean;
  expanded: boolean;
  toggleExpanded: () => void;
  onEdit: () => void;
  active: boolean;
  onToggleActive?: () => void;
  /** 'Low' | 'Moderate' | 'High', or null for no boost (this bucket). */
  boost: string | null;
  onBoostChange: (label: string | null) => void;
  chefsSpecial: boolean;
  onToggleChefsSpecial: () => void;
  portionType: 'single' | 'shared';
  onPortionType: (t: 'single' | 'shared') => void;
  /** Inline price for this bucket. `editable` is false for wine / serving
   *  prices — those are edited in the expanded settings. */
  price: {
    display: string | null;
    isOverride: boolean;
    editable: boolean;
    value: string;
    setValue: (v: string) => void;
    commit: () => void;
    invalid: string | null;
  };
  /** Take the item off this menu — or, when the row sits in a sub-category,
   *  out of that sub-category only (same handler the ⋯ menu's Remove uses). */
  onRemove: () => void;
  /** The sub-category the row is rendered under (undefined / Ungrouped ⇒ the
   *  whole menu). Drives the remove control's label. */
  subLabel?: string;
  /** Menu workspace v5: the row's grip — drag it within its sub-category to
   *  reorder the dishes. Absent where dishes can't be ordered (Ungrouped,
   *  admin / waiter). */
  reorderHandle?: { onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };
  /** Bring an off-menu pairing's dish onto this menu (the same flow the
   *  Inactive pairing chip's popover runs). Absent where the host has none. */
  onBringIntoMenu?: (memberItemId: string) => void;
  /** Pairing dish ids the Inactive chip would list — the target shares no
   *  non-paused menu with this dish (classifyRecMembers, the patron's
   *  same-menu pairing rule). Lets a badge-only row mark them. */
  inactivePairingIds?: ReadonlySet<string>;
}

// ── Attention rules ──────────────────────────────────────────────────────────
// An item-in-menu "needs attention" when its displayed price would be empty —
// i.e. neither the per-menu price override nor the base item price is set.
// Used to paint a red border on the MenuItemRow + a count badge on the bucket
// header. STR-251 round 3.
//
// Exported so MenuManagerClient can drive the "X items missing price" pill on
// the menu-stats banner with the same predicate the bucket attention badge
// uses — keeping the banner count and the bucket badges in lock-step.
export function itemHasAttention(item: MenuItemDisplay, settings: MenuItemJunctionSettings): boolean {
  if (settings.price != null) return false;
  if (item.price != null) return false;
  const spo = settings.serving_price_overrides;
  if (spo != null && (spo['glass'] != null || spo['bottle'] != null)) return false;
  return true;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface MenuBuilderProps {
  items: MenuItemDisplay[];
  menus: MenuSummary[];
  assignments: Record<string, Record<string, string[]>>;
  junctionSettings: Record<string, MenuItemJunctionSettings>;
  activeMenuId: string | null;
  collapsed: Record<string, boolean>;
  dragging: DragState | null;
  dragOver: { menuId: string; cat: string; label?: string } | 'pool' | null;
  colorMap: (index: number) => MenuColor;
  getSettings: (menuId: string, itemId: string) => MenuItemJunctionSettings;
  /** No longer used — the tab strip moved to MenuTabBar at the
   *  MenuManagerClient level. Kept optional so existing callers
   *  (admin / waiter) compile without churn until they migrate. */
  onTabChange?: (menuId: string) => void;
  onToggleCollapse: (key: string) => void;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onDragEnterBucket: (e: React.DragEvent, menuId: string, cat: string) => void;
  onDragLeaveBucket: (menuId: string, cat: string) => void;
  onDropBucket: (e: React.DragEvent, menuId: string, cat: string) => void;
  /** Sub-category drop zones (menu raw sub-categories, 2026-06-09). Optional so
   *  admin/waiter consumers compile until they wire them. */
  onDragEnterSubCategory?: (e: React.DragEvent, menuId: string, cat: string, label: string) => void;
  onDragLeaveSubCategory?: (menuId: string, cat: string, label: string) => void;
  onDropSubCategory?: (e: React.DragEvent, menuId: string, cat: string, label: string) => void;
  onRenameSubCategory?: (menuId: string, from: string, to: string) => void | Promise<void>;
  onDeleteSubCategory?: (menuId: string, label: string) => void | Promise<void>;
  /** STR-775 — resolve the display order of a course's sub-category labels
   *  (owner sort_order from the first-class structure; falls back to alphabetical). */
  orderSubCategories?: (menuId: string, category: string, labels: string[]) => string[];
  /** Menu workspace v5: the owner's dish order inside a sub-category — returns
   *  `itemIds` sorted by it (unknown ids keep their place at the end). */
  orderSubCategoryItems?: (menuId: string, category: string, label: string, itemIds: string[]) => string[];
  /** Menu workspace v5: move `draggedId` before / after `targetId` inside the
   *  sub-category `label` (grip drag on a row). */
  onReorderSubCategoryItem?: (menuId: string, category: string, label: string, draggedId: string, targetId: string, position: 'before' | 'after') => void;
  /** Whether `label` is a real (saveable) sub-category — the grip shows only then. */
  canReorderSubCategoryItems?: (menuId: string, category: string, label: string) => boolean;
  /** STR-775 — persist a new sub-category order for a course (drag-grip or ▲▼). */
  onReorderSubCategory?: (menuId: string, category: string, orderedLabels: string[]) => void | Promise<void>;
  /** Create a new (empty) sub-category in a course from the rail's [+] box.
   *  Optional so waiter/admin consumers compile until they wire it. */
  onCreateSubCategory?: (menuId: string, category: string, name: string) => void | Promise<void>;
  onCreateMenu: (name: string) => Promise<void>;
  /**
   * STR-521 — clone an existing menu into a new menu (categories + per-category
   * overrides + items). Optional so consumers without the backend route deployed
   * (e.g. waiter-webapp on older qrate-core) can omit it; when omitted the
   * "Clone Existing" button is hidden.
   */
  onCloneMenu?: (sourceMenuId: string, name: string) => Promise<void>;
  onEditMenu: (menuId: string) => void;
  onRemoveItemFromMenu: (itemId: string, menuId: string) => void;
  /** STR-858 — mobile-only 1-tap 86/restore of an item's GLOBAL availability.
   *  Wired by MenuManagerClient's mobile branch only; when absent the row 86
   *  control doesn't render (desktop / other consumers). */
  onToggleItemActive?: (itemId: string, nextActive: boolean) => void;
  /** STR-858 — mobile-only "Move to…" (re-file a row to a different course via
   *  the tap course picker). Wired by MenuManagerClient's mobile branch only. */
  onMoveItemCourse?: (item: MenuItemDisplay, fromCat: string) => void;
  /** STR-858 — mobile-only "86 whole course" (bulk-hide). Mobile branch only. */
  onHideCategory?: (itemIds: string[]) => void;
  onEditItem: (itemId: string) => void;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  /**
   * Optional gate called before a dropped item is added as a recommendation.
   * Forwarded to MobileItemModifierPicker (mobile only — desktop no
   * longer has addon/recommendation drop zones after PDD 2026-05-15 v2).
   */
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /**
   * Click handler for the per-row "Bring into Menu" button on the
   * Inactive Recs chip popover. Wired in owner-webapp to the same hook
   * that runs the Includes / Choose-One drag drops. Omit (waiter /
   * admin) to suppress the button entirely.
   */
  onBringIntoMenu?: (memberId: string, ownerMenuId: string) => void;
  /**
   * BYO PDD Step 7b — bundle of optional callbacks for BYO authoring.
   * Forwarded to MobileItemModifierPicker (mobile only — desktop no
   * longer renders BYO affordances in the row UI after PDD 2026-05-15 v2;
   * BYO authoring lives in the Food Item's EditModal Groupings tab).
   */
  byoHandlers?: import('./ItemModifierZones').BYOHandlers;
  /** When false, the Add-ons drop zone is omitted from the mobile picker. Default true. */
  showAddons?: boolean;
  /** When false, the Recommendations drop zone is omitted from the mobile picker. Default true. */
  showRecommendations?: boolean;
  /** When false, the [+ Add grouping] button is omitted from the mobile picker. Default true. */
  showAddGrouping?: boolean;
  /**
   * PDD 2026-05-15 v2 — per-menu Includes/Choose-One sides adapter.
   * Forwarded to the desktop ItemModifierZones component to render the
   * two per-menu drop zones in the expanded dish row. Omitted = no
   * per-menu sides UI (e.g. unit tests, waiter-webapp).
   */
  perMenuSides?: import('./ItemModifierZones').PerMenuSidesAdapter;
  /**
   * Per-restaurant `menu_include_zones` feature flag (2026-09-02). When
   * false, the two per-menu drop zones — "Includes All" (sides_and) and
   * "Includes one by choice" (sides_or) — are omitted from the expanded
   * dish row; the row still renders its attributes, and course /
   * sub-section collapse is unaffected.
   *
   * Default TRUE, and that default is load-bearing: this package is
   * consumed by owner, waiter and admin, so `undefined` must mean
   * "unchanged" for every consumer that has not wired the flag.
   */
  showIncludeZones?: boolean;
  /** Optional desktop row chrome (owner Menu workspace, 2026-11-11). When set,
   *  a collapsed desktop row renders this instead of the default grip · tile ·
   *  name · price · Visible · ⋯ line; the row keeps its drag source, expanded
   *  settings panel and handlers. Admin and waiter leave it unset. */
  rowChrome?: (p: MenuRowChromeProps) => React.ReactNode;
  onConfirmIncludeDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /** When set, scroll to + expand the first occurrence of this item in the active menu */
  scrollToItemId?: string | null;
  onScrollComplete?: () => void;
  /**
   * Free-text filter for the chosen menu's rows (2026-07-05). Driven by the
   * app-shell search on the owner Menu page (PageSearchContext). When non-empty,
   * only rows whose name/description match are shown, empty categories are
   * hidden, and matching categories auto-expand. Optional + defaults to no
   * filtering, so waiter/admin consumers are unaffected.
   */
  builderSearchQuery?: string;
  /**
   * PDD 2026-05-22 — bulk Includes/Choose-One action on the active menu.
   * When wired (via onOpenBulkPanel), a checkbox column appears at the
   * left edge of each item row and a "Bulk action" button surfaces in
   * the active-menu header. Selection state is owner-managed (lifted
   * to MenuManagerClient) so switching menu tabs can clear it.
   */
  bulkSelectionEnabled?: boolean;
  bulkSelection?: Set<string>;
  onToggleBulkSelection?: (itemId: string) => void;
  onOpenBulkPanel?: () => void;
  /** Callback to re-fetch menus + items from server (for crawl-mid-session refresh). */
  onRefresh?: () => void;
  /** True while a background refresh is in flight. */
  refreshing?: boolean;
  /** Collapse or expand all category buckets at once. */
  onCollapseAll?: (collapse: boolean) => void;
  /** When true, each category bucket only renders items with itemHasAttention
   *  (i.e. missing both per-menu and base price). Driven by the menu-stats
   *  banner pill on the owner /owner/menu page. Empty filtered buckets still
   *  render their header but show "No items missing price". */
  missingPriceFilter?: boolean;
  /**
   * Wine-enrichment status/retry — a SEPARATE flow from the wizard and item
   * editor. Both optional; absent means the banner never renders (today's
   * behaviour for waiter/admin consumers of this package).
   */
  wineEnrichmentJob?: import('../../../types/restaurant').WineEnrichmentJob | null;
  onRetryWineEnrichment?: () => Promise<void> | void;
  /** Owner Menu workspace (handoff v3): slim header, Expand all opens
   *  sub-categories too, tri-state select-alls, drag-only sub-category reorder. */
  /** v5 (owner Menu workspace): Expand all / Collapse all renders HERE (the page's
   *  status line) and the card header row (item count) is not drawn. */
  expandAllPortalTarget?: Element | null;
  workspaceMode?: boolean;
}

// ── GroupingChip ──────────────────────────────────────────────────────────────
// One colored pill per non-empty grouping on a menu item, replacing the legacy
// sides/recs/addons counters and the single aggregate groupings chip. The
// label and palette derive from the grouping's `kind`; custom + modifier
// groupings use the grouping's own name. Hovering for 500ms opens a popover
// listing the grouping's members.
const KIND_PALETTE: Record<string, { bg: string; fg: string; border: string }> = {
  addons:          { bg: '#ffedd5', fg: '#9a3412', border: 'var(--ink)' }, // orange
  sides_and:       { bg: '#dcfce7', fg: '#166534', border: '#A6CDB3' }, // green
  sides_or:        { bg: '#dcfce7', fg: '#166534', border: '#A6CDB3' }, // green
  recommendations: { bg: '#dbeafe', fg: '#1e40af', border: 'var(--line-input)' }, // blue
  modifier:        { bg: '#fef3c7', fg: '#92400e', border: '#D9BF8E' }, // amber
  custom:          { bg: '#ede9fe', fg: '#6b21a8', border: 'var(--line-input)' }, // purple
};
const GROUPING_HOVER_DELAY_MS = 500;

// Visible count of grouping members. For the addons grouping, AI-suggested
// members aren't on the live menu yet — exclude them so the chip count matches
// what diners would actually see (matches the legacy approved-only behaviour).
function visibleItems(grouping: Grouping): Grouping['items'] {
  if (grouping.kind === 'addons') {
    return grouping.items.filter((it) => it.status !== 'suggested');
  }
  return grouping.items;
}

function chipLabel(grouping: Grouping, count: number): string {
  switch (grouping.kind) {
    case 'addons':          return count === 1 ? 'addon' : 'addons';
    case 'sides_and':       return 'included';
    case 'sides_or':        return count === 1 ? 'choice' : 'choices';
    case 'recommendations': return count === 1 ? 'rec' : 'recs';
    default:                return grouping.name;
  }
}

function GroupingChip({
  grouping,
}: {
  grouping: Grouping;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const items = visibleItems(grouping);
  const count = items.length;
  if (count <= 0) return null;

  const palette = KIND_PALETTE[grouping.kind ?? 'custom'] ?? KIND_PALETTE.custom;
  const label = chipLabel(grouping, count);

  const handleEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), GROUPING_HOVER_DELAY_MS);
  };

  const handleLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span
        className="text-[10px] font-bold px-1.5 py-px rounded shrink-0 cursor-default"
        data-testid={`grouping-chip-${grouping.id}`}
        style={{ background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
      >
        {count} {label}
      </span>
      {open && (
        <div
          role="tooltip"
          data-testid={`grouping-chip-popover-${grouping.id}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 w-64 max-h-72 overflow-y-auto rounded shadow-lg"
          style={{
            background: 'var(--white, #fff)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          }}
        >
          <div className="p-2">
            <div className="text-xs font-semibold mb-1 truncate">{grouping.name}</div>
            <ul className="ml-1 space-y-0.5">
              {items.map((it) => (
                <li key={it.id} className="text-[10px] text-[var(--text2)] truncate">
                  • {it.name ?? '(unnamed)'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── RecGroupingChips ──────────────────────────────────────────────────────────
//
// Specialised render for kind='recommendations' groupings. Splits members
// into Active (rec target has an active placement on a menu that is itself
// active AND currently in its schedule window in the OWNER'S browser tz)
// vs Inactive (orphan OR only on paused / out-of-schedule menus).
//
// Active chip: hover popover with member names, read-only — same UX as
// the legacy GroupingChip.
//
// Inactive chip: CLICK-pinned popover (hover-only doesn't survive
// interactive children — moving the cursor from chip to button would
// trigger mouseleave). Each row shows the member name + a "Bring into
// Menu" button. Click fires onBringIntoMenu(memberId, menuId) — the
// consumer wires this to the same hook that handles Includes / Choose-One
// drops, so the canonical-category picker opens identically.
//
// Empty side renders a faded zero pill — owners can scan a row and see
// "0 active / 3 inactive" at a glance.

const REC_ACTIVE_PALETTE = { bg: '#dcfce7', fg: '#166534', border: '#A6CDB3' };
const REC_INACTIVE_PALETTE = { bg: '#fef3c7', fg: '#92400e', border: '#D9BF8E' };

// Single, consistent "valid drop target" highlight. Green is reserved for
// "you can drop here" and is used identically across every drop zone — course
// buckets, sub-category groups, and the modifier (Includes/Recommendations)
// zones — so the builder reads the same wherever the owner drags. Course
// colours still own the collapsed tab/identity; only the *drop* affordance is
// green.
export const DROP_TARGET = { bg: '#F0FDF4', fill: '#DCFCE7', border: 'var(--ok)', accent: '#15803D' };

export function _classifyRecMembersForTest(
  members: readonly Grouping['items'][number][],
  itemsById: Map<string, MenuItemDisplay>,
  menusById: ReadonlyMap<string, MenuSummary>,
  parentActiveMenuIds: ReadonlySet<string>,
) {
  return classifyRecMembers(members, itemsById, menusById, parentActiveMenuIds);
}

// "Active" means the rec target shares at least one non-paused menu with the
// PARENT dish it is recommended with (2026-06-19). The diner views the parent
// on a menu and can only order pairings available on that SAME menu, so the
// patron app (diner_recommendations.py Pass 4) only surfaces a rec whose
// target shares an active menu with the parent — this chip mirrors that so an
// owner never sees a rec marked "Active" that diners can't actually get.
// A rec target that is live, but only on a DIFFERENT menu than the parent, is
// Inactive here (the Inactive popover's "Bring into Menu" lets the owner add
// it to the parent's menu). Schedule windows are NOT considered — an owner
// editing the Dinner menu at 11 AM still thinks of dinner-menu items as "on
// the menu"; the menu just has to be non-paused (menus.active).
function classifyRecMembers(
  members: readonly Grouping['items'][number][],
  itemsById: Map<string, MenuItemDisplay>,
  menusById: ReadonlyMap<string, MenuSummary>,
  parentActiveMenuIds: ReadonlySet<string>,
): { active: typeof members; inactive: typeof members } {
  const active: typeof members[number][] = [];
  const inactive: typeof members[number][] = [];
  for (const m of members) {
    const target = m.menu_item_id ? itemsById.get(m.menu_item_id) : undefined;
    const assocs = target?.menu_associations ?? [];
    let sharesParentMenu = false;
    for (const a of assocs) {
      if (!a.menu_id) continue;
      // The target must be placed on a menu the PARENT is also on, and that
      // menu must be non-paused.
      if (!parentActiveMenuIds.has(a.menu_id)) continue;
      const menu = menusById.get(a.menu_id);
      if (menu && menu.active) {
        sharesParentMenu = true;
        break;
      }
    }
    (sharesParentMenu ? active : inactive).push(m);
  }
  return { active, inactive };
}

export function RecGroupingChips({
  grouping,
  owningItem,
  menuId,
  itemsById,
  menus,
  onBringIntoMenu,
}: {
  grouping: Grouping;
  owningItem: MenuItemDisplay;
  menuId: string;
  itemsById: Map<string, MenuItemDisplay>;
  menus: readonly MenuSummary[];
  onBringIntoMenu?: (memberId: string, ownerMenuId: string) => void;
}) {
  const menusById = useMemo(
    () => new Map(menus.map((m) => [m.id, m])),
    [menus],
  );
  // The parent dish's own non-paused menus. A rec is Active only if its
  // target shares one of these (see classifyRecMembers) — mirrors the patron
  // app's same-menu pairing rule.
  const parentActiveMenuIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of owningItem?.menu_associations ?? []) {
      if (a.menu_id && menusById.get(a.menu_id)?.active) ids.add(a.menu_id);
    }
    return ids;
  }, [owningItem, menusById]);
  const { active, inactive } = useMemo(
    () => classifyRecMembers(grouping.items, itemsById, menusById, parentActiveMenuIds),
    [grouping.items, itemsById, menusById, parentActiveMenuIds],
  );
  if (active.length + inactive.length === 0) return null;
  return (
    <>
      <RecActiveChip members={active} groupingName={grouping.name} />
      <RecInactiveChip
        members={inactive}
        groupingName={grouping.name}
        owningItem={owningItem}
        menuId={menuId}
        onBringIntoMenu={onBringIntoMenu}
      />
    </>
  );
}

function RecActiveChip({
  members,
  groupingName,
}: {
  members: readonly Grouping['items'][number][];
  groupingName: string;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  const isEmpty = members.length === 0;
  const handleEnter = () => {
    if (isEmpty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), GROUPING_HOVER_DELAY_MS);
  };
  const handleLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };
  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span
        className="text-[10px] font-bold px-1.5 py-px rounded shrink-0 cursor-default"
        data-testid={`rec-active-chip-${members[0]?.id ?? 'empty'}`}
        title={isEmpty ? 'No active recommendations' : undefined}
        style={{
          background: REC_ACTIVE_PALETTE.bg,
          color: REC_ACTIVE_PALETTE.fg,
          border: `1px solid ${REC_ACTIVE_PALETTE.border}`,
          opacity: isEmpty ? 0.55 : 1,
        }}
      >
        {members.length} active {members.length === 1 ? 'rec' : 'recs'}
      </span>
      {open && !isEmpty && (
        <div
          role="tooltip"
          data-testid="rec-active-chip-popover"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 w-64 max-h-72 overflow-y-auto rounded shadow-lg"
          style={{
            background: 'var(--white, #fff)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          }}
        >
          <div className="p-2">
            <div className="text-xs font-semibold mb-1 truncate">
              Active · {groupingName}
            </div>
            <ul className="ml-1 space-y-0.5">
              {members.map((m) => (
                <li key={m.id} className="text-[10px] text-[var(--text2)] truncate">
                  • {m.name ?? '(unnamed)'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// Grace period between mouseleave-on-chip and popover close — gives the
// cursor enough time to travel from the chip to the popover (which is
// portal'd outside the chip's DOM tree, so there's no shared container
// keeping it open via normal hover bubbling).
const REC_POPOVER_LEAVE_GRACE_MS = 200;

function RecInactiveChip({
  members,
  groupingName,
  owningItem,
  menuId,
  onBringIntoMenu,
}: {
  members: readonly Grouping['items'][number][];
  groupingName: string;
  owningItem: MenuItemDisplay;
  menuId: string;
  onBringIntoMenu?: (memberId: string, ownerMenuId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  // SSR guard — createPortal needs `document`, which doesn't exist in
  // the Next.js server render pass. Defer the portal until the client
  // mount finishes; the first paint is a chip without a popover, which
  // is the correct initial state anyway.
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEmpty = members.length === 0;

  useEffect(() => {
    setMounted(true);
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const cancelTimers = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // Hover-open mirrors the legacy GroupingChip 500ms delay. mouseleave
  // schedules close after a grace period so the cursor can reach the
  // portal'd popover; entering the popover cancels the pending close.
  const handleTriggerEnter = () => {
    if (isEmpty) return;
    cancelTimers();
    openTimerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
      setOpen(true);
      openTimerRef.current = null;
    }, GROUPING_HOVER_DELAY_MS);
  };

  const handleTriggerLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, REC_POPOVER_LEAVE_GRACE_MS);
  };

  const handlePopoverEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handlePopoverLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, REC_POPOVER_LEAVE_GRACE_MS);
  };

  // STR-858 — tap toggles the popover. Hover is unreachable on touch, which
  // stranded the "Bring into Menu" action inside this popover on a phone. Tap is
  // additive (desktop hover still works); stopPropagation keeps the row collapsed.
  const handleTriggerClick = () => {
    if (isEmpty) return;
    cancelTimers();
    if (open) { setOpen(false); return; }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
    setOpen(true);
  };

  const popoverNode = open && !isEmpty && anchor ? (
    <div
      role="dialog"
      aria-label={`Inactive recommendations for ${owningItem.name ?? 'item'}`}
      data-testid="rec-inactive-chip-popover"
      onMouseEnter={handlePopoverEnter}
      onMouseLeave={handlePopoverLeave}
      // Stop clicks inside the popover from bubbling back to the row's
      // expand button (which is the chip's ancestor before the portal).
      onClick={(e) => e.stopPropagation()}
      // position: fixed against the trigger's viewport coords. z-[60]
      // beats the legacy GroupingChip popover (z-50) so the inactive
      // popover wins if a row has both active and inactive open at once.
      style={{
        position: 'fixed',
        top: anchor.top,
        left: anchor.left,
        zIndex: 60,
        minWidth: 260,
        maxWidth: 360,
        maxHeight: 320,
        overflowY: 'auto',
        background: 'var(--white, #fff)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
        color: 'var(--text)',
      }}
    >
      <div className="p-2">
        <div className="text-xs font-semibold mb-2 truncate">
          Inactive · {groupingName}
        </div>
        <ul className="space-y-1">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span
                className="truncate flex-1 min-w-0 text-[var(--text)]"
                title={m.name ?? ''}
              >
                {m.name ?? '(unnamed)'}
              </span>
              {onBringIntoMenu && m.menu_item_id ? (
                <button
                  type="button"
                  data-testid={`menu-builder-bring-into-menu-${m.menu_item_id}`}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap"
                  onClick={(e) => {
                    e.stopPropagation();
                    const memberItemId = m.menu_item_id;
                    if (!memberItemId) return;
                    onBringIntoMenu(memberItemId, menuId);
                    setOpen(false);
                  }}
                  style={{
                    background: 'var(--orange-bg, #ffedd5)',
                    color: 'var(--orange-text, #9a3412)',
                    border: '1px solid var(--orange-text, #fb923c)',
                    cursor: 'pointer',
                  }}
                >
                  Bring into Menu
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  ) : null;

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleTriggerEnter}
      onMouseLeave={handleTriggerLeave}
      onClick={(e) => { e.stopPropagation(); handleTriggerClick(); }}
    >
      <span
        className="text-[10px] font-bold px-1.5 py-px rounded shrink-0 cursor-default"
        data-testid={`rec-inactive-chip-${owningItem.id}`}
        title={isEmpty ? 'No inactive recommendations' : undefined}
        style={{
          background: REC_INACTIVE_PALETTE.bg,
          color: REC_INACTIVE_PALETTE.fg,
          border: `1px solid ${REC_INACTIVE_PALETTE.border}`,
          opacity: isEmpty ? 0.55 : 1,
        }}
      >
        {members.length} inactive {members.length === 1 ? 'rec' : 'recs'}
      </span>
      {mounted && popoverNode
        ? createPortal(popoverNode, document.body)
        : null}
    </div>
  );
}

// ── Row chrome helpers (Owner Portal redesign, 2026-11-10) ───────────────────

/** "Butter Chicken" → "BC"; "Kulfi" → "KU". The 36px tile the design draws
 *  when a dish has no photo. Exported for unit tests only. */
export function initialsOf(name: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The row's "⋯" menu: edit price & promotion (the editor drawer), hide/show
 * to guests (the item's global availability — the same 86 the mobile row
 * button toggles), Includes & choose-one (expands the per-menu zones), and
 * Remove from this menu / this sub-category (the scoped trash that used to be
 * the row's own red button; same ids, same title/aria contract).
 */
function RowMenu({
  itemId,
  itemName,
  active,
  subLabel,
  showSides,
  onEdit,
  onToggleActive,
  onSides,
  onRemove,
}: {
  itemId: string;
  itemName: string;
  active: boolean;
  /** Real raw sub-category the row sits under (scopes the remove action). */
  subLabel?: string;
  showSides: boolean;
  onEdit: () => void;
  onToggleActive?: () => void;
  onSides: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const scoped = !!subLabel && subLabel !== UNGROUPED_KEY;
  const entry = (
    testId: string,
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts: { danger?: boolean; title?: string; ariaLabel?: string } = {},
  ) => (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      title={opts.title}
      aria-label={opts.ariaLabel}
      onClick={(e) => { e.stopPropagation(); setOpen(false); onClick(); }}
      className={`w-full flex items-center gap-2.5 h-9 px-3 text-left text-[13px] bg-transparent border-0 rounded-ctl cursor-pointer hover:bg-surface2 ${opts.danger ? 'text-bad' : 'text-ink'}`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div ref={rootRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid={`menu-row-menu-${itemId}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${itemName}`}
        title="More actions"
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 inline-flex items-center justify-center rounded-ctl border-0 bg-transparent text-ink-soft hover:bg-surface hover:text-ink cursor-pointer"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          data-testid={`menu-row-menu-list-${itemId}`}
          className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[230px] p-1.5 bg-surface border border-line rounded-card shadow-float"
        >
          {entry(`menu-row-edit-${itemId}`, 'Edit price & promotion', <Pencil size={14} aria-hidden="true" />, onEdit)}
          {onToggleActive && entry(
            `menu-row-visibility-${itemId}`,
            active ? 'Hide from guests' : 'Show to guests',
            active ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />,
            onToggleActive,
            { title: active ? '86 — hide on all menus' : 'Restore on all menus' },
          )}
          {showSides && entry(`menu-row-sides-${itemId}`, 'Includes & choose-one', <ListTree size={14} aria-hidden="true" />, onSides)}
          {entry(
            `remove-from-menu-${itemId}`,
            scoped ? `Remove from “${subLabel}”` : 'Remove from this menu',
            <Trash2 size={14} aria-hidden="true" />,
            onRemove,
            {
              danger: true,
              title: scoped ? `Remove from “${subLabel}”` : 'Remove from menu',
              ariaLabel: scoped ? `Remove ${itemName} from sub-category ${subLabel}` : `Remove ${itemName} from menu`,
            },
          )}
        </div>
      )}
    </div>
  );
}

// ── MenuItemRow ───────────────────────────────────────────────────────────────

function MenuItemRow({
  item,
  menuId,
  cat,
  subLabel,
  settings,
  itemsById,
  menus,
  onUpdateSettings,
  onUpdateModifiers,
  onConfirmRecommendationDrop,
  onBringIntoMenu,
  byoHandlers,
  showAddons = true,
  showRecommendations = true,
  showAddGrouping = true,
  perMenuSides,
  showIncludeZones = true,
  rowChrome,
  onConfirmIncludeDrop,
  onDragStart,
  onDragEnd,
  onRemove,
  onEdit,
  onToggleActive,
  onMove,
  disableDrag = false,
  reorderHandle,
}: {
  item: MenuItemDisplay;
  menuId: string;
  cat: string;
  /** The raw sub-category group this row is rendered under, when nested. Used
   *  only to label the trash button so it reads "Remove from <sub-category>"
   *  rather than "Remove from menu" — the scoped removal logic itself lives in
   *  the parent's onRemove. Undefined / UNGROUPED_KEY ⇒ whole-menu removal. */
  subLabel?: string;
  settings: MenuItemJunctionSettings;
  itemsById: Map<string, MenuItemDisplay>;
  /** All menus on the restaurant — drives the Active vs Inactive Recs
   *  classification on the rec chips (browser-tz schedule eval). When
   *  omitted, the rec chips fall back to the legacy single-chip render. */
  menus?: readonly MenuSummary[];
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /** Click handler for the per-row "Bring into Menu" button in the
   *  Inactive Recs popover. Receives the rec target (the off-menu rec)
   *  + the menu the row is currently being edited under. The consumer
   *  wires this to the same useCategoryPromptForRecommendationDrop
   *  hook the drag flow uses — so the canonical-category modal opens
   *  exactly as it does for an Includes/Choose-One drop. When omitted,
   *  the button doesn't render (waiter / admin apps). */
  onBringIntoMenu?: (memberId: string, ownerMenuId: string) => void;
  /** BYO PDD Step 7b — forwarded to MobileItemModifierPicker only. */
  byoHandlers?: import('./ItemModifierZones').BYOHandlers;
  /** Forwarded to MobileItemModifierPicker. Default true. */
  showAddons?: boolean;
  showRecommendations?: boolean;
  /** Forwarded to MobileItemModifierPicker — gates the [+ Add grouping] button. Default true. */
  showAddGrouping?: boolean;
  /** PDD 2026-05-15 v2 — per-menu sides adapter forwarded to desktop ItemModifierZones. */
  perMenuSides?: import('./ItemModifierZones').PerMenuSidesAdapter;
  /** `menu_include_zones` flag — when false the desktop ItemModifierZones
   *  block is not rendered at all. Default true. */
  showIncludeZones?: boolean;
  /** Optional desktop row chrome (owner Menu workspace, 2026-11-11). When set,
   *  a collapsed desktop row renders this instead of the default grip · tile ·
   *  name · price · Visible · ⋯ line; the row keeps its drag source, expanded
   *  settings panel and handlers. Admin and waiter leave it unset. */
  rowChrome?: (p: MenuRowChromeProps) => React.ReactNode;
  onConfirmIncludeDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onRemove: () => void;
  onEdit: () => void;
  /** STR-858 — mobile-only 1-tap 86/restore. Pre-bound by the caller to toggle
   *  this item's global availability. Undefined ⇒ control not rendered (desktop
   *  / consumers that don't wire it). */
  onToggleActive?: () => void;
  /** STR-858 — mobile-only "Move to…" (re-file this row's course). Pre-bound. */
  onMove?: () => void;
  /** PDD 2026-05-22 — when bulk-selection is enabled, drag-to-move-
   *  between-buckets is suppressed so it doesn't fight the bulk
   *  selection UX. */
  disableDrag?: boolean;
  /** Forwarded to the row chrome (workspace dish reorder grip). */
  reorderHandle?: { onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void };
}) {
  // Item library search (highlight mode): null = no search running.
  const highlight = useBuilderSearchHighlight();
  const searchMatch: boolean | null = highlight ? highlight.matchIds.has(item.id) : null;
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();
  const trackAction = useTrackAction();

  // Per-category price overrides — when the item appears in 2+ canonical
  // categories on this menu, the owner gets one input per category. When it's
  // in a single category (or none), fall back to the single "Menu price" input.
  const canonicalCats = useMemo(
    () => [...(settings.canonical_categories ?? [])].sort(),
    [settings.canonical_categories],
  );
  const multiCat = canonicalCats.length > 1;

  function initialPerCategoryStrs(): Record<string, string> {
    const next: Record<string, string> = {};
    for (const cat of canonicalCats) {
      const override = settings.category_prices?.[cat];
      next[cat] = override != null
        ? String(override)
        : settings.price != null
          ? String(settings.price)
          : '';
    }
    return next;
  }

  // Per-category helpers for boost/special/portion — used by both initial
  // useState values and the STR-262 re-sync effect.
  function effectiveChefsSpecial(): boolean {
    if (multiCat) return settings.category_chefs_specials?.[cat] ?? settings.chefs_special ?? false;
    return settings.chefs_special ?? false;
  }
  function effectivePortionType(): 'single' | 'shared' {
    if (multiCat) return settings.category_portions?.[cat]?.portion_type ?? settings.portion_type ?? 'single';
    return settings.portion_type ?? 'single';
  }
  function effectivePortionServes(): string {
    const serves = multiCat
      ? (settings.category_portions?.[cat]?.portion_serves ?? settings.portion_serves)
      : settings.portion_serves;
    return serves != null ? String(serves) : '';
  }

  // Local controlled state for inline form
  // STR-1275: the restaurant's currency symbol. Falls back to '$' when no
  // CurrencyProvider is mounted (qrate-admin-webapp), i.e. today's behaviour.
  const currencySymbol = useCurrencySymbol();
  // STR-1274: the parse error for the inline price cells. The cell is ~60px
  // so there is no room for a message element; the field goes red and carries
  // the reason in title/aria-invalid, and crucially we DO NOT save.
  const [priceInvalid, setPriceInvalid] = useState<string | null>(null);
  const [priceStr, setPriceStr] = useState(
    settings.price != null ? String(settings.price) : '',
  );
  const [categoryPriceStrs, setCategoryPriceStrs] = useState<Record<string, string>>(
    initialPerCategoryStrs,
  );
  const [chefsSpecial, setChefsSpecial] = useState(effectiveChefsSpecial);
  const [portionType, setPortionType] = useState<'single' | 'shared'>(effectivePortionType);
  const [portionServes, setPortionServes] = useState(effectivePortionServes);

  // Per-menu WINE serving PRICE override (PDD 2026-06-15). The servings (Glass/
  // Bottle …) come from the item-level menu_items.serving_options; this row lets
  // the owner override each serving's PRICE for THIS menu. One $ field per
  // serving; held in DOLLARS, persisted as cents in serving_price_overrides.
  const servingOptions = asArray<ServingOption>(item.serving_options);
  const hasServingOptions = servingOptions.length > 0;
  const isWine = item.food_tags?.beverage?.beverage_type?.toLowerCase() === 'wine';
  const useWineFallback = isWine && !hasServingOptions;
  // The item's own default price for a serving id, with no override applied
  // -- serving_options.price_cents when it has one, or (bottle-only wine
  // convention, see the wine-prices fallback below) the flat item.price for
  // 'bottle'. null when there is genuinely nothing to default to (e.g.
  // 'glass' on a wine with no serving_options at all).
  const defaultCentsFor = (sid: string): number | null => {
    const opt = servingOptions.find((s) => s.id === sid);
    if (opt) return opt.price_cents ?? null;
    if (useWineFallback && sid === 'bottle' && item.price != null) return Math.round(item.price * 100);
    return null;
  };
  const buildServingStrs = (): Record<string, string> => {
    const o: Record<string, string> = {};
    for (const s of servingOptions) {
      const override = settings.serving_price_overrides?.[s.id];
      const cents = override != null ? override : defaultCentsFor(s.id);
      o[s.id] = cents != null ? String(cents / 100) : '';
    }
    if (useWineFallback) {
      const spo = settings.serving_price_overrides ?? {};
      const glassCents = spo['glass'] != null ? spo['glass'] : defaultCentsFor('glass');
      const bottleCents = spo['bottle'] != null ? spo['bottle'] : defaultCentsFor('bottle');
      o['glass'] = glassCents != null ? String(glassCents / 100) : '';
      o['bottle'] = bottleCents != null ? String(bottleCents / 100) : '';
    }
    return o;
  };
  const [servingPriceStrs, setServingPriceStrs] = useState<Record<string, string>>(buildServingStrs);

  // STR-262: Re-sync local form state when settings prop changes externally
  // (e.g. when the useEffect rebuild in MenuManagerClient overwrites
  // junctionSettings). Without this, local state becomes stale after any
  // items state change. Per-category values are used for multiCat items so
  // each bucket row stays independent.
  const prevSettingsRef = useRef(settings);
  useEffect(() => {
    if (prevSettingsRef.current !== settings) {
      setPriceStr(settings.price != null ? String(settings.price) : '');
      setCategoryPriceStrs(initialPerCategoryStrs());
      setChefsSpecial(effectiveChefsSpecial());
      setPortionType(effectivePortionType());
      setPortionServes(effectivePortionServes());
      setServingPriceStrs(buildServingStrs());
      prevSettingsRef.current = settings;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // For multiCat items, each bucket row reads the per-category boost so that
  // the Appetizers row can show a different boost than the Entrees row for the
  // same item. Falls back to the shared boost when no category override exists.
  const effectiveBoostStr = multiCat
    ? (settings.category_boost_levels?.[cat] ?? settings.boost_level)
    : settings.boost_level;
  const boostLabel = intToBoostLabel(
    typeof effectiveBoostStr === 'number'
      ? effectiveBoostStr
      : effectiveBoostStr != null
        ? Number(effectiveBoostStr)
        : null,
  );

  async function save(patch: MenuItemJunctionSettings) {
    setSaving(true);
    try {
      await onUpdateSettings(menuId, item.id, patch);
    } finally {
      setSaving(false);
    }
  }

  function handlePriceBlur() {
    // STR-1274: this used parseFloat, which reads "1,200" as **1** — not NaN,
    // so the old isNaN guard never fired and the dish was saved at one rupee.
    // Keep what the owner typed and mark the field invalid rather than
    // snapping back silently; an empty field still legitimately means "no
    // per-menu override, charge the base price".
    const parsed = parsePriceInput(priceStr);
    if (!parsed.ok) {
      setPriceInvalid(parsed.error);
      return;
    }
    setPriceInvalid(null);
    const val = parsed.value;
    setPriceStr(val == null ? '' : String(val));
    if (val === settings.price) return;
    trackAction('menu.menuBuilder.inlineEditPrice', {
      metadata: { itemId: item.id, menuId, newPrice: val },
    });
    save({ price: val });
  }

  // Per-category price blur: patch ONLY this category in the saved map.
  // We start from the last persisted settings.category_prices so that editing
  // one category never clobbers another category's price. Backend uses
  // replace-semantics so we always send the full map.
  function handleCategoryPriceBlur(cat: string) {
    const raw = categoryPriceStrs[cat] ?? '';
    // STR-1274: see handlePriceBlur — parseFloat("1,200") is 1, not NaN.
    const parsedCat = parsePriceInput(raw);
    if (!parsedCat.ok) {
      setPriceInvalid(parsedCat.error);
      return;
    }
    setPriceInvalid(null);
    const val = parsedCat.value;
    setCategoryPriceStrs((prevState) => ({
      ...prevState,
      [cat]: val == null ? '' : String(val),
    }));
    // Patch only this category; preserve all other saved overrides unchanged.
    const currentOverrides = settings.category_prices ?? {};
    if (val === (currentOverrides[cat] ?? null)) return; // no-op
    const nextOverrides: Record<string, number> = { ...currentOverrides };
    if (val != null) {
      nextOverrides[cat] = val;
    } else {
      delete nextOverrides[cat];
    }
    trackAction('menu.menuBuilder.inlineEditCategoryPrice', {
      metadata: { itemId: item.id, menuId, category: cat, newPrice: val },
    });
    // Always send all maps together — see handleBoostChange comment.
    save({
      category_prices:         nextOverrides,
      category_boost_levels:   settings.category_boost_levels ?? {},
      category_chefs_specials: settings.category_chefs_specials ?? {},
      category_portions:       settings.category_portions ?? {},
    });
  }

  // Per-menu wine serving price blur (PDD 2026-06-15): patch ONLY this serving's
  // override in the saved map (replace-semantics — send the full map). Dollars
  // in the input → cents in serving_price_overrides. Empty clears that serving's
  // override (falls back to the item-level price).
  function handleServingPriceBlur(servingId: string) {
    const raw = servingPriceStrs[servingId] ?? '';
    const dollars = raw.trim() === '' ? null : parseFloat(raw);
    if (raw.trim() !== '' && (dollars === null || isNaN(dollars) || dollars < 0)) {
      const saved = settings.serving_price_overrides?.[servingId];
      const fallbackCents = saved != null ? saved : defaultCentsFor(servingId);
      setServingPriceStrs((prev) => ({ ...prev, [servingId]: fallbackCents != null ? String(fallbackCents / 100) : '' }));
      return;
    }
    const cents = dollars != null ? Math.round(dollars * 100) : null;
    const current = settings.serving_price_overrides ?? {};
    const existingOverride = current[servingId] ?? null;
    // No-op guard: the field now shows the item's real default price (not a
    // placeholder hint) as soon as it's rendered -- tabbing/clicking through
    // it without changing anything must not write a redundant override.
    if (existingOverride === null && cents === defaultCentsFor(servingId)) return;
    if (cents === existingOverride) return; // already matches saved override -- no-op
    const next: Record<string, number> = { ...current };
    if (cents != null) next[servingId] = cents;
    else delete next[servingId];
    trackAction('menu.menuBuilder.inlineEditServingPrice', {
      metadata: { itemId: item.id, menuId, servingId, newPriceCents: cents },
    });
    save({ serving_price_overrides: next });
  }

  function handleBoostChange(label: string | null) {
    const newLevel = label == null ? null : String(BOOST_LABELS.indexOf(label as typeof BOOST_LABELS[number]) + 1);
    trackAction('menu.menuBuilder.setBoost', {
      metadata: { itemId: item.id, menuId, category: multiCat ? cat : undefined, level: label },
    });
    if (multiCat) {
      // Backend uses replace-semantics (DELETE + INSERT) across all four maps.
      // Always send all maps together so saving one field never wipes the others.
      const nextLevels = { ...(settings.category_boost_levels ?? {}) };
      if (newLevel != null) {
        nextLevels[cat] = newLevel;
      } else {
        delete nextLevels[cat];
      }
      save({
        category_boost_levels:   nextLevels,
        category_chefs_specials: settings.category_chefs_specials ?? {},
        category_portions:       settings.category_portions ?? {},
        category_prices:         settings.category_prices ?? {},
      });
    } else {
      save({ boost_level: newLevel });
    }
  }

  function handleChefsSpecial() {
    const next = !chefsSpecial;
    trackAction('menu.menuBuilder.toggleSpecial', {
      metadata: { itemId: item.id, menuId, category: multiCat ? cat : undefined, next },
    });
    setChefsSpecial(next);
    if (multiCat) {
      // Always send all maps together — see handleBoostChange comment.
      save({
        category_chefs_specials: { ...(settings.category_chefs_specials ?? {}), [cat]: next },
        category_boost_levels:   settings.category_boost_levels ?? {},
        category_portions:       settings.category_portions ?? {},
        category_prices:         settings.category_prices ?? {},
      });
    } else {
      save({ chefs_special: next });
    }
  }

  function handlePortionType(type: 'single' | 'shared') {
    trackAction('menu.menuBuilder.togglePortion', {
      metadata: { itemId: item.id, menuId, category: multiCat ? cat : undefined, type },
    });
    setPortionType(type);
    if (multiCat) {
      // Always send all maps together — see handleBoostChange comment.
      const nextPortions = { ...(settings.category_portions ?? {}) };
      nextPortions[cat] = {
        portion_type: type,
        portion_serves: type === 'single' ? null : (nextPortions[cat]?.portion_serves ?? null),
      };
      if (type === 'single') setPortionServes('');
      save({
        category_portions:       nextPortions,
        category_boost_levels:   settings.category_boost_levels ?? {},
        category_chefs_specials: settings.category_chefs_specials ?? {},
        category_prices:         settings.category_prices ?? {},
      });
    } else {
      const patch: MenuItemJunctionSettings = { portion_type: type };
      if (type === 'single') patch.portion_serves = null;
      save(patch);
    }
  }

  function handlePortionServesBlur() {
    const val = portionServes.trim() === '' ? null : parseInt(portionServes, 10);
    if (portionServes.trim() !== '' && isNaN(val!)) {
      setPortionServes(effectivePortionServes());
      return;
    }
    const currentServes = multiCat
      ? (settings.category_portions?.[cat]?.portion_serves ?? settings.portion_serves)
      : settings.portion_serves;
    if (val === currentServes) return;
    if (multiCat) {
      // Always send all maps together — see handleBoostChange comment.
      const nextPortions = { ...(settings.category_portions ?? {}) };
      nextPortions[cat] = {
        portion_type: nextPortions[cat]?.portion_type ?? portionType,
        portion_serves: val,
      };
      save({
        category_portions:       nextPortions,
        category_boost_levels:   settings.category_boost_levels ?? {},
        category_chefs_specials: settings.category_chefs_specials ?? {},
        category_prices:         settings.category_prices ?? {},
      });
    } else {
      save({ portion_serves: val });
    }
  }

  // For multiCat items, show the category-specific price in the collapsed row
  // so each bucket reflects its own price independently.
  //
  // Wine items price By Glass / By Bottle instead of a flat price (mirrors
  // the expanded section's isWine/useWineFallback branching above) — the
  // collapsed badge must read serving_price_overrides, not settings.price,
  // or it silently shows the wrong (unrelated) flat price for wine.
  const wineGlassOverrideCents = settings.serving_price_overrides?.['glass'];
  const wineBottleOverrideCents = settings.serving_price_overrides?.['bottle'];
  const hasWinePriceOverride = wineGlassOverrideCents != null || wineBottleOverrideCents != null;
  // 2026-09-04: no per-menu override yet is the NORMAL state for a freshly
  // imported/committed wine — fall back to the item's own price (same
  // "falls back to the item-level price" contract handleServingPriceBlur
  // already documents for the expanded editor) instead of showing nothing.
  // serving_options carries a glass/bottle split; a bottle-only wine (no
  // serving_options at all) carries its single price on the flat
  // menu_items.price column instead.
  const itemServingOptions = asArray<ServingOption>(item.serving_options);
  const itemGlassCents = itemServingOptions.find((s) => s.id === 'glass')?.price_cents;
  const itemBottleCents = itemServingOptions.find((s) => s.id === 'bottle')?.price_cents;
  const fallbackBottleCents = itemServingOptions.length === 0 && item.price != null
    ? Math.round(item.price * 100)
    : undefined;
  const wineGlassCents = wineGlassOverrideCents ?? itemGlassCents;
  const wineBottleCents = wineBottleOverrideCents ?? itemBottleCents ?? fallbackBottleCents;
  const effectivePrice = multiCat
    ? (settings.category_prices?.[cat] ?? settings.price ?? item.price)
    : (settings.price ?? item.price);
  // Explicit \u00A0 (non-breaking space) around the separator — a plain
  // ASCII space collapses to a single space in rendered HTML text content,
  // so extra literal spaces here would have no visual effect.
  const WINE_PRICE_SEPARATOR = '\u00A0\u00A0·\u00A0\u00A0';
  const displayPrice = isWine
    ? ([
        wineGlassCents != null ? `Glass ${currencySymbol}${(wineGlassCents / 100).toFixed(2)}` : null,
        wineBottleCents != null ? `Bottle ${currencySymbol}${(wineBottleCents / 100).toFixed(2)}` : null,
      ].filter(Boolean).join(WINE_PRICE_SEPARATOR) || null)
    : (effectivePrice != null ? `${currencySymbol}${Number(effectivePrice).toFixed(2)}` : null);
  const displayPriceIsOverride = isWine
    ? hasWinePriceOverride
    : (multiCat ? settings.category_prices?.[cat] != null : settings.price != null);

  const attention = itemHasAttention(item, settings);
  // Approved-only count — AI-suggested addons that the owner hasn't accepted
  // yet are excluded from the row badge so the number reflects the live menu.
  const approvedAddons = countApprovedAddons(item);
  // Unified per-grouping chip cluster — replaces the legacy sides/recs/addons
  // counters. Each non-empty grouping renders as its own chip with a hover
  // popover listing members. Empty groupings (count === 0) are filtered out
  // by GroupingChip itself.
  const groupings = asArray<Grouping>(item.groupings);
  const hasAnyGroupingChip = groupings.some((g) => visibleItems(g).length > 0);

  // Desktop row chrome (Owner Portal redesign, 2026-11-10): the design's row is
  // grip · 36px tile · name · price · Visible/Hidden pill · ⋯ — the whole row
  // opens the item editor (`edit-menu-item-<id>` is now the row body, not a
  // pencil), the chevron still expands the per-menu settings (price / boost /
  // chef's special / portion + Includes zones, which the E2E item-settings specs
  // drive through `menu-item-expand-<id>`), and the row's edit / 86 / remove
  // actions moved into the ⋯ menu. The mobile row (STR-858) is unchanged.
  const badges = (
    <>
      {chefsSpecial && (
        <Star size={12} fill={COLOR_WARNING} color={COLOR_WARNING} data-testid={`chefs-special-badge-${item.id}`} aria-label="Chef's special" />
      )}
      {boostLabel && (
        <span className="inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold bg-ok-bg text-ok whitespace-nowrap" data-testid={`boost-badge-${item.id}`}>
          {boostLabel}
        </span>
      )}
      {displayPrice && (
        <span
          className={`text-sm font-semibold whitespace-nowrap ${displayPriceIsOverride ? 'text-ink' : 'text-ink-soft'}`}
          style={{ fontVariantNumeric: 'tabular-nums' }}
          data-testid={`price-display-${item.id}`}
          data-override={displayPriceIsOverride ? 'true' : undefined}
          title={displayPriceIsOverride ? 'Price set on this menu' : 'Base price from the item library'}
        >
          {displayPrice}
          {displayPriceIsOverride && <span className="text-[9px] ml-0.5" aria-hidden="true">↑</span>}
        </span>
      )}
      {cat === 'Desserts' && SWEETNESS_VISIBLE && item.food_tags?.sweetness_label && (
        <span className="inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold bg-surface2 text-ink-soft whitespace-nowrap">
          ✦ {item.food_tags.sweetness_label}
        </span>
      )}
      {saving && (
        <span className="text-xs text-ink-faint">saving…</span>
      )}
    </>
  );

  return (
    <div
      data-testid={`menu-item-row-${item.id}`}
      data-item-row-id={item.id}
      data-search={searchMatch === null ? undefined : searchMatch ? 'match' : 'dim'}
      data-expanded={expanded ? 'true' : 'false'}
      data-attention={attention ? 'true' : undefined}
      data-approved-addons={approvedAddons > 0 ? approvedAddons : undefined}
      // Drag a collapsed row to MOVE it between courses or file it under a raw
      // sub-category (PDD 2026-06-12 #6). Disabled while bulk-selecting (drag
      // would fight the checkbox UX) and while expanded (the editing UI owns the
      // pointer). onDragStart carries this row's menu + course so the drop target
      // can move/file it.
      draggable={!disableDrag && !expanded}
      onDragStart={
        !disableDrag && !expanded
          ? (e) => onDragStart(e, item.id, menuId, cat)
          : undefined
      }
      onDragEnd={!disableDrag && !expanded ? onDragEnd : undefined}
      className={`w-full border-b border-line-row ${expanded ? 'bg-surface2/40' : ''} ${
        searchMatch === true
          ? 'bg-[var(--surface-sunk)] shadow-[inset_3px_0_0_var(--accent)]'
          : searchMatch === false ? 'opacity-45 transition-opacity' : ''
      }`}
      style={{
        borderLeft: `3px solid ${attention ? 'var(--bad)' : 'transparent'}`,
        // grab cursor signals a collapsed row is draggable (drag onto a course
        // to MOVE it, or into a sub-category to file it — PDD #6). Only when the
        // row is actually draggable, so editing/bulk-select rows keep default.
        cursor: !disableDrag && !expanded ? 'grab' : undefined,
      }}
    >
      {isMobile ? (
      <div className="flex items-stretch w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`menu-item-expand-${item.id}`}
        data-expand-btn="true"
        className="flex-1 min-w-0 bg-transparent border-none cursor-pointer text-left flex flex-col gap-1 px-2 py-2"
      >
            {/* Mobile row 1 — chevron + full-width name + badges */}
            <div className="flex items-center gap-1.5 w-full min-w-0">
              <span className="text-ink-soft shrink-0">
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
              <span className="text-sm font-semibold text-ink overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
                {item.name}
              </span>
              {/* Badges */}
              <div className="flex items-center gap-1 shrink-0">
                {badges}
                {!item.active && (
                  <span className="inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold bg-bad-bg text-bad">86'd</span>
                )}
              </div>
            </div>

            {/* Mobile row 2 — one chip per non-empty grouping */}
            {hasAnyGroupingChip && (
              <div className="flex flex-wrap items-center gap-1.5 pl-5 w-full">
                {groupings.map((g) =>
                  g.kind === 'recommendations' && menus ? (
                    <RecGroupingChips
                      key={g.id}
                      grouping={g}
                      owningItem={item}
                      menuId={menuId}
                      itemsById={itemsById}
                      menus={menus}
                      onBringIntoMenu={onBringIntoMenu}
                    />
                  ) : (
                    <GroupingChip key={g.id} grouping={g} />
                  ),
                )}
              </div>
            )}
      </button>

      {/* STR-858 — mobile-only 1-tap 86 / restore (the #1 in-shift action).
          A dedicated tap target outside the expand button, so it never expands
          the row. Ban = 86 it (hide everywhere); RotateCcw = restore. 44px
          touch target. */}
      {onToggleActive && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleActive(); }}
          data-testid={`menu-item-86-toggle-${item.id}`}
          aria-label={item.active ? `86 (hide) ${item.name} on all menus` : `Restore ${item.name}`}
          title={item.active ? '86 — hide on all menus' : 'Restore'}
          className={`shrink-0 w-11 p-0 bg-transparent border-none border-l border-l-line cursor-pointer flex items-center justify-center ${item.active ? 'text-ink-soft hover:text-bad' : 'text-bad'}`}
        >
          {item.active ? <Ban size={16} /> : <RotateCcw size={16} />}
        </button>
      )}

      {/* STR-858 — mobile-only "Move to…" (re-file this row's course via the tap
          course picker; native drag is dead on touch). 44px target. */}
      {onMove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMove(); }}
          data-testid={`menu-item-move-${item.id}`}
          aria-label={`Move ${item.name} to another course`}
          title="Move to another course"
          className="shrink-0 w-11 p-0 bg-transparent border-none border-l border-l-line text-ink-soft cursor-pointer flex items-center justify-center hover:text-ink"
        >
          <FolderInput size={16} />
        </button>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        data-testid={`edit-menu-item-${item.id}`}
        aria-label={`Edit ${item.name}`}
        title="Edit item"
        className="shrink-0 w-11 p-0 bg-transparent border-none border-l border-l-line text-ink-soft cursor-pointer flex items-center justify-center hover:text-ink"
      >
        <Pencil size={18} />
      </button>

      {(() => {
        // Scoped trash: when the row sits under a real raw sub-category, the
        // trash removes the item from THAT sub-category only (parent onRemove);
        // otherwise (Ungrouped / flat bucket) it removes from the menu.
        const scoped = !!subLabel && subLabel !== UNGROUPED_KEY;
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            data-testid={`remove-from-menu-${item.id}`}
            aria-label={scoped ? `Remove ${item.name} from sub-category ${subLabel}` : `Remove ${item.name} from menu`}
            title={scoped ? `Remove from “${subLabel}”` : 'Remove from menu'}
            className="shrink-0 w-11 p-0 bg-transparent border-none border-l border-l-line text-bad cursor-pointer flex items-center justify-center hover:opacity-70"
          >
            <Trash2 size={18} />
          </button>
        );
      })()}
      </div>
      ) : (
      rowChrome ? (
        <>{rowChrome({
          item,
          searchQuery: searchMatch ? highlight!.query : undefined,
          menuId,
          cat,
          settings,
          saving,
          expanded,
          toggleExpanded: () => setExpanded((v) => !v),
          onEdit,
          active: item.active !== false,
          onToggleActive,
          boost: boostLabel,
          onBoostChange: handleBoostChange,
          chefsSpecial,
          onToggleChefsSpecial: handleChefsSpecial,
          portionType,
          onPortionType: handlePortionType,
          price: {
            display: displayPrice,
            isOverride: displayPriceIsOverride,
            editable: !hasServingOptions && !useWineFallback,
            value: multiCat ? (categoryPriceStrs[cat] ?? '') : priceStr,
            setValue: (v: string) => (multiCat
              ? setCategoryPriceStrs((prev) => ({ ...prev, [cat]: v }))
              : setPriceStr(v)),
            commit: () => (multiCat ? handleCategoryPriceBlur(cat) : handlePriceBlur()),
            invalid: priceInvalid,
          },
          onRemove,
          subLabel: subLabel && subLabel !== UNGROUPED_KEY ? subLabel : undefined,
          reorderHandle,
          onBringIntoMenu: onBringIntoMenu ? (memberId: string) => onBringIntoMenu(memberId, menuId) : undefined,
          inactivePairingIds: (() => {
            if (!menus) return undefined;
            const menusById = new Map(menus.map((m) => [m.id, m] as const));
            const parentActive = new Set(
              (item.menu_associations ?? []).filter((a) => a.menu_id && menusById.get(a.menu_id)?.active).map((a) => a.menu_id),
            );
            const ids = new Set<string>();
            for (const g of groupings.filter((x) => x.kind === 'recommendations')) {
              for (const m of classifyRecMembers(g.items, itemsById, menusById, parentActive).inactive) {
                if (m.menu_item_id) ids.add(m.menu_item_id);
              }
            }
            return ids;
          })(),
        })}</>
      ) : (
      <div className="flex items-center gap-2.5 min-h-[50px] w-full pl-1.5 pr-1 transition-colors hover:bg-surface2">
        {/* Grip — the visual cue that a collapsed row can be dragged (the row
            itself is the drag source, as before). */}
        <span
          aria-hidden="true"
          data-testid={`menu-item-grip-${item.id}`}
          className={`shrink-0 text-ink-faint ${!disableDrag && !expanded ? 'cursor-grab' : 'opacity-40'}`}
        >
          <GripVertical size={15} />
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`menu-item-expand-${item.id}`}
          data-expand-btn="true"
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${item.name} menu settings` : `Show ${item.name} menu settings`}
          title="Per-menu price, boost, portion & includes"
          className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-ctl border-0 bg-transparent text-ink-faint hover:text-ink hover:bg-surface cursor-pointer"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          data-testid={`edit-menu-item-${item.id}`}
          aria-label={`Edit ${item.name}`}
          title="Open the item editor"
          className="flex-1 min-w-0 flex items-center gap-3 py-1.5 bg-transparent border-0 text-left cursor-pointer text-ink"
        >
          {/* Tile — photo when the dish has one, initials otherwise. */}
          <span
            data-testid={`menu-item-tile-${item.id}`}
            className="w-9 h-9 shrink-0 rounded-ctl bg-surface2 border border-line inline-flex items-center justify-center text-[11px] font-bold text-ink-faint overflow-hidden"
          >
            {item.thumbnail_url ? (
              <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
            ) : (
              initialsOf(item.name)
            )}
          </span>
          <span className="text-sm font-semibold text-ink overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
            {item.name}
          </span>
          {/* One chip per non-empty grouping. Recommendations grouping
              renders as two chips (Active / Inactive) when the parent
              provided `menus` so we can evaluate schedule windows. */}
          <span className="flex flex-wrap items-center gap-1 shrink min-w-0">
            {groupings.map((g) =>
              g.kind === 'recommendations' && menus ? (
                <RecGroupingChips
                  key={g.id}
                  grouping={g}
                  owningItem={item}
                  menuId={menuId}
                  itemsById={itemsById}
                  menus={menus}
                  onBringIntoMenu={onBringIntoMenu}
                />
              ) : (
                <GroupingChip key={g.id} grouping={g} />
              ),
            )}
          </span>
          <span className="flex-1" />
          <span className="flex items-center gap-2 shrink-0">{badges}</span>
        </button>
        <span
          data-testid={`menu-item-visibility-${item.id}`}
          data-tone={item.active ? 'ok' : 'tag'}
          title={item.active ? 'Guests can see this item' : "86'd — hidden from guests on every menu"}
          className={`inline-flex items-center h-[22px] px-2.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 ${item.active ? 'bg-ok-bg text-ok' : 'bg-surface2 text-ink-soft'}`}
        >
          {item.active ? 'Visible' : 'Hidden'}
        </span>
        <RowMenu
          itemId={item.id}
          itemName={item.name}
          active={item.active !== false}
          subLabel={subLabel}
          showSides={showIncludeZones}
          onEdit={onEdit}
          onToggleActive={onToggleActive}
          onSides={() => setExpanded(true)}
          onRemove={onRemove}
        />
      </div>
      )
      )}

      {/* Expanded settings — info bar on top, three modifier panels below */}
      {expanded && (
        <div
          className={`flex flex-col gap-2.5 ${isMobile ? 'px-3 py-2.5 pl-4' : 'px-3 py-2.5 pl-[52px]'}`}
          data-testid={`menu-item-settings-${item.id}`}
        >
          {/* ── Info bar (one line) ─────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* Price — always a single input scoped to the current bucket (cat).
                multiCat items bind to categoryPriceStrs[cat] so the owner edits
                only the price for the category they are looking at, not all. */}
            {/* Wine serving prices (PDD 2026-06-15): one $ field per serving
                (Glass/Bottle …), overriding the item-level serving price for
                THIS menu. The field's VALUE is the item's real default price
                (serving_options.price_cents, or the flat item.price for a
                bottle-only wine — see defaultCentsFor above) whenever no
                per-menu override exists yet — not a placeholder hint, since
                that left the field reading a bare "$—" right next to a
                collapsed badge already showing the real number (2026-09-04).
                Editing it writes a real override; leaving it alone writes
                nothing (see the no-op guard in handleServingPriceBlur). */}
            {hasServingOptions ? (
              <div className="flex items-center gap-2 flex-wrap" data-testid={`serving-prices-${item.id}`}>
                {servingOptions.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <label className="section-header !mb-0 shrink-0" htmlFor={`serving-${menuId}-${item.id}-${s.id}`}>
                      {s.label}
                    </label>
                    <div className="flex items-center gap-0.5 rounded-[var(--r-xs)] bg-white px-2 py-1 border border-[var(--border)]">
                      <span className="text-xs text-[var(--text2)]">{currencySymbol}</span>
                      <input
                        id={`serving-${menuId}-${item.id}-${s.id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={servingPriceStrs[s.id] ?? ''}
                        onChange={(e) => setServingPriceStrs((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        onBlur={() => handleServingPriceBlur(s.id)}
                        placeholder="—"
                        data-testid={`serving-price-input-${item.id}-${s.id}`}
                        className="border-none outline-none text-xs w-[56px] bg-transparent text-[var(--text)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : useWineFallback ? (
              <div className="flex items-center gap-2 flex-wrap" data-testid={`wine-prices-${item.id}`}>
                {(['glass', 'bottle'] as const).map((sid) => (
                  <div key={sid} className="flex items-center gap-1">
                    <label className="section-header !mb-0 shrink-0" htmlFor={`serving-${menuId}-${item.id}-${sid}`}>
                      {sid === 'glass' ? 'Glass' : 'Bottle'}
                    </label>
                    <div className={`flex items-center gap-0.5 rounded-[var(--r-xs)] bg-white px-2 py-1 ${attention ? 'border-2 border-[var(--red)]' : 'border border-[var(--border)]'}`}>
                      <span className="text-xs text-[var(--text2)]">{currencySymbol}</span>
                      <input
                        id={`serving-${menuId}-${item.id}-${sid}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={servingPriceStrs[sid] ?? ''}
                        onChange={(e) => setServingPriceStrs((prev) => ({ ...prev, [sid]: e.target.value }))}
                        onBlur={() => handleServingPriceBlur(sid)}
                        placeholder="—"
                        data-testid={`serving-price-input-${item.id}-${sid}`}
                        className="border-none outline-none text-xs w-[56px] bg-transparent text-[var(--text)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <div className="flex items-center gap-1.5">
              <label className="section-header !mb-0 shrink-0" htmlFor={`price-${menuId}-${item.id}`}>
                Price
              </label>
              <div
                className={`flex items-center gap-0.5 rounded-[var(--r-xs)] bg-white px-2 py-1 ${attention ? 'border-2 border-[var(--red)]' : 'border border-[var(--border)]'}`}
                data-testid={`price-input-wrapper-${item.id}`}
                data-attention={attention ? 'true' : undefined}
              >
                <span className="text-xs text-[var(--text2)]">{currencySymbol}</span>
                {multiCat ? (
                  <input
                    id={`price-${menuId}-${item.id}`}
                    type="text"
                    inputMode="decimal"
                    aria-invalid={priceInvalid ? true : undefined}
                    title={priceInvalid ?? undefined}
                    value={categoryPriceStrs[cat] ?? ''}
                    onChange={(e) => { setPriceInvalid(null); setCategoryPriceStrs((prev) => ({ ...prev, [cat]: e.target.value })); }}
                    onBlur={() => handleCategoryPriceBlur(cat)}
                    placeholder={settings.price != null ? String(settings.price) : ''}
                    data-testid={`price-input-${item.id}`}
                    className={`outline-none text-xs w-[60px] bg-transparent text-[var(--text)] ${priceInvalid ? 'border border-[var(--bad)] rounded-sm' : 'border-none'}`}
                  />
                ) : (
                  <input
                    id={`price-${menuId}-${item.id}`}
                    type="text"
                    inputMode="decimal"
                    aria-invalid={priceInvalid ? true : undefined}
                    title={priceInvalid ?? undefined}
                    value={priceStr}
                    onChange={(e) => { setPriceInvalid(null); setPriceStr(e.target.value); }}
                    onBlur={handlePriceBlur}
                    placeholder={item.price != null ? String(item.price) : ''}
                    data-testid={`price-input-${item.id}`}
                    className={`outline-none text-xs w-[60px] bg-transparent text-[var(--text)] ${priceInvalid ? 'border border-[var(--bad)] rounded-sm' : 'border-none'}`}
                  />
                )}
              </div>
            </div>
            )}

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--border)] shrink-0" />

            {/* Boost dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="section-header !mb-0 shrink-0">Boost</span>
              <Select
                size="sm"
                value={boostLabel ?? ''}
                onChange={(e) => handleBoostChange(e.target.value || null)}
                data-testid={`boost-select-${item.id}`}
                options={[
                  { value: '', label: 'None' },
                  ...BOOST_LABELS.map((l) => ({ value: l, label: l })),
                ]}
                placeholder="None"
              />
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--border)] shrink-0" />

            {/* Chef's special */}
            <div className="flex items-center gap-1.5">
              <span className="section-header !mb-0 shrink-0">Chef's Special</span>
              <button
                type="button"
                onClick={handleChefsSpecial}
                data-testid={`chefs-special-toggle-${item.id}`}
                aria-pressed={chefsSpecial}
                className={`flex items-center gap-1 text-xs font-semibold py-0.5 px-2 rounded-[var(--r-xs)] cursor-pointer ${
                  chefsSpecial
                    ? 'border-2 border-amber-400 bg-amber-50 text-amber-700'
                    : 'border border-[var(--border)] bg-white text-[var(--text2)]'
                }`}
              >
                <Star size={11} fill={chefsSpecial ? COLOR_WARNING : 'none'} color={chefsSpecial ? COLOR_WARNING : 'currentColor'} />
                {chefsSpecial ? 'Featured' : 'Not featured'}
              </button>
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--border)] shrink-0" />

            {/* Portion */}
            <div className="flex items-center gap-1.5">
              <span className="section-header !mb-0 shrink-0">Portion</span>
              <div className="flex gap-1">
                {(['single', 'shared'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handlePortionType(t)}
                    data-testid={`portion-btn-${t}-${item.id}`}
                    className={`text-xs font-semibold py-0.5 px-2 rounded-[var(--r-xs)] cursor-pointer capitalize ${
                      portionType === t
                        ? 'border-2 border-[var(--blue)] bg-[var(--blue-bg)] text-[var(--blue)]'
                        : 'border border-[var(--border)] bg-white text-[var(--text2)]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {portionType === 'shared' && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={portionServes}
                    onChange={(e) => setPortionServes(e.target.value)}
                    onBlur={handlePortionServesBlur}
                    placeholder="4"
                    data-testid={`portion-serves-input-${item.id}`}
                    className="border border-[var(--border)] rounded-[var(--r-xs)] py-0.5 px-1.5 text-xs w-10 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-[var(--text2)]">guests</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Per-menu sides editor (desktop only) / Add-on + Rec picker (mobile) ── */}
          <div className="w-full">
            {isMobile ? (
              <MobileItemModifierPicker
                parent={item}
                itemsById={itemsById}
                currentMenuId={menuId}
                onUpdate={onUpdateModifiers}
                onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                showRecommendations={showRecommendations}
              />
            ) : showIncludeZones ? (
              <ItemModifierZones
                parent={item}
                itemsById={itemsById}
                currentMenuId={menuId}
                perMenuSides={perMenuSides}
                onConfirmIncludeDrop={onConfirmIncludeDrop}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── CategoryBucket ────────────────────────────────────────────────────────────

/** Max raw-category chips rendered inline on a course header before the rest
 *  collapse into a single "+N" overflow chip — keeps the row to one line. */
const MAX_RAWCAT_CHIPS = 4;

export interface BucketRawCategory { label: string; count: number }

/** Distinct raw sub-categories carried by a course's items, each with its
 *  food-item count (distinct items carrying that label in the course). Display
 *  label is the most-human variant (preferScrapedLabel); the Ungrouped sentinel
 *  is excluded. Mirrors the per-bucket sub-accordion grouping so the header
 *  chips and the accordions agree. Sorted by count desc, then label, so the
 *  most-populated sub-categories survive the inline-chip cap. */
function deriveBucketRawCategories(
  items: MenuItemDisplay[],
  getLabels: (id: string) => readonly string[] | undefined | null,
): BucketRawCategory[] {
  const byKey = new Map<string, { variants: Map<string, number>; items: Set<string> }>();
  for (const item of items) {
    const labels = getLabels(item.id);
    if (!labels) continue;
    for (const raw of labels) {
      if (!raw || raw === UNGROUPED_KEY) continue;
      const key = normalizeSubcatKey(raw);
      if (!key) continue;
      let entry = byKey.get(key);
      if (!entry) { entry = { variants: new Map(), items: new Set() }; byKey.set(key, entry); }
      entry.variants.set(raw, (entry.variants.get(raw) ?? 0) + 1);
      entry.items.add(item.id); // distinct food-item count per sub-category
    }
  }
  const out: BucketRawCategory[] = [];
  for (const entry of byKey.values()) {
    out.push({
      label: preferScrapedLabel([...entry.variants].map(([label, count]) => ({ label, count }))),
      count: entry.items.size,
    });
  }
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return out;
}

/** The action the row's trash button should take, given where the row is
 *  rendered. This is the pure decision behind MenuItemRow's onRemove:
 *
 *  - `sub-category` — the row sits under a real raw sub-category, so the trash
 *    is scoped to THAT sub-category only: drop its label (and any casing /
 *    punctuation variant of it, matched on the normalized key) from the item's
 *    raw_categories. The item stays on the menu and under any other
 *    sub-categories. `raw_categories` is the replacement array to PATCH.
 *  - `canonical-category` — no sub-category to scope to (Ungrouped / flat) and
 *    the item spans multiple canonical categories on this menu, so remove only
 *    the current category. `canonical_categories` is the replacement array.
 *  - `whole-menu` — no sub-category and the item's last/only category, so the
 *    item leaves the menu entirely.
 *
 *  The UNGROUPED_KEY sentinel is never treated as a real sub-category. */
export type RowRemoval =
  | { kind: 'sub-category'; raw_categories: string[] }
  | { kind: 'canonical-category'; canonical_categories: string[] }
  | { kind: 'whole-menu' };

function computeRowRemoval(
  settings: Pick<MenuItemJunctionSettings, 'raw_categories' | 'canonical_categories'>,
  category: string,
  subLabel: string | undefined,
): RowRemoval {
  if (subLabel && subLabel !== UNGROUPED_KEY) {
    const targetKey = normalizeSubcatKey(subLabel);
    const known = (settings.raw_categories ?? []).filter((l) => l !== UNGROUPED_KEY);
    const raw_categories = known.filter((l) => normalizeSubcatKey(l) !== targetKey);
    return { kind: 'sub-category', raw_categories };
  }
  const cats = settings.canonical_categories ?? [];
  if (cats.length > 1) {
    return { kind: 'canonical-category', canonical_categories: cats.filter((c) => c !== category) };
  }
  return { kind: 'whole-menu' };
}

function CategoryBucket({
  category,
  displayLabel,
  itemIds,
  itemsById,
  menus,
  menuId,
  collapsed,
  getSettings,
  color,
  onToggleCollapse,
  onUpdateSettings,
  onUpdateModifiers,
  onConfirmRecommendationDrop,
  onBringIntoMenu,
  byoHandlers,
  showAddons = true,
  showRecommendations = true,
  showAddGrouping = true,
  perMenuSides,
  showIncludeZones = true,
  rowChrome,
  onConfirmIncludeDrop,
  isDragOver,
  dragActive = false,
  onDragEnter,
  onDragLeave,
  onDrop,
  subCatDragOverLabel = null,
  onDragEnterSubCategory,
  onDragLeaveSubCategory,
  onDropSubCategory,
  onRenameSubCategory,
  onDeleteSubCategory,
  orderSubCategories,
  orderSubCategoryItems,
  onReorderSubCategoryItem,
  canReorderSubCategoryItems,
  showEmptySubCategoryChips,
  onReorderSubCategory,
  onCreateSubCategory,
  onDragStart,
  onDragEnd,
  onRemoveItem,
  onEditItem,
  onToggleItemActive,
  onMoveItemCourse,
  onHideCategory,
  missingPriceFilter = false,
  bulkSelectionEnabled = false,
  bulkSelection,
  onToggleBulkSelection,
  selectMode = false,
  suppressEmptyAttention = false,
  scrollToItemId,
}: {
  category: string;
  /** Optional friendly header label. Defaults to `category` (the canonical).
   *  Used by the 4-section view so a bucket can show "Drinks" while keying its
   *  drop target / collapse / price logic off the canonical "Beverages". */
  displayLabel?: string;
  itemIds: string[];
  itemsById: Map<string, MenuItemDisplay>;
  menus?: readonly MenuSummary[];
  menuId: string;
  collapsed: boolean;
  missingPriceFilter?: boolean;
  getSettings: (menuId: string, itemId: string) => MenuItemJunctionSettings;
  color: MenuColor;
  onToggleCollapse: () => void;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  onBringIntoMenu?: (memberId: string, ownerMenuId: string) => void;
  /** BYO PDD Step 7b — forwarded to ItemModifierZones via MenuItemRow. */
  byoHandlers?: import('./ItemModifierZones').BYOHandlers;
  /** Forwarded to MenuItemRow → MobileItemModifierPicker. Default true. */
  showAddons?: boolean;
  showRecommendations?: boolean;
  /** Forwarded to MenuItemRow → MobileItemModifierPicker — gates the [+ Add grouping] button. Default true. */
  showAddGrouping?: boolean;
  /** PDD 2026-05-15 v2 — per-menu sides adapter forwarded to MenuItemRow → desktop ItemModifierZones. */
  perMenuSides?: import('./ItemModifierZones').PerMenuSidesAdapter;
  /** `menu_include_zones` flag — forwarded to MenuItemRow. Default true. */
  showIncludeZones?: boolean;
  /** Optional desktop row chrome (owner Menu workspace, 2026-11-11). When set,
   *  a collapsed desktop row renders this instead of the default grip · tile ·
   *  name · price · Visible · ⋯ line; the row keeps its drag source, expanded
   *  settings panel and handlers. Admin and waiter leave it unset. */
  rowChrome?: (p: MenuRowChromeProps) => React.ReactNode;
  onConfirmIncludeDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  isDragOver: boolean;
  /** True while a drag is in progress anywhere — drives always-visible drop hints. */
  dragActive?: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  /** Raw sub-categories (2026-06-09). Label currently hovered in this bucket, or null. */
  subCatDragOverLabel?: string | null;
  onDragEnterSubCategory?: (e: React.DragEvent, menuId: string, cat: string, label: string) => void;
  onDragLeaveSubCategory?: (menuId: string, cat: string, label: string) => void;
  onDropSubCategory?: (e: React.DragEvent, menuId: string, cat: string, label: string) => void;
  onRenameSubCategory?: (menuId: string, from: string, to: string) => void | Promise<void>;
  onDeleteSubCategory?: (menuId: string, label: string) => void | Promise<void>;
  /** STR-775 — resolve the display order of a course's sub-category labels
   *  (owner sort_order from the first-class structure; falls back to alphabetical). */
  orderSubCategories?: (menuId: string, category: string, labels: string[]) => string[];
  /** Menu workspace v5: the owner's dish order inside a sub-category — returns
   *  `itemIds` sorted by it (unknown ids keep their place at the end). */
  orderSubCategoryItems?: (menuId: string, category: string, label: string, itemIds: string[]) => string[];
  /** Menu workspace v5: move `draggedId` before / after `targetId` inside the
   *  sub-category `label` (grip drag on a row). */
  onReorderSubCategoryItem?: (menuId: string, category: string, label: string, draggedId: string, targetId: string, position: 'before' | 'after') => void;
  /** Whether `label` is a real (saveable) sub-category — the grip shows only then. */
  canReorderSubCategoryItems?: (menuId: string, category: string, label: string) => boolean;
  /** Drinks menus only — also chip sub-categories that have no items yet.
   *  Their items carry no raw_categories, so the item-derived rail would
   *  otherwise stay blank and hide a just-created sub-category. */
  showEmptySubCategoryChips?: boolean;
  /** STR-775 — persist a new sub-category order for a course (drag-grip or ▲▼). */
  onReorderSubCategory?: (menuId: string, category: string, orderedLabels: string[]) => void | Promise<void>;
  /** Create a new (empty) sub-category in this course from the rail's [+] box. */
  onCreateSubCategory?: (menuId: string, category: string, name: string) => void | Promise<void>;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onRemoveItem: (itemId: string, menuId: string) => void;
  onEditItem: (itemId: string) => void;
  /** Deep-link target — the item to reveal; forces its sub-category open. */
  scrollToItemId?: string | null;
  /** STR-858 — mobile 1-tap 86/restore, forwarded to each MenuItemRow. */
  onToggleItemActive?: (itemId: string, nextActive: boolean) => void;
  /** STR-858 — mobile "Move to…", forwarded to each MenuItemRow. */
  onMoveItemCourse?: (item: MenuItemDisplay, fromCat: string) => void;
  /** STR-858 — mobile "86 whole course" (bulk-hide a downed course). Receives
   *  the bucket's currently-active item IDs. */
  onHideCategory?: (itemIds: string[]) => void;
  /** PDD 2026-05-22 — bulk Includes selection (forwarded from MenuBuilder). */
  bulkSelectionEnabled?: boolean;
  bulkSelection?: Set<string>;
  onToggleBulkSelection?: (itemId: string) => void;
  /** The builder header's "Select" toggle is on: row checkboxes render at full
   *  strength and the section select-all appears. Off = the checkboxes are
   *  still in the DOM (the bulk-actions canary clicks them straight away) but
   *  faded until the row is hovered or already selected. */
  selectMode?: boolean;
  /**
   * When true, an empty bucket is rendered neutrally instead of with the
   * red "needs attention" border + EMPTY pill. Set by the parent when the
   * entire menu has zero assigned items — that's either a still-hydrating
   * load or a brand-new menu, in either case calling out every bucket as
   * "empty" is noise. Once at least one item lands on the menu, the parent
   * flips this off and each remaining empty bucket regains the red
   * "you skipped this one" signal.
   */
  suppressEmptyAttention?: boolean;
}) {
  const highlight = useBuilderSearchHighlight();
  const allBucketItems = itemIds.map((id) => itemsById.get(id)).filter(Boolean) as MenuItemDisplay[];

  // STR-858 — mobile "86 whole course" (bulk-hide a downed course, e.g. fryer
  // out). 2-tap confirm since it's a bulk action.
  const isMobile = useIsMobile();
  const [confirmHideCourse, setConfirmHideCourse] = useState(false);
  const activeBucketItemIds = allBucketItems.filter((i) => i.active).map((i) => i.id);

  // STR-775 — which sub-category label is being drag-reordered (row drag).
  // Tracked here so the drop can compute the new order; kept separate from the
  // item-refile drag so the two never collide.
  const [reorderFrom, setReorderFrom] = useState<string | null>(null);
  // STR-775 rework — the current drop target + which side the insertion line
  // shows (before/after), derived from the pointer's Y vs the row midpoint.
  const [reorderOver, setReorderOver] = useState<{ label: string; position: 'before' | 'after' } | null>(null);
  // Menu workspace v5 — a DISH being grip-dragged inside its sub-category, and
  // where the red insertion line shows. Its own drag (never MenuManagerClient's
  // `dragging`), so it can't trigger a library / course drop.
  const [rowDrag, setRowDrag] = useState<{ label: string; id: string } | null>(null);
  const [rowOver, setRowOver] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  // STR-251 round 3 — rollup attention indicator. Empty buckets are themselves
  // "needs attention" — except during initial load / brand-new menu state,
  // gated by suppressEmptyAttention. Non-empty buckets always show the
  // missing-price count regardless.
  const attentionCount = allBucketItems.reduce(
    (n, it) => n + (itemHasAttention(it, getSettings(menuId, it.id)) ? 1 : 0),
    0,
  );

  // Visible items honour the missing-price filter. Counts (attention + total)
  // stay anchored on the unfiltered list so the bucket header doesn't flicker
  // as the user toggles the filter.
  const bucketItems = missingPriceFilter
    ? allBucketItems.filter((it) => itemHasAttention(it, getSettings(menuId, it.id)))
    : allBucketItems;
  const bucketEmpty = allBucketItems.length === 0;
  const emptyIsAttention = bucketEmpty && !suppressEmptyAttention;
  const bucketHasAttention = emptyIsAttention || attentionCount > 0;

  // Raw sub-categories present in this course — surfaced as a width-bounded
  // chip on the course header so owners see, at a glance, which sub-categories
  // a course contains without expanding it.
  const itemDerivedRawCategories = deriveBucketRawCategories(
    allBucketItems,
    (id) => getSettings(menuId, id).raw_categories,
  );

  // The rail is derived from the ITEMS' labels, so a sub-category with no items
  // yet produces no chip. On a drinks menu that hides it completely: every item
  // there carries empty raw_categories (its grouping lives in the drink type),
  // so the rail is always blank and a just-created sub-category gives the owner
  // no feedback at the very spot they created it from.
  //
  // `orderSubCategories` already resolves the full set for this (menu, section)
  // from the first-class structure, including count-0 rows — reuse it and append
  // the ones the items didn't surface, as zero-count chips.
  //
  // Gated on `showEmptySubCategoryChips` so food menus keep their existing
  // item-derived rail exactly as-is.
  const bucketRawCategories = useMemo(() => {
    if (!showEmptySubCategoryChips || !orderSubCategories) return itemDerivedRawCategories;
    const present = new Set(itemDerivedRawCategories.map((rc) => normalizeSubcatKey(rc.label)));
    const extra = orderSubCategories(
      menuId,
      category,
      itemDerivedRawCategories.map((rc) => rc.label),
    )
      .filter((l) => l !== UNGROUPED_KEY && !present.has(normalizeSubcatKey(l)))
      .map((label) => ({ label, count: 0 }));
    return extra.length ? [...itemDerivedRawCategories, ...extra] : itemDerivedRawCategories;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmptySubCategoryChips, orderSubCategories, menuId, category, itemDerivedRawCategories]);

  // A section can hold sub-categories with NO items yet — created from the [+]
  // but never filled. The empty-bucket branch below short-circuits before the
  // grouping logic, so those never rendered and the owner could never file the
  // FIRST item into one: the section showed "No items in this category yet"
  // while its own chips listed the sub-categories.
  //
  // Acute on a drinks menu, where a brand-new section is empty by definition.
  // Gated on the same drinks-only flag, so a food menu's empty course keeps its
  // plain empty-state message unchanged.
  const pendingEmptySubLabels = useMemo(
    () =>
      bucketItems.length === 0 && showEmptySubCategoryChips && orderSubCategories
        ? orderSubCategories(menuId, category, []).filter((l) => l !== UNGROUPED_KEY)
        : [],
    [bucketItems.length, showEmptySubCategoryChips, orderSubCategories, menuId, category],
  );

  // PDD 2026-05-22 — bucket-level select-all state.
  // checked when ALL non-empty bucket items are selected; indeterminate
  // when SOME (but not all) are selected.
  const workspace = useBuilderWorkspace();
  // Workspace: holding a dragged item over a COLLAPSED course opens it, so its
  // sub-categories become drop targets. Cancelled when the pointer moves on.
  useEffect(() => {
    if (!workspace || !isDragOver || !collapsed || reorderFrom) return;
    const t = setTimeout(onToggleCollapse, DRAG_EXPAND_MS);
    return () => clearTimeout(t);
  }, [workspace, isDragOver, collapsed, reorderFrom, onToggleCollapse]);
  const bucketSelectedCount = bulkSelectionEnabled && bulkSelection
    ? bucketItems.filter((it) => bulkSelection.has(it.id)).length
    : 0;
  const allBucketSelected = bulkSelectionEnabled && bucketItems.length > 0
    && bucketSelectedCount === bucketItems.length;
  const someBucketSelected = bulkSelectionEnabled
    && bucketSelectedCount > 0
    && bucketSelectedCount < bucketItems.length;

  return (
    <div
      // Section box (Owner Portal redesign, 2026-11-10): one bordered card per
      // course, 44px header on the quiet surface, the rows inside.
      // No overflow-hidden on the box: a row's ⋯ menu drops below the row and
      // must not be clipped. The header clips its own corners instead.
      className="mb-2.5 rounded-ctl border border-line bg-surface transition-shadow duration-150"
      data-testid={`category-bucket-${category}`}
      data-attention={bucketHasAttention ? 'true' : undefined}
      // Workspace (owner v5): the WHOLE course card is the drop target — header
      // included, so a collapsed course accepts a drop and opens on hover — and
      // a hovered card wears the design's red ring. Sub-category bands stop
      // propagation, so a drop on one files into it, not the course.
      data-drop-over={workspace && isDragOver && !reorderFrom && !rowDrag ? 'true' : undefined}
      onDragEnter={workspace && !reorderFrom && !rowDrag ? onDragEnter : undefined}
      onDragLeave={workspace && !reorderFrom && !rowDrag ? onDragLeave : undefined}
      onDragOver={workspace ? (e) => e.preventDefault() : undefined}
      onDrop={workspace && !reorderFrom && !rowDrag ? onDrop : undefined}
      style={workspace && isDragOver && !reorderFrom
        ? { borderColor: DROP_RING.ring, boxShadow: `0 0 0 1px ${DROP_RING.ring}` }
        : undefined}
    >
      {/* Bucket header — checkbox (when bulk enabled) + collapse button */}
      <div className={`flex items-stretch overflow-hidden ${collapsed ? 'rounded-ctl' : 'rounded-t-ctl'}`}>
        {bulkSelectionEnabled && bucketItems.length > 0 && (workspace ? !collapsed : (selectMode || bucketSelectedCount > 0)) && (
          <label
            className="flex items-center justify-center pl-3 pr-1 cursor-pointer bg-surface2/50"
            title={workspace
              ? (allBucketSelected ? `Deselect all in ${displayLabel ?? category}` : `Select all ${bucketItems.length} items in ${displayLabel ?? category}`)
              : `Select every item in ${displayLabel ?? category}`}
          >
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-ink cursor-pointer"
              data-testid={`menu-builder-bucket-select-${category}`}
              checked={allBucketSelected}
              ref={(el) => {
                if (el) el.indeterminate = someBucketSelected;
              }}
              onChange={() => {
                // Toggle all bucket items as a unit. If anything in the
                // bucket is unselected, select all; otherwise clear all.
                const shouldSelect = !allBucketSelected;
                for (const it of bucketItems) {
                  const isSelected = bulkSelection?.has(it.id) ?? false;
                  if (shouldSelect && !isSelected) {
                    onToggleBulkSelection?.(it.id);
                  } else if (!shouldSelect && isSelected) {
                    onToggleBulkSelection?.(it.id);
                  }
                }
              }}
              aria-label={`Select all items in ${category}`}
            />
          </label>
        )}
      {/* STR-858 — mobile "86 whole course" (bulk-hide a downed course). 2-tap
          confirm; hidden on desktop and when the course has no active items. */}
      {isMobile && onHideCategory && activeBucketItemIds.length > 0 && (
        confirmHideCourse ? (
          <div className="flex items-stretch shrink-0 border-l border-l-[var(--border)]">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmHideCourse(false); }}
              data-testid={`bucket-hide-course-cancel-${category}`}
              className="px-3 min-h-11 text-xs font-semibold text-[var(--text2)] bg-[var(--bg2)] border-none cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onHideCategory(activeBucketItemIds); setConfirmHideCourse(false); }}
              data-testid={`bucket-hide-course-confirm-${category}`}
              className="px-3 min-h-11 text-xs font-bold text-white bg-[var(--red)] border-none cursor-pointer whitespace-nowrap"
            >
              86 all ({activeBucketItemIds.length})
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setConfirmHideCourse(true); }}
            data-testid={`bucket-hide-course-${category}`}
            aria-label={`86 all items in ${displayLabel ?? category}`}
            title="86 all items in this course"
            className="shrink-0 min-w-11 min-h-11 flex items-center justify-center bg-transparent border-none border-l border-l-[var(--border)] text-[var(--text2)] hover:text-[var(--red)] cursor-pointer"
          >
            <Ban size={16} />
          </button>
        )
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          // Preserve the button's keyboard affordance now that this is a div
          // (a div was needed so the header can contain the inline [+] create
          // control — an <input>/<button> can't nest inside a real <button>).
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
        data-testid={`collapse-bucket-${category}`}
        // Opt OUT of the owner app's global [role="button"]:active scale —
        // a full-width course row visibly "pressing" reads as layout jank,
        // not affordance (owner feedback 2026-07-21).
        data-no-press
        // 44px header on the quiet surface (design: chevron · bold name · count
        // right-aligned). A course that needs attention gets a crimson inset
        // edge + the count pill below instead of the old red box.
        className={`flex-1 flex items-center gap-2.5 min-h-[44px] py-1.5 px-3.5 cursor-pointer text-left transition-colors duration-150 ${isDragOver ? '' : 'bg-surface2/50'}`}
        style={{
          background: isDragOver ? (workspace ? DROP_RING.tint : DROP_TARGET.fill) : undefined,
          boxShadow: bucketHasAttention ? 'inset 3px 0 0 var(--bad)' : undefined,
        }}
      >
        <span className="text-ink-soft shrink-0">
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </span>
        <span className="text-[15px] font-bold text-ink shrink-0">
          {displayLabel ?? category}
        </span>
        <span
          data-testid={`bucket-rawcats-${category}`}
          // STR-858 — on mobile the chips WRAP to multiple lines (flex-wrap, no
          // overflow-hidden) so no sub-category label is cut off; the "+N" chip
          // still summarises any beyond MAX_RAWCAT_CHIPS. Desktop keeps the
          // single-line clip + "+N".
          className={`flex-1 min-w-0 flex items-center gap-1 normal-case ${isMobile ? 'flex-wrap' : 'overflow-hidden'}`}
        >
            {/* One chip per sub-category, each "{label} {item-count}". Each chip
                is width-bounded (label ellipsis-truncates). On desktop only the
                first MAX_RAWCAT_CHIPS render inline (rest → "+N"); on mobile they
                wrap so nothing is cut off. */}
            {bucketRawCategories.slice(0, MAX_RAWCAT_CHIPS).map((rc) => (
              <span
                key={rc.label}
                data-testid={`bucket-rawcat-chip-${category}-${rc.label}`}
                title={`${rc.label} — ${rc.count} item${rc.count === 1 ? '' : 's'}`}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-ink-soft rounded-full border border-line bg-surface px-2 py-px"
                style={{ maxWidth: 140 }}
              >
                <span
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'inline-block',
                  }}
                >
                  {rc.label}
                </span>
                <span className="shrink-0 font-semibold opacity-80">{rc.count}</span>
              </span>
            ))}
            {bucketRawCategories.length > MAX_RAWCAT_CHIPS && (
              <span
                data-testid={`bucket-rawcats-overflow-${category}`}
                title={bucketRawCategories
                  .slice(MAX_RAWCAT_CHIPS)
                  .map((rc) => `${rc.label} (${rc.count})`)
                  .join(', ')}
                className="shrink-0 text-[11px] font-semibold text-ink-soft rounded-full bg-surface border border-line px-2 py-px"
              >
                +{bucketRawCategories.length - MAX_RAWCAT_CHIPS}
              </span>
            )}
          {/* Bare [+] at the end of the sub-category row → inline create.
              Commits on Enter or blur; stops propagation so it never toggles
              the course collapse. */}
          {onCreateSubCategory && (
            <SubCategoryCreateBox
              menuId={menuId}
              category={category}
              onCreate={onCreateSubCategory}
            />
          )}
        </span>
        {emptyIsAttention ? (
          <span
            data-testid={`bucket-attention-empty-${category}`}
            className="inline-flex items-center h-5 px-2 rounded-full text-[11px] font-semibold bg-bad-bg text-bad whitespace-nowrap"
            title="No items in this category yet"
          >
            Empty
          </span>
        ) : attentionCount > 0 ? (
          <span
            data-testid={`bucket-attention-count-${category}`}
            className="inline-flex items-center gap-0.5 h-5 px-2 rounded-full text-[11px] font-semibold bg-bad-bg text-bad whitespace-nowrap"
            title={`${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention`}
          >
            ⚠ {attentionCount}
          </span>
        ) : null}
        <span className="text-sm text-ink-soft shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }} data-testid={`bucket-count-${category}`}>
          {bucketItems.length}
        </span>
      </div>
      </div>

      {/* Bucket items + drop zone */}
      {!collapsed && (
        <div
          // STR-775 — during a SUB-CATEGORY reorder drag (reorderFrom set), the
          // item-refile bucket drop is suppressed: its enter/drop fire as the
          // reorder drag passes over the bucket, but the reorder drop is handled
          // (stopPropagation) at the sub-category row, so the bucket never gets a
          // drop/leave to clear isDragOver → the green box stuck after reordering.
          onDragEnter={reorderFrom || workspace ? undefined : onDragEnter}
          onDragLeave={reorderFrom || workspace ? undefined : onDragLeave}
          onDragOver={workspace ? undefined : (e) => e.preventDefault()}
          onDrop={reorderFrom || workspace ? undefined : onDrop}
          data-testid={`bucket-drop-${category}`}
          className="min-h-10 transition-all duration-150 border-t border-line px-2.5 pt-1.5 pb-1.5"
          style={workspace ? undefined : {
            // Consistent green = "valid drop target". A faint outline appears on
            // every droppable bucket the moment a drag starts (always-visible
            // labeled zones), filling in solid when you actually hover it. Both
            // suppressed while reordering sub-categories (not an item-refile).
            background: isDragOver && !reorderFrom ? DROP_TARGET.fill : 'transparent',
            ...(isDragOver && !reorderFrom
              ? { border: `2px dashed ${DROP_TARGET.border}`, borderRadius: 'var(--r-ctl, 8px)', margin: '2px 4px' }
              : dragActive && !reorderFrom
                ? { border: `2px dashed ${DROP_TARGET.border}55`, borderRadius: 'var(--r-ctl, 8px)', margin: '2px 4px' }
                : {}),
          }}
        >
          {/* Bucket-level drop hint. Visible for the whole drag (not just on
              hover) so every course advertises itself as a drop target and
              spells out what dropping does. Intensifies when actually hovered. */}
          {dragActive && !workspace && bucketItems.length > 0 && (
            <div
              data-testid={`bucket-drop-hint-${category}`}
              className="mx-1 my-1 px-3 py-1.5 text-xs font-semibold rounded text-center transition-colors"
              style={{
                color: DROP_TARGET.accent,
                background: isDragOver ? DROP_TARGET.fill : DROP_TARGET.bg,
                border: `1px dashed ${DROP_TARGET.border}`,
              }}
            >
              {isDragOver
                ? `Drop to add to ${displayLabel} — pick a sub-category next`
                : `Drop here to add to ${displayLabel}`}
            </div>
          )}
          {bucketItems.length === 0 && pendingEmptySubLabels.length === 0 ? (
            <div
              data-testid={`category-empty-${category}`}
              className="px-3 py-2.5 text-[13px] text-ink-faint"
              style={dragActive && !workspace ? { color: DROP_TARGET.accent } : undefined}
            >
              {dragActive && !workspace
                ? `Drop here to add to ${displayLabel}`
                : missingPriceFilter && allBucketItems.length > 0
                  ? 'No items missing a price'
                  : 'No items in this category yet'}
            </div>
          ) : (() => {
            // Render one item row (with the optional bulk-selection wrapper).
            // `subLabel` is the raw sub-category group the row is nested under
            // (undefined for the flat/onlyUngrouped render) — it scopes the
            // trash button below to that single sub-category.
            const renderRow = (
              item: MenuItemDisplay,
              subLabel?: string,
              reorderHandle?: { onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void },
            ) => {
              const row = (
                <MenuItemRow
                  key={item.id}
                  reorderHandle={reorderHandle}
                  item={item}
                  menuId={menuId}
                  cat={category}
                  subLabel={subLabel}
                  settings={getSettings(menuId, item.id)}
                  itemsById={itemsById}
                  menus={menus}
                  onUpdateSettings={onUpdateSettings}
                  onUpdateModifiers={onUpdateModifiers}
                  onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                  onBringIntoMenu={onBringIntoMenu}
                  byoHandlers={byoHandlers}
                  showAddons={showAddons}
                  showRecommendations={showRecommendations}
                  showAddGrouping={showAddGrouping}
                  perMenuSides={perMenuSides}
                  showIncludeZones={showIncludeZones}
                  rowChrome={rowChrome}
                  onConfirmIncludeDrop={onConfirmIncludeDrop}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  // Drag-and-drop between category buckets stays available
                  // unless the owner has actively selected rows for a bulk
                  // action. When ≥1 row is selected, drag is suppressed so
                  // it doesn't fight the bulk-selection UX. When nothing
                  // is selected, normal drag-to-recategorize works.
                  disableDrag={
                    bulkSelectionEnabled
                    && (bulkSelection?.size ?? 0) > 0
                  }
                  onRemove={() => {
                    // computeRowRemoval decides the scope from where the row is
                    // rendered (subLabel): drop just this sub-category, drop just
                    // this canonical category, or remove from the menu entirely.
                    const removal = computeRowRemoval(getSettings(menuId, item.id), category, subLabel);
                    if (removal.kind === 'sub-category') {
                      void onUpdateSettings(menuId, item.id, { raw_categories: removal.raw_categories });
                    } else if (removal.kind === 'canonical-category') {
                      void onUpdateSettings(menuId, item.id, { canonical_categories: removal.canonical_categories });
                    } else {
                      onRemoveItem(item.id, menuId);
                    }
                  }}
                  onEdit={() => onEditItem(item.id)}
                  onToggleActive={
                    onToggleItemActive
                      ? () => onToggleItemActive(item.id, !item.active)
                      : undefined
                  }
                  onMove={
                    onMoveItemCourse
                      ? () => onMoveItemCourse(item, category)
                      : undefined
                  }
                />
              );
              if (!bulkSelectionEnabled) return row;
              // PDD 2026-05-22 Step 9 — render a leading checkbox column
              // when bulk selection is enabled. Wraps the row sideways so
              // MenuItemRow itself stays untouched (and drag-and-drop on
              // the row still works because the drag handlers live on the
              // row's outer div, NOT the checkbox).
              const isSelected = bulkSelection?.has(item.id) ?? false;
              // The checkbox is always in the DOM (the owner-menu-bulk-actions
              // canary clicks `menu-builder-row-select-<id>` straight after
              // opening a tab, with no Select toggle), but it is faded until the
              // header's Select mode is on, the row is hovered, or the row is
              // already selected — so the resting row reads like the design.
              return (
                <div
                  key={item.id}
                  // Workspace: the WHOLE row (checkbox column included) takes the
                  // subtle hover tint, so the eye stays on one dish (Avi 2026-11-13).
                  className={`flex items-stretch w-full group/row ${isSelected ? 'bg-surface2' : ''} ${workspace && !isSelected ? 'transition-colors hover:bg-[var(--mw-sand)]' : ''}`}
                  data-selected={isSelected ? 'true' : undefined}
                >
                  <div
                    // Top-aligned at the row's 50px first line, so an expanded
                    // row's settings block does not pull the box to its middle.
                    className={`flex items-start justify-center pl-2 pr-0.5 pt-[18px] transition-opacity ${
                      workspace || selectMode || isSelected ? 'opacity-100' : 'opacity-35 group-hover/row:opacity-100 focus-within:opacity-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 accent-ink cursor-pointer"
                      data-testid={`menu-builder-row-select-${item.id}`}
                      checked={isSelected}
                      onChange={() => onToggleBulkSelection?.(item.id)}
                      aria-label={`Select ${item.name} for bulk action`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">{row}</div>
                </div>
              );
            };

            // Group the bucket's items by raw sub-category label. Casing /
            // punctuation variants ("Flavors of Tandoor" vs "flavors of tandoor")
            // are merged into ONE sub-accordion via normalizeSubcatKey; the
            // displayed label is the most-used variant. An item with N labels
            // appears under each; items with no label fall under UNGROUPED_KEY.
            // When that's the ONLY group, render flat (no sub-group chrome).
            const byKey = new Map<
              string,
              { items: MenuItemDisplay[]; seen: Set<string>; variants: Map<string, number> }
            >();
            for (const item of bucketItems) {
              const labels = getSettings(menuId, item.id).raw_categories;
              const list = labels && labels.length ? labels : [UNGROUPED_KEY];
              for (const raw of list) {
                const key = raw === UNGROUPED_KEY ? UNGROUPED_KEY : (normalizeSubcatKey(raw) || UNGROUPED_KEY);
                let g = byKey.get(key);
                if (!g) { g = { items: [], seen: new Set<string>(), variants: new Map<string, number>() }; byKey.set(key, g); }
                if (!g.seen.has(item.id)) { g.seen.add(item.id); g.items.push(item); }
                if (raw !== UNGROUPED_KEY) g.variants.set(raw, (g.variants.get(raw) ?? 0) + 1);
              }
            }
            const groups = new Map<string, MenuItemDisplay[]>();
            for (const [key, g] of byKey) {
              // Show the scraped human string ("Flavors of Tandoor"), never the
              // snake_case key the v2 seed injected — even when snake is more
              // frequent. preferScrapedLabel ranks spaced/human forms first.
              const display = key === UNGROUPED_KEY
                ? UNGROUPED_KEY
                : preferScrapedLabel([...g.variants].map(([label, count]) => ({ label, count })));
              groups.set(display, g.items);
            }
            // STR-775 — owner sort_order wins (resolver reads the first-class
            // structure); falls back to alphabetical when no order is set.
            const orderedLabels = orderSubCategories
              ? orderSubCategories(menuId, category, [...groups.keys()])
              : sortedSubCategoryLabels([...groups.keys()]);
            const onlyUngrouped = orderedLabels.length === 1 && orderedLabels[0] === UNGROUPED_KEY;
            if (onlyUngrouped) {
              // No subLabel — flat render falls back to whole-menu removal.
              return bucketItems.map((item) => renderRow(item));
            }
            // STR-775 — the non-Ungrouped labels are the reorderable set; Ungrouped
            // is a sentinel bucket, never reordered (always rendered last).
            const reorderableLabels = orderedLabels.filter((l) => l !== UNGROUPED_KEY);
            const reorderEnabled = !!onReorderSubCategory && reorderableLabels.length > 1;
            const moveLabel = (label: string, toIdx: number) => {
              if (!onReorderSubCategory) return;
              const fromIdx = reorderableLabels.indexOf(label);
              if (fromIdx < 0 || toIdx < 0 || toIdx >= reorderableLabels.length || fromIdx === toIdx) return;
              const next = [...reorderableLabels];
              next.splice(fromIdx, 1);
              next.splice(toIdx, 0, label);
              void onReorderSubCategory(menuId, category, next);
            };
            // STR-775 rework — drop `dragLabel` before/after `targetLabel`,
            // computed in the post-removal frame so indices never drift.
            const moveLabelRelative = (dragLabel: string, targetLabel: string, position: 'before' | 'after') => {
              if (!onReorderSubCategory || dragLabel === targetLabel) return;
              const next = [...reorderableLabels];
              const from = next.indexOf(dragLabel);
              if (from < 0) return;
              next.splice(from, 1);
              const targetIdx = next.indexOf(targetLabel);
              if (targetIdx < 0) return;
              const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
              next.splice(insertAt, 0, dragLabel);
              if (next.every((l, i) => l === reorderableLabels[i])) return; // no-op
              void onReorderSubCategory(menuId, category, next);
            };
            return orderedLabels.map((label) => {
              const rawGroupItems = groups.get(label) ?? [];
              // Workspace v5: the owner's dish order (structure item_ids). Ungrouped
              // has no stored order (it is not a sub-category).
              const dishOrderable = !!onReorderSubCategoryItem && label !== UNGROUPED_KEY
                && (canReorderSubCategoryItems ? canReorderSubCategoryItems(menuId, category, label) : true);
              const groupItems = orderSubCategoryItems && label !== UNGROUPED_KEY
                ? (() => {
                    const byId = new Map(rawGroupItems.map((it) => [it.id, it] as const));
                    return orderSubCategoryItems(menuId, category, label, rawGroupItems.map((it) => it.id))
                      .map((id) => byId.get(id))
                      .filter((it): it is MenuItemDisplay => !!it);
                  })()
                : rawGroupItems;
              const reorderIdx = reorderableLabels.indexOf(label);
              return (
                <SubCategoryGroup
                  key={label}
                  label={label}
                  category={category}
                  menuId={menuId}
                  itemCount={groupItems.length}
                  color={color}
                  containsScrollTarget={!!scrollToItemId && groupItems.some((it) => it.id === scrollToItemId)}
                  forceOpen={!!highlight && groupItems.some((it) => highlight.matchIds.has(it.id))}
                  isDragOver={subCatDragOverLabel === label && !rowDrag}
                  onDragEnter={
                    onDragEnterSubCategory && !rowDrag
                      ? (e) => onDragEnterSubCategory(e, menuId, category, label)
                      : undefined
                  }
                  onDragLeave={
                    onDragLeaveSubCategory
                      ? () => onDragLeaveSubCategory(menuId, category, label)
                      : undefined
                  }
                  onDrop={
                    onDropSubCategory
                      ? (e) => onDropSubCategory(e, menuId, category, label)
                      : undefined
                  }
                  onRename={
                    onRenameSubCategory
                      ? (from, to) => onRenameSubCategory(menuId, from, to)
                      : undefined
                  }
                  onDelete={
                    onDeleteSubCategory
                      ? (lbl) => onDeleteSubCategory(menuId, lbl)
                      : undefined
                  }
                  reorderEnabled={reorderEnabled && label !== UNGROUPED_KEY}
                  isReorderDragging={reorderFrom === label}
                  isReorderActive={reorderFrom !== null && reorderFrom !== label && label !== UNGROUPED_KEY}
                  insertionLine={reorderOver && reorderOver.label === label ? reorderOver.position : null}
                  onReorderDragStart={() => { setReorderFrom(label); setReorderOver(null); }}
                  // Safety net: clear any item-refile bucket highlight the reorder
                  // drag may have triggered, so the green box never sticks.
                  onReorderDragEnd={() => { setReorderFrom(null); setReorderOver(null); onDragLeave?.(); }}
                  onReorderDragOver={(e) => {
                    if (!reorderFrom || reorderFrom === label) return;
                    // Pointer in the top half → insert before, bottom half → after.
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    setReorderOver((prev) =>
                      prev && prev.label === label && prev.position === position ? prev : { label, position },
                    );
                  }}
                  onReorderDrop={() => {
                    if (reorderFrom && reorderOver && reorderFrom !== label) {
                      moveLabelRelative(reorderFrom, reorderOver.label, reorderOver.position);
                    } else if (reorderFrom && reorderFrom !== label) {
                      moveLabel(reorderFrom, reorderIdx);
                    }
                    setReorderFrom(null);
                    setReorderOver(null);
                  }}
                  onMoveUp={() => moveLabel(label, reorderIdx - 1)}
                  onMoveDown={() => moveLabel(label, reorderIdx + 1)}
                  canMoveUp={reorderIdx > 0}
                  canMoveDown={reorderIdx >= 0 && reorderIdx < reorderableLabels.length - 1}
                  selectAll={workspace && bulkSelectionEnabled && groupItems.length > 0 ? {
                    state: selectionState(groupItems.map((it) => it.id), bulkSelection),
                    total: groupItems.length,
                    onToggle: () => {
                      const all = selectionState(groupItems.map((it) => it.id), bulkSelection) === 'all';
                      for (const it of groupItems) {
                        const isSel = bulkSelection?.has(it.id) ?? false;
                        if (all ? isSel : !isSel) onToggleBulkSelection?.(it.id);
                      }
                    },
                  } : undefined}
                >
                  {groupItems.map((item) => {
                    if (!dishOrderable || groupItems.length < 2) {
                      return <Fragment key={`${label}:${item.id}`}>{renderRow(item, label)}</Fragment>;
                    }
                    const isTarget = rowDrag?.label === label && rowDrag.id !== item.id;
                    const line = isTarget && rowOver?.id === item.id ? rowOver.position : null;
                    return (
                      <div
                        key={`${label}:${item.id}`}
                        className="relative"
                        data-testid={`dish-reorder-slot-${item.id}`}
                        data-drop-line={line ?? undefined}
                        style={{ opacity: rowDrag?.id === item.id && rowDrag.label === label ? 0.45 : undefined }}
                        onDragOver={isTarget ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                          const rect = e.currentTarget.getBoundingClientRect();
                          const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                          setRowOver((prev) => (prev && prev.id === item.id && prev.position === position ? prev : { id: item.id, position }));
                        } : undefined}
                        onDrop={isTarget ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const pos = rowOver?.id === item.id ? rowOver.position : 'before';
                          onReorderSubCategoryItem!(menuId, category, label, rowDrag!.id, item.id, pos);
                          setRowDrag(null);
                          setRowOver(null);
                        } : undefined}
                      >
                        {line && (
                          <div
                            aria-hidden
                            className="pointer-events-none absolute left-0 right-0 z-[1] h-0.5 rounded-full"
                            style={{ background: DROP_RING.ring, [line === 'before' ? 'top' : 'bottom']: -1 }}
                          />
                        )}
                        {renderRow(item, label, {
                          onDragStart: (e) => {
                            // Own drag type; never MenuManagerClient's item drag.
                            e.stopPropagation();
                            e.dataTransfer.effectAllowed = 'move';
                            try { e.dataTransfer.setData('application/x-qrate-dish-reorder', item.id); } catch { /* jsdom */ }
                            setRowDrag({ label, id: item.id });
                            setRowOver(null);
                          },
                          onDragEnd: () => { setRowDrag(null); setRowOver(null); },
                        })}
                      </div>
                    );
                  })}
                </SubCategoryGroup>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ── MenuBuilder ───────────────────────────────────────────────────────────────

export default function MenuBuilder({
  items,
  menus,
  assignments,
  junctionSettings: _junctionSettings,
  activeMenuId,
  collapsed,
  dragging,
  dragOver,
  colorMap,
  getSettings,
  onTabChange,
  onToggleCollapse,
  onUpdateSettings,
  onDragStart,
  onDragEnd,
  onDragEnterBucket,
  onDragLeaveBucket,
  onDropBucket,
  onDragEnterSubCategory,
  onDragLeaveSubCategory,
  onDropSubCategory,
  onRenameSubCategory,
  onDeleteSubCategory,
  orderSubCategories,
  orderSubCategoryItems,
  onReorderSubCategoryItem,
  canReorderSubCategoryItems,
  onReorderSubCategory,
  onCreateSubCategory,
  onCreateMenu,
  onCloneMenu,
  onEditMenu,
  onRemoveItemFromMenu,
  onToggleItemActive,
  onMoveItemCourse,
  onHideCategory,
  onEditItem,
  onUpdateModifiers,
  onConfirmRecommendationDrop,
  onBringIntoMenu,
  byoHandlers,
  showAddons = true,
  showRecommendations = true,
  showAddGrouping = true,
  perMenuSides,
  showIncludeZones = true,
  rowChrome,
  onConfirmIncludeDrop,
  scrollToItemId,
  onScrollComplete,
  builderSearchQuery,
  onRefresh,
  refreshing = false,
  onCollapseAll,
  missingPriceFilter = false,
  bulkSelectionEnabled = false,
  bulkSelection,
  onToggleBulkSelection,
  onOpenBulkPanel,
  wineEnrichmentJob = null,
  onRetryWineEnrichment,
  workspaceMode = false,
  expandAllPortalTarget = null,
}: MenuBuilderProps) {
  const itemsById = new Map(items.map((i) => [i.id, i] as const));
  const trackAction = useTrackAction();
  // Owner Portal redesign (2026-11-10): the card header's "Select" toggle
  // (row checkboxes at full strength + section select-all) and the "Manage
  // sections" modal. Both local — they are view state, not menu data.
  const [selectMode, setSelectMode] = useState(false);
  const [manageSectionsOpen, setManageSectionsOpen] = useState(false);
  // Workspace mode: Expand all / Collapse all reach every sub-category too.
  const [subcatSignal, setSubcatSignal] = useState<{ open: boolean; n: number }>({ open: false, n: 0 });
  const workspace = useMemo<BuilderWorkspaceMode | null>(
    () => (workspaceMode ? { subcatSignal } : null),
    [workspaceMode, subcatSignal],
  );

  const handleRemoveItemFromMenuTracked = (itemId: string, menuId: string) => {
    trackAction('menu.menuBuilder.removeFromMenu', {
      metadata: { itemId, menuId },
    });
    onRemoveItemFromMenu(itemId, menuId);
  };

  const handleToggleCollapseTracked = (key: string) => {
    trackAction('menu.menuBuilder.expandCategory', { metadata: { key } });
    onToggleCollapse(key);
  };

  // Scroll to + expand an item row when requested (e.g. from "appears in menu" click)
  useEffect(() => {
    if (!scrollToItemId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-item-row-id="${scrollToItemId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el.getAttribute('data-expanded') === 'false') {
          const btn = el.querySelector<HTMLElement>('[data-expand-btn="true"]');
          btn?.click();
        }
      }
      onScrollComplete?.();
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToItemId, activeMenuId]);

  const activeMenu = menus.find((m) => m.id === activeMenuId) ?? menus[0] ?? null;
  const activeMenuIndex = activeMenu ? menus.findIndex((m) => m.id === activeMenu.id) : 0;
  const activeColor = colorMap(activeMenuIndex);

  // Buckets to render: the 4 top-level sections (see MENU_SECTIONS). Each
  // section's items are the union of its member canonicals' assignments,
  // de-duped so an item placed in two member canonicals (e.g. Sides + Breads)
  // shows once. The representative canonical drives drop/collapse/price keys.
  const activeAssignments = activeMenu ? (assignments[activeMenu.id] ?? {}) : {};
  // Free-text filter for the chosen menu (app-shell search). Filter the ids in
  // each bucket by the resolved item's name/description — leaves the full
  // `itemsById` map (used for id lookups / rec classification) untouched.
  const builderQuery = (builderSearchQuery ?? '').trim();
  const searchActive = builderQuery.length > 0;
  const highlight = useBuilderSearchHighlight();
  // Highlight search: once typing settles, bring the first match into view in
  // THIS scroll area (a matching section opens with its faded rows above it).
  const builderScrollRef = useRef<HTMLDivElement | null>(null);
  const highlightQuery = highlight?.query ?? '';
  useEffect(() => {
    if (!highlightQuery) return;
    const t = setTimeout(() => {
      const first = builderScrollRef.current?.querySelector<HTMLElement>('[data-search="match"]');
      first?.scrollIntoView?.({ block: 'nearest' });
    }, 300);
    return () => clearTimeout(t);
  }, [highlightQuery]);
  // Sections depend on the menu: food courses (Drinks/Starters/Mains/Desserts)
  // for a normal menu, drink types (Beer/Wine/Cocktails/…) for a drinks menu.
  // buildAssignments keys a drinks menu's buckets by drink_subcategory_key to
  // match, so `sec.members` resolves the same way in both modes.
  const sectionBuckets = sectionsForMenu(activeMenu).map((sec) => {
    const ids = activeMenu
      ? [...new Set(sec.members.flatMap((m) => activeAssignments[m] ?? []))]
      : [];
    return {
      ...sec,
      /** Every item in the section, before the search filter (Manage sections). */
      allItemIds: ids,
      itemIds: searchActive
        ? ids.filter((id) => {
            const it = itemsById.get(id);
            return it ? matchesItemText(it, builderQuery) : false;
          })
        : ids,
    };
  });

  const totalItems = sectionBuckets.reduce((s, b) => s + b.itemIds.length, 0);

  // Manage-sections view of the same data: each course with its sub-categories
  // in owner order (the first-class structure's sort_order via
  // `orderSubCategories`, else alphabetical), each with its distinct-item count.
  // Drinks menus also list count-0 sub-categories (their items carry no
  // raw_categories, so the structure is the only source) — mirrors the
  // `showEmptySubCategoryChips` rule on the section header.
  const manageSections: ManageSection[] = activeMenu
    ? sectionBuckets.map((sec) => {
        const sectionItems = sec.allItemIds.map((id) => itemsById.get(id)).filter(Boolean) as MenuItemDisplay[];
        const derived = deriveBucketRawCategories(sectionItems, (id) => getSettings(activeMenu.id, id).raw_categories);
        const derivedLabels = derived.map((d) => d.label);
        const countByKey = new Map(derived.map((d) => [normalizeSubcatKey(d.label), d.count]));
        const ordered = orderSubCategories
          ? orderSubCategories(activeMenu.id, sec.canonical, derivedLabels)
          : sortedSubCategoryLabels(derivedLabels);
        const includeEmpty = isDrinksMenu(activeMenu);
        const labels = ordered.filter((l) => l !== UNGROUPED_KEY && (includeEmpty || countByKey.has(normalizeSubcatKey(l))));
        return {
          canonical: sec.canonical,
          label: sec.label,
          itemCount: sectionItems.length,
          subcategories: labels.map((label) => ({ label, count: countByKey.get(normalizeSubcatKey(label)) ?? 0 })),
        };
      })
    : [];

  // Deep-link (scrollToItemId): expand the COURSE that contains the target item
  // so its row renders + scrolls into view; the sub-category self-expands via
  // SubCategoryGroup's containsScrollTarget prop.
  useEffect(() => {
    if (!scrollToItemId || !activeMenu) return;
    const bucket = sectionBuckets.find((b) => b.itemIds.includes(scrollToItemId));
    if (!bucket) return;
    const key = `${activeMenu.id}:${bucket.canonical}`;
    if (collapsed[key] ?? true) onToggleCollapse(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToItemId, activeMenu?.id]);

  const allCollapsed = activeMenu
    ? sectionBuckets.every((b) => collapsed[`${activeMenu.id}:${b.canonical}`] ?? true)
    : false;

  if (menus.length === 0) {
    return (
      <div
        className="flex flex-col h-full bg-surface rounded-card border border-line shadow-card items-center justify-center gap-2 text-ink-soft"
        data-testid="menu-builder-panel"
      >
        <span className="text-2xl">🍽</span>
        <span className="text-lg font-semibold text-ink">No menus yet</span>
        <span className="text-xs">Create a menu to start organising items</span>
      </div>
    );
  }

  const selectedCount = bulkSelection?.size ?? 0;
  const secondaryBtn = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-ctl border border-line bg-surface text-[13px] font-semibold text-ink whitespace-nowrap cursor-pointer hover:bg-surface2 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div
      // The design's ONE white card holding the course sections.
      className="flex flex-col h-full bg-surface rounded-card border border-line shadow-card overflow-hidden"
      data-testid="menu-builder-panel"
    >
      {/* v5: Expand all / Collapse all lives on the page's status line. */}
      {activeMenu && expandAllPortalTarget && onCollapseAll && createPortal(
        <button
          type="button"
          onClick={() => {
            onCollapseAll(!allCollapsed);
            if (workspaceMode) setSubcatSignal((s) => ({ open: allCollapsed, n: s.n + 1 }));
          }}
          data-testid="collapse-expand-all-btn"
          className="h-8 px-2.5 rounded-ctl border-0 bg-transparent text-[13px] font-semibold text-ink whitespace-nowrap cursor-pointer hover:bg-surface2"
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>,
        expandAllPortalTarget,
      )}
      {/* Card header: Manage sections · count · (Inactive) ··· Expand all · Select · Bulk actions */}
      {activeMenu && !expandAllPortalTarget && (
        <div className="px-4 pt-4 pb-3 flex items-center gap-2 flex-wrap shrink-0">
          {!workspaceMode && (
          <button
            type="button"
            onClick={() => setManageSectionsOpen(true)}
            data-testid="menu-manage-sections-btn"
            className={secondaryBtn}
          >
            <Layers size={15} aria-hidden="true" />
            Manage sections
          </button>
          )}
          <span
            className="text-[13px] text-ink-soft whitespace-nowrap"
            style={{ fontVariantNumeric: 'tabular-nums' }}
            data-testid="active-menu-item-count"
          >
            {totalItems} item{totalItems !== 1 ? 's' : ''}
          </span>
          {!activeMenu.active && (
            <span className="inline-flex items-center h-[22px] px-2 rounded-full text-xs font-semibold bg-surface2 text-ink" data-testid="menu-builder-inactive-pill">
              Inactive
            </span>
          )}
          <span className="flex-1" />
          {onCollapseAll && (
            <button
              type="button"
              onClick={() => {
                onCollapseAll(!allCollapsed);
                if (workspaceMode) setSubcatSignal((s) => ({ open: allCollapsed, n: s.n + 1 }));
              }}
              data-testid="collapse-expand-all-btn"
              className="h-8 px-2.5 rounded-ctl border-0 bg-transparent text-[13px] font-semibold text-ink whitespace-nowrap cursor-pointer hover:bg-surface2"
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
          {/* PDD 2026-05-22 — bulk selection. "Select" reveals the row
              checkboxes + section select-all; the bulk button opens the
              existing BulkMenuSidesPanel once ≥1 row is selected. */}
          {bulkSelectionEnabled && (
            <>
              {!workspaceMode && <button
                type="button"
                data-testid="menu-builder-select-toggle"
                aria-pressed={selectMode}
                onClick={() => setSelectMode((v) => !v)}
                className={`${secondaryBtn} ${selectMode ? '!bg-ink !text-on-ink !border-ink' : ''}`}
              >
                Select
              </button>}
              {/* Workspace (Avi 2026-11-12): no header button — the floating bulk bar's
                  "More bulk tools" opens the same panel (keeps this testid). */}
              {!workspaceMode && <button
                type="button"
                data-testid="menu-builder-bulk-action"
                onClick={onOpenBulkPanel}
                disabled={selectedCount === 0}
                aria-label="Open bulk action panel"
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-ctl text-[13px] font-semibold whitespace-nowrap border transition-colors ${
                  selectedCount > 0
                    ? 'bg-ink text-on-ink border-ink cursor-pointer hover:bg-ink-hover'
                    : 'bg-surface text-ink-faint border-line cursor-not-allowed'
                }`}
              >
                Bulk actions ({selectedCount})
              </button>}
            </>
          )}
        </div>
      )}

      {onRetryWineEnrichment && (
        <WineEnrichmentBanner job={wineEnrichmentJob} onRetry={onRetryWineEnrichment} />
      )}

      {/* Category buckets. `scrollbar-gutter: stable` reserves the scrollbar
          track at all times so expanding/collapsing a course or sub-category
          (which grows/shrinks the list past the viewport) never toggles the
          scrollbar on/off — that toggle was shifting every right-aligned
          control (count badges, edit/delete icons) left and right on each
          click. */}
      <BuilderWorkspaceContext.Provider value={workspace}>
      <div
        ref={builderScrollRef}
        data-testid="menu-builder-scroll"
        className="flex-1 overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]"
      >
        {searchActive && totalItems === 0 && (
          <div
            data-testid="menu-builder-search-empty"
            className="px-4 py-8 text-center text-[13px] text-ink-faint"
          >
            No items in this menu match “{builderQuery}”.
          </div>
        )}
        {sectionBuckets
          // While searching, drop categories with no matching rows so the
          // owner only sees sections that contain a hit.
          .filter((sec) => !searchActive || sec.itemIds.length > 0)
          .map((sec) => {
            const cat = sec.canonical;
            const collapseKey = `${activeMenu?.id}:${cat}`;
            const dragOverHere =
              dragOver !== null &&
              dragOver !== 'pool' &&
              dragOver.menuId === activeMenu?.id &&
              dragOver.cat === cat
                ? dragOver
                : null;
            // Bucket general-area highlight only when NOT hovering a sub-group.
            const isDragOverBucket = dragOverHere !== null && dragOverHere.label === undefined;
            const subCatDragOverLabel = dragOverHere?.label ?? null;
            const highlightHolds = !!highlight && sec.allItemIds.some((id) => highlight.matchIds.has(id));

            return (
              <CategoryBucket
                key={cat}
                category={cat}
                displayLabel={sec.label}
                itemIds={sec.itemIds}
                itemsById={itemsById}
                menus={menus}
                menuId={activeMenu!.id}
                scrollToItemId={scrollToItemId}
                collapsed={searchActive || highlightHolds
                  ? false
                  : (collapsed[collapseKey] ?? true)}
                getSettings={getSettings}
                color={activeColor}
                // Held open by the library search → the chevron waits for the
                // search to clear (the owner's own state is what comes back).
                onToggleCollapse={() => { if (!highlightHolds) handleToggleCollapseTracked(collapseKey); }}
                onUpdateSettings={onUpdateSettings}
                onUpdateModifiers={onUpdateModifiers}
                onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                onBringIntoMenu={onBringIntoMenu}
                byoHandlers={byoHandlers}
                showAddons={showAddons}
                showRecommendations={showRecommendations}
                showAddGrouping={showAddGrouping}
                perMenuSides={perMenuSides}
                showIncludeZones={showIncludeZones}
                rowChrome={rowChrome}
                onConfirmIncludeDrop={onConfirmIncludeDrop}
                isDragOver={isDragOverBucket}
                dragActive={dragging !== null}
                onDragEnter={(e) => onDragEnterBucket(e, activeMenu!.id, cat)}
                onDragLeave={() => onDragLeaveBucket(activeMenu!.id, cat)}
                onDrop={(e) => onDropBucket(e, activeMenu!.id, cat)}
                subCatDragOverLabel={subCatDragOverLabel}
                onDragEnterSubCategory={onDragEnterSubCategory}
                onDragLeaveSubCategory={onDragLeaveSubCategory}
                onDropSubCategory={onDropSubCategory}
                onRenameSubCategory={onRenameSubCategory}
                onDeleteSubCategory={onDeleteSubCategory}
                orderSubCategories={orderSubCategories}
                orderSubCategoryItems={workspace ? orderSubCategoryItems : undefined}
                onReorderSubCategoryItem={workspace ? onReorderSubCategoryItem : undefined}
                canReorderSubCategoryItems={workspace ? canReorderSubCategoryItems : undefined}
                showEmptySubCategoryChips={isDrinksMenu(activeMenu)}
                onReorderSubCategory={onReorderSubCategory}
                onCreateSubCategory={onCreateSubCategory}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onRemoveItem={handleRemoveItemFromMenuTracked}
                onEditItem={onEditItem}
                onToggleItemActive={onToggleItemActive}
                onMoveItemCourse={onMoveItemCourse}
                onHideCategory={onHideCategory}
                missingPriceFilter={missingPriceFilter}
                bulkSelectionEnabled={bulkSelectionEnabled}
                bulkSelection={bulkSelection}
                onToggleBulkSelection={onToggleBulkSelection}
                selectMode={selectMode}
                // Suppress per-bucket "EMPTY" red treatment while the menu
                // has zero items overall. Covers both the brief loading
                // window (items query lands after menus query) and a
                // genuinely fresh empty menu — neither case warrants
                // calling out every category as a problem.
                suppressEmptyAttention={totalItems === 0}
              />
            );
          })}
      </div>
      </BuilderWorkspaceContext.Provider>

      {activeMenu && (
        <ManageSectionsModal
          open={manageSectionsOpen}
          onClose={() => setManageSectionsOpen(false)}
          menuId={activeMenu.id}
          menuName={activeMenu.name}
          sections={manageSections}
          onReorderSubCategory={onReorderSubCategory}
          onCreateSubCategory={onCreateSubCategory}
        />
      )}
    </div>
  );
}

// Test-only exports ("_"-prefixed = test-only public, not part of the
// component's public API). Pure helpers behind the course-header raw-category
// chip (2026-06-11) and the scoped row-trash removal decision (2026-06-13).
export {
  deriveBucketRawCategories as _deriveBucketRawCategories,
  computeRowRemoval as _computeRowRemoval,
  // Exported for unit tests only (the row chrome — whole-row edit target, ⋯
  // menu with the scoped remove, Visible/Hidden pill). Not part of the public API.
  MenuItemRow as _MenuItemRow,
};

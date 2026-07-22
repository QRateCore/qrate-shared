'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Star, Pencil, Trash2, Ban, RotateCcw, FolderInput } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings, Grouping } from '../../../types/restaurant';
import { type MenuColor, intToBoostLabel, BOOST_LABELS, UNGROUPED_KEY, sortedSubCategoryLabels, MENU_SECTIONS, normalizeSubcatKey, preferScrapedLabel } from '../lib/menuUtils';
import { matchesItemText } from '../filterItemsByText';
import { SubCategoryGroup } from './SubCategoryGroup';
import { SubCategoryCreateBox } from './SubCategoryCreateBox';
import { COLOR_WARNING } from '../../../constants/colors';
import { countApprovedAddons } from '../lib/addonHelpers';
import Select from '../../common/Select';
import type { DragState } from '../MenuManagerClient';
import ItemModifierZones, { type ModifierEntry, type ModifierUpdatePayload } from './ItemModifierZones';
import MobileItemModifierPicker from './MobileItemModifierPicker';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTrackAction } from '../track-action-context';
import { SWEETNESS_VISIBLE } from '../../../constants/feature-flags';

export type { ModifierUpdatePayload };
export type { ModifierEntry };

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
}

// ── GroupingChip ──────────────────────────────────────────────────────────────
// One colored pill per non-empty grouping on a menu item, replacing the legacy
// sides/recs/addons counters and the single aggregate groupings chip. The
// label and palette derive from the grouping's `kind`; custom + modifier
// groupings use the grouping's own name. Hovering for 500ms opens a popover
// listing the grouping's members.
const KIND_PALETTE: Record<string, { bg: string; fg: string; border: string }> = {
  addons:          { bg: '#ffedd5', fg: '#9a3412', border: '#fb923c' }, // orange
  sides_and:       { bg: '#dcfce7', fg: '#166534', border: '#86efac' }, // green
  sides_or:        { bg: '#dcfce7', fg: '#166534', border: '#86efac' }, // green
  recommendations: { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' }, // blue
  modifier:        { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' }, // amber
  custom:          { bg: '#ede9fe', fg: '#6b21a8', border: '#c4b5fd' }, // purple
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

const REC_ACTIVE_PALETTE = { bg: '#dcfce7', fg: '#166534', border: '#86efac' };
const REC_INACTIVE_PALETTE = { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' };

// Single, consistent "valid drop target" highlight. Green is reserved for
// "you can drop here" and is used identically across every drop zone — course
// buckets, sub-category groups, and the modifier (Includes/Recommendations)
// zones — so the builder reads the same wherever the owner drags. Course
// colours still own the collapsed tab/identity; only the *drop* affordance is
// green.
export const DROP_TARGET = { bg: '#F0FDF4', fill: '#DCFCE7', border: '#16A34A', accent: '#15803D' };

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
  onConfirmIncludeDrop,
  onDragStart,
  onDragEnd,
  onRemove,
  onEdit,
  onToggleActive,
  onMove,
  disableDrag = false,
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
}) {
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
  const servingOptions = item.serving_options ?? [];
  const hasServingOptions = servingOptions.length > 0;
  const isWine = item.food_tags?.beverage?.beverage_type?.toLowerCase() === 'wine';
  const useWineFallback = isWine && !hasServingOptions;
  const buildServingStrs = (): Record<string, string> => {
    const o: Record<string, string> = {};
    for (const s of servingOptions) {
      const override = settings.serving_price_overrides?.[s.id];
      o[s.id] = override != null ? String(override / 100) : '';
    }
    if (useWineFallback) {
      const spo = settings.serving_price_overrides ?? {};
      o['glass'] = spo['glass'] != null ? String(spo['glass'] / 100) : '';
      o['bottle'] = spo['bottle'] != null ? String(spo['bottle'] / 100) : '';
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
    const val = priceStr.trim() === '' ? null : parseFloat(priceStr);
    if (val === settings.price) return;
    if (priceStr.trim() !== '' && isNaN(val!)) {
      setPriceStr(settings.price != null ? String(settings.price) : '');
      return;
    }
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
    const val = raw.trim() === '' ? null : parseFloat(raw);
    if (raw.trim() !== '' && isNaN(val!)) {
      // Invalid input — reset to last saved value for this category.
      const saved = settings.category_prices?.[cat];
      setCategoryPriceStrs((prevState) => ({
        ...prevState,
        [cat]: saved != null ? String(saved) : '',
      }));
      return;
    }
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
      setServingPriceStrs((prev) => ({ ...prev, [servingId]: saved != null ? String(saved / 100) : '' }));
      return;
    }
    const cents = dollars != null ? Math.round(dollars * 100) : null;
    const current = settings.serving_price_overrides ?? {};
    if (cents === (current[servingId] ?? null)) return; // no-op
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
  const effectivePrice = multiCat
    ? (settings.category_prices?.[cat] ?? settings.price ?? item.price)
    : (settings.price ?? item.price);
  const displayPrice = effectivePrice != null
    ? `$${Number(effectivePrice).toFixed(2)}`
    : null;
  const displayPriceIsOverride = multiCat
    ? settings.category_prices?.[cat] != null
    : settings.price != null;

  const attention = itemHasAttention(item, settings);
  // Approved-only count — AI-suggested addons that the owner hasn't accepted
  // yet are excluded from the row badge so the number reflects the live menu.
  const approvedAddons = countApprovedAddons(item);
  // Unified per-grouping chip cluster — replaces the legacy sides/recs/addons
  // counters. Each non-empty grouping renders as its own chip with a hover
  // popover listing members. Empty groupings (count === 0) are filtered out
  // by GroupingChip itself.
  const groupings = item.groupings ?? [];
  const hasAnyGroupingChip = groupings.some((g) => visibleItems(g).length > 0);

  const borderLeftColor = attention ? 'var(--red)' : 'transparent';

  return (
    <div
      data-testid={`menu-item-row-${item.id}`}
      data-item-row-id={item.id}
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
      className={`w-full border-b border-[var(--border)] ${expanded ? 'bg-[var(--bg)]' : ''}`}
      style={{
        borderLeft: `3px solid ${borderLeftColor}`,
        // grab cursor signals a collapsed row is draggable (drag onto a course
        // to MOVE it, or into a sub-category to file it — PDD #6). Only when the
        // row is actually draggable, so editing/bulk-select rows keep default.
        cursor: !disableDrag && !expanded ? 'grab' : undefined,
      }}
    >
      <div className="flex items-stretch w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`menu-item-expand-${item.id}`}
        data-expand-btn="true"
        className={`flex-1 min-w-0 bg-transparent border-none cursor-pointer text-left ${isMobile ? 'flex flex-col gap-1 px-2 py-2' : 'flex flex-row items-center gap-2 px-3 py-2'}`}
      >
        {isMobile ? (
          <>
            {/* Mobile row 1 — chevron + full-width name + badges */}
            <div className="flex items-center gap-1.5 w-full min-w-0">
              <span className="text-[var(--text2)] shrink-0">
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
              <span className="text-sm font-medium text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
                {item.name}
              </span>
              {/* Badges */}
              <div className="flex items-center gap-1 shrink-0">
                {chefsSpecial && (
                  <Star size={12} fill="#f59e0b" color="#f59e0b" data-testid={`chefs-special-badge-${item.id}`} />
                )}
                {boostLabel && (
                  <span className="badge badge-green text-xs !py-0 !px-1.5" data-testid={`boost-badge-${item.id}`}>
                    {boostLabel}
                  </span>
                )}
                {displayPrice && (
                  <span
                    className={`text-xs font-semibold ${displayPriceIsOverride ? 'text-[var(--blue)]' : 'text-[var(--text2)]'}`}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                    data-testid={`price-display-${item.id}`}
                  >
                    {displayPrice}
                    {displayPriceIsOverride && <span className="text-[9px] ml-0.5">↑</span>}
                  </span>
                )}
                {!item.active && (
                  <span className="badge badge-green text-xs !py-0 !px-1.5 !bg-[var(--red-bg)] !text-[var(--red)]">86'd</span>
                )}
                {cat === 'Desserts' && SWEETNESS_VISIBLE && item.food_tags?.sweetness_label && (
                  <span className="badge text-xs !py-0 !px-1.5" style={{ color: '#be185d', background: 'rgba(249,168,212,0.15)', border: '1px solid #f9a8d4' }}>
                    ✦ {item.food_tags.sweetness_label}
                  </span>
                )}
                {saving && (
                  <span className="text-xs text-[var(--text2)]">saving…</span>
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
          </>
        ) : (
          <>
            <span className="text-[var(--text2)] shrink-0">
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>

            {/* Thumbnail */}
            <div className="w-8 h-8 rounded-[var(--r-xs)] bg-[var(--bg)] shrink-0 overflow-hidden flex items-center justify-center text-sm">
              {item.thumbnail_url ? (
                <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
              ) : (
                '🍽'
              )}
            </div>

            {/* Name */}
            <span className="text-sm font-medium text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
              {item.name}
            </span>

            {/* One chip per non-empty grouping. Recommendations grouping
                renders as two chips (Active / Inactive) when the parent
                provided `menus` so we can evaluate schedule windows. */}
            <div className="flex flex-wrap items-center gap-1 shrink min-w-0 ml-1">
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

            <span className="flex-1" />

            {/* Badges */}
            <div className="flex items-center gap-1 shrink-0">
              {chefsSpecial && (
                <Star size={12} fill="#f59e0b" color="#f59e0b" data-testid={`chefs-special-badge-${item.id}`} />
              )}
              {boostLabel && (
                <span className="badge badge-green text-xs !py-0 !px-1.5" data-testid={`boost-badge-${item.id}`}>
                  {boostLabel}
                </span>
              )}
              {displayPrice && (
                <span
                  className={`text-xs font-semibold ${settings.price != null ? 'text-[var(--blue)]' : 'text-[var(--text2)]'}`}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                  data-testid={`price-display-${item.id}`}
                >
                  {displayPrice}
                  {settings.price != null && <span className="text-[9px] ml-0.5">↑</span>}
                </span>
              )}
              {!item.active && (
                <span className="badge badge-green text-xs !py-0 !px-1.5 !bg-[var(--red-bg)] !text-[var(--red)]">86'd</span>
              )}
              {cat === 'Desserts' && SWEETNESS_VISIBLE && item.food_tags?.sweetness_label && (
                <span className="badge text-xs !py-0 !px-1.5" style={{ color: '#be185d', background: 'rgba(249,168,212,0.15)', border: '1px solid #f9a8d4' }}>
                  ✦ {item.food_tags.sweetness_label}
                </span>
              )}
            </div>

            {saving && (
              <span className="text-xs text-[var(--text2)] ml-1">saving…</span>
            )}
          </>
        )}
      </button>

      {/* STR-858 — mobile-only 1-tap 86 / restore (the #1 in-shift action).
          A dedicated tap target outside the expand button, so it never expands
          the row. Ban = 86 it (hide everywhere); RotateCcw = restore. Desktop
          uses EditModal's Visible/Hidden, so this renders only when the mobile
          handler is wired. 44px touch target. */}
      {onToggleActive && isMobile && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleActive(); }}
          data-testid={`menu-item-86-toggle-${item.id}`}
          aria-label={item.active ? `86 (hide) ${item.name} on all menus` : `Restore ${item.name}`}
          title={item.active ? '86 — hide on all menus' : 'Restore'}
          className={`shrink-0 w-11 p-0 bg-transparent border-none border-l border-l-[var(--border)] cursor-pointer flex items-center justify-center ${item.active ? 'text-[var(--text2)] hover:text-[var(--red)]' : 'text-[var(--red)]'}`}
        >
          {item.active ? <Ban size={16} /> : <RotateCcw size={16} />}
        </button>
      )}

      {/* STR-858 — mobile-only "Move to…" (re-file this row's course via the tap
          course picker; native drag is dead on touch). 44px target. */}
      {onMove && isMobile && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMove(); }}
          data-testid={`menu-item-move-${item.id}`}
          aria-label={`Move ${item.name} to another course`}
          title="Move to another course"
          className="shrink-0 w-11 p-0 bg-transparent border-none border-l border-l-[var(--border)] text-[var(--text2)] cursor-pointer flex items-center justify-center hover:text-[var(--text)]"
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
        className={`shrink-0 ${isMobile ? 'w-11' : 'w-10'} p-0 bg-transparent border-none border-l border-l-[var(--border)] text-[var(--text2)] cursor-pointer flex items-center justify-center hover:text-[var(--text)]`}
      >
        <Pencil size={isMobile ? 18 : 17} />
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
            className={`shrink-0 ${isMobile ? 'w-11' : 'w-10'} p-0 bg-transparent border-none border-l border-l-[var(--border)] text-[var(--red)] cursor-pointer flex items-center justify-center hover:opacity-70`}
          >
            <Trash2 size={isMobile ? 18 : 17} />
          </button>
        );
      })()}
      </div>

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
                THIS menu. Placeholder shows the item-level default. */}
            {hasServingOptions ? (
              <div className="flex items-center gap-2 flex-wrap" data-testid={`serving-prices-${item.id}`}>
                {servingOptions.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <label className="section-header !mb-0 shrink-0" htmlFor={`serving-${menuId}-${item.id}-${s.id}`}>
                      {s.label}
                    </label>
                    <div className="flex items-center gap-0.5 rounded-[var(--r-xs)] bg-white px-2 py-1 border border-[var(--border)]">
                      <span className="text-xs text-[var(--text2)]">$</span>
                      <input
                        id={`serving-${menuId}-${item.id}-${s.id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={servingPriceStrs[s.id] ?? ''}
                        onChange={(e) => setServingPriceStrs((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        onBlur={() => handleServingPriceBlur(s.id)}
                        placeholder={String((s.price_cents ?? 0) / 100)}
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
                      <span className="text-xs text-[var(--text2)]">$</span>
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
                <span className="text-xs text-[var(--text2)]">$</span>
                {multiCat ? (
                  <input
                    id={`price-${menuId}-${item.id}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={categoryPriceStrs[cat] ?? ''}
                    onChange={(e) => setCategoryPriceStrs((prev) => ({ ...prev, [cat]: e.target.value }))}
                    onBlur={() => handleCategoryPriceBlur(cat)}
                    placeholder={settings.price != null ? String(settings.price) : ''}
                    data-testid={`price-input-${item.id}`}
                    className="border-none outline-none text-xs w-[60px] bg-transparent text-[var(--text)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                ) : (
                  <input
                    id={`price-${menuId}-${item.id}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceStr}
                    onChange={(e) => setPriceStr(e.target.value)}
                    onBlur={handlePriceBlur}
                    placeholder={item.price != null ? String(item.price) : ''}
                    data-testid={`price-input-${item.id}`}
                    className="border-none outline-none text-xs w-[60px] bg-transparent text-[var(--text)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
            ) : (
              <ItemModifierZones
                parent={item}
                itemsById={itemsById}
                currentMenuId={menuId}
                perMenuSides={perMenuSides}
                onConfirmIncludeDrop={onConfirmIncludeDrop}
              />
            )}
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
  suppressEmptyAttention = false,
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
  /** STR-775 — persist a new sub-category order for a course (drag-grip or ▲▼). */
  onReorderSubCategory?: (menuId: string, category: string, orderedLabels: string[]) => void | Promise<void>;
  /** Create a new (empty) sub-category in this course from the rail's [+] box. */
  onCreateSubCategory?: (menuId: string, category: string, name: string) => void | Promise<void>;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onRemoveItem: (itemId: string, menuId: string) => void;
  onEditItem: (itemId: string) => void;
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
  const bucketRawCategories = deriveBucketRawCategories(
    allBucketItems,
    (id) => getSettings(menuId, id).raw_categories,
  );

  // PDD 2026-05-22 — bucket-level select-all state.
  // checked when ALL non-empty bucket items are selected; indeterminate
  // when SOME (but not all) are selected.
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
      className="mb-1"
      data-testid={`category-bucket-${category}`}
      data-attention={bucketHasAttention ? 'true' : undefined}
    >
      {/* Bucket header — checkbox (when bulk enabled) + collapse button */}
      <div className="flex items-stretch">
        {bulkSelectionEnabled && bucketItems.length > 0 && (
          <label
            className="flex items-center justify-center px-2 cursor-pointer"
            style={{
              width: 32,
              background: 'var(--bg)',
              borderRight: '1px solid var(--border)',
            }}
          >
            <input
              type="checkbox"
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
        // py-3 (was py-1.5) + text-sm label below — beefier course rows per
        // owner feedback 2026-07-21.
        className="flex-1 flex items-center gap-2 py-3 px-3 cursor-pointer text-left transition-colors duration-150"
        style={{
          background: isDragOver ? `${color.tab}cc` : 'var(--bg)',
          border: bucketHasAttention ? '2px solid var(--red)' : 'none',
          borderLeft: bucketHasAttention ? '4px solid var(--red)' : 'none',
        }}
      >
        <span className="text-[var(--text2)] shrink-0">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className="text-sm font-bold text-[var(--text)] shrink-0">
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
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text2)] rounded border border-[var(--border)] bg-[var(--bg2)] px-1.5 py-px"
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
                className="shrink-0 text-[10px] font-semibold text-[var(--text2)] rounded-full bg-[var(--bg2)] px-1.5 py-px"
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
            className="text-xs font-bold text-white bg-[var(--red)] rounded-full px-2 py-px uppercase tracking-wide"
            title="No items in this category yet"
          >
            Empty
          </span>
        ) : attentionCount > 0 ? (
          <span
            data-testid={`bucket-attention-count-${category}`}
            className="text-xs font-bold text-white bg-[var(--red)] rounded-full px-1.5 py-px inline-flex items-center gap-0.5"
            title={`${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention`}
          >
            ⚠ {attentionCount}
          </span>
        ) : null}
        <span className="text-xs font-semibold text-[var(--text2)] bg-[var(--bg)] rounded-full px-1.5 py-px">
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
          onDragEnter={reorderFrom ? undefined : onDragEnter}
          onDragLeave={reorderFrom ? undefined : onDragLeave}
          onDragOver={(e) => e.preventDefault()}
          onDrop={reorderFrom ? undefined : onDrop}
          data-testid={`bucket-drop-${category}`}
          className="min-h-10 transition-all duration-150"
          style={{
            // Consistent green = "valid drop target". A faint outline appears on
            // every droppable bucket the moment a drag starts (always-visible
            // labeled zones), filling in solid when you actually hover it. Both
            // suppressed while reordering sub-categories (not an item-refile).
            background: isDragOver && !reorderFrom ? DROP_TARGET.fill : 'transparent',
            border: isDragOver && !reorderFrom
              ? `2px dashed ${DROP_TARGET.border}`
              : dragActive && !reorderFrom
                ? `2px dashed ${DROP_TARGET.border}55`
                : '2px dashed transparent',
            borderRadius: (isDragOver || dragActive) && !reorderFrom ? 'var(--r-xs)' : 0,
            margin: (isDragOver || dragActive) && !reorderFrom ? '2px 4px' : 0,
          }}
        >
          {/* Bucket-level drop hint. Visible for the whole drag (not just on
              hover) so every course advertises itself as a drop target and
              spells out what dropping does. Intensifies when actually hovered. */}
          {dragActive && bucketItems.length > 0 && (
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
          {bucketItems.length === 0 ? (
            <div
              data-testid={`category-empty-${category}`}
              className="px-3 py-2.5 text-xs italic"
              style={dragActive ? { color: DROP_TARGET.accent } : { color: 'var(--text2)' }}
            >
              {dragActive
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
            const renderRow = (item: MenuItemDisplay, subLabel?: string) => {
              const row = (
                <MenuItemRow
                  key={item.id}
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
              return (
                <div
                  key={item.id}
                  className="flex items-stretch w-full"
                  style={{
                    background: isSelected ? 'rgba(255,107,43,0.05)' : undefined,
                    borderLeft: isSelected
                      ? '3px solid var(--brand)'
                      : undefined,
                  }}
                >
                  <div
                    className="flex items-center justify-center px-2"
                    style={{ width: 32, borderRight: '1px solid var(--border)' }}
                  >
                    <input
                      type="checkbox"
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
              const groupItems = groups.get(label) ?? [];
              const reorderIdx = reorderableLabels.indexOf(label);
              return (
                <SubCategoryGroup
                  key={label}
                  label={label}
                  category={category}
                  menuId={menuId}
                  itemCount={groupItems.length}
                  color={color}
                  isDragOver={subCatDragOverLabel === label}
                  onDragEnter={
                    onDragEnterSubCategory
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
                >
                  {groupItems.map((item) => (
                    <Fragment key={`${label}:${item.id}`}>{renderRow(item, label)}</Fragment>
                  ))}
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
}: MenuBuilderProps) {
  const itemsById = new Map(items.map((i) => [i.id, i] as const));
  const trackAction = useTrackAction();

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
    }, 150);
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
  const sectionBuckets = MENU_SECTIONS.map((sec) => {
    const ids = activeMenu
      ? [...new Set(sec.members.flatMap((m) => activeAssignments[m] ?? []))]
      : [];
    return {
      ...sec,
      itemIds: searchActive
        ? ids.filter((id) => {
            const it = itemsById.get(id);
            return it ? matchesItemText(it, builderQuery) : false;
          })
        : ids,
    };
  });

  const totalItems = sectionBuckets.reduce((s, b) => s + b.itemIds.length, 0);

  const allCollapsed = activeMenu
    ? sectionBuckets.every((b) => collapsed[`${activeMenu.id}:${b.canonical}`] ?? true)
    : false;

  if (menus.length === 0) {
    return (
      <div
        className="flex flex-col h-full bg-[var(--white)] rounded-[var(--r)] border border-[var(--border)] items-center justify-center gap-2 text-[var(--text2)]"
        data-testid="menu-builder-panel"
      >
        <span className="text-2xl">🍽</span>
        <span className="text-lg font-semibold">No menus yet</span>
        <span className="text-xs">Create a menu to start organising items</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-[var(--white)] rounded-[var(--r)] border border-[var(--border)] overflow-hidden"
      data-testid="menu-builder-panel"
    >
      {/* Active menu header */}
      {activeMenu && (
        <div className="px-3.5 pt-2.5 pb-2 border-b border-[var(--border)] flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-[var(--text)] flex-1">
            {activeMenu.name}
          </span>
          <span
            className="text-xs text-[var(--text2)] bg-[var(--bg)] rounded-full px-2 py-0.5"
            data-testid="active-menu-item-count"
          >
            {totalItems} item{totalItems !== 1 ? 's' : ''}
          </span>
          {onCollapseAll && (
            <button
              type="button"
              onClick={() => onCollapseAll(!allCollapsed)}
              data-testid="collapse-expand-all-btn"
              // Prominent, not ghosted (owner feedback 2026-07-21): full-
              // opacity BLACK text on a bordered chip so it reads as a real
              // control, not decoration.
              className="text-xs font-bold text-[var(--text)] bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2.5 py-1 cursor-pointer hover:bg-[var(--bg2)] transition-colors whitespace-nowrap"
            >
              {allCollapsed ? 'Expand All' : 'Collapse All'}
            </button>
          )}
          {!activeMenu.active && (
            <span className="badge badge-green text-xs !bg-[var(--red-bg)] !text-[var(--red)]">
              Inactive
            </span>
          )}
          {/* PDD 2026-05-22 — bulk action button. Always visible when
              bulk mode is enabled (disabled until ≥1 row selected). Uses
              var(--blue) to match BulkActionsPanel's primary action color
              and the active tab underline in the drawer chrome. */}
          {bulkSelectionEnabled && (
            <button
              type="button"
              data-testid="menu-builder-bulk-action"
              onClick={onOpenBulkPanel}
              disabled={!bulkSelection || bulkSelection.size === 0}
              aria-label="Open bulk action panel"
              style={{
                background: bulkSelection && bulkSelection.size > 0
                  ? 'var(--blue)' : '#f0f0f0',
                color: bulkSelection && bulkSelection.size > 0
                  ? '#ffffff' : 'var(--text2)',
                border: 'none',
                fontWeight: 700,
                opacity: bulkSelection && bulkSelection.size > 0 ? 1 : 0.7,
              }}
              className="text-xs rounded-[var(--r-xs)] px-3 py-1.5 whitespace-nowrap disabled:cursor-not-allowed"
            >
              Bulk actions ({bulkSelection?.size ?? 0})
            </button>
          )}
        </div>
      )}

      {/* Category buckets. `scrollbar-gutter: stable` reserves the scrollbar
          track at all times so expanding/collapsing a course or sub-category
          (which grows/shrinks the list past the viewport) never toggles the
          scrollbar on/off — that toggle was shifting every right-aligned
          control (count badges, edit/delete icons) left and right on each
          click. */}
      <div
        data-testid="menu-builder-scroll"
        className="flex-1 overflow-y-auto py-2 [scrollbar-gutter:stable]"
      >
        {searchActive && totalItems === 0 && (
          <div
            data-testid="menu-builder-search-empty"
            className="px-4 py-8 text-center text-xs text-[var(--text2)]"
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

            return (
              <CategoryBucket
                key={cat}
                category={cat}
                displayLabel={sec.label}
                itemIds={sec.itemIds}
                itemsById={itemsById}
                menus={menus}
                menuId={activeMenu!.id}
                collapsed={searchActive ? false : (collapsed[collapseKey] ?? true)}
                getSettings={getSettings}
                color={activeColor}
                onToggleCollapse={() => handleToggleCollapseTracked(collapseKey)}
                onUpdateSettings={onUpdateSettings}
                onUpdateModifiers={onUpdateModifiers}
                onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                onBringIntoMenu={onBringIntoMenu}
                byoHandlers={byoHandlers}
                showAddons={showAddons}
                showRecommendations={showRecommendations}
                showAddGrouping={showAddGrouping}
                perMenuSides={perMenuSides}
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
    </div>
  );
}

// Test-only exports ("_"-prefixed = test-only public, not part of the
// component's public API). Pure helpers behind the course-header raw-category
// chip (2026-06-11) and the scoped row-trash removal decision (2026-06-13).
export {
  deriveBucketRawCategories as _deriveBucketRawCategories,
  computeRowRemoval as _computeRowRemoval,
  // Exported for unit tests only (the edit/delete row-control affordances —
  // size + destructive-red trash). Not part of the public API.
  MenuItemRow as _MenuItemRow,
};

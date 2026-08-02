'use client';
/**
 * BulkMenuSidesPanel — Menu Builder bulk action drawer
 * (PDD 2026-05-22, parallel to BulkActionsPanel).
 *
 * Two-tab drawer for managing per-menu Includes / Choose-One sides
 * across N parent items selected on a single menu in one transaction.
 * Distinct from BulkActionsPanel: that one is Food-Library-scoped and
 * carries the full 11-mode union. This one is menu-scoped and only
 * does Includes + Remove Includes.
 *
 * Drawer chrome (backdrop, header, footer with Error+Progress+Apply)
 * is structurally copied from BulkActionsPanel — refactoring into a
 * shared <BulkDrawerShell> is deferred per amendment 11 until a third
 * bulk panel needs the chrome.
 *
 * Amendments baked in:
 *  - A1: Discovery fires ONCE per tab entry; both zones cached; zone
 *        radio toggling is a pure client-side filter.
 *  - A2: Candidate side rows are expandable to reveal "on N items: X, Y".
 *  - A4: aria-live="polite" wraps discovery-skeleton + candidate-empty
 *        + post-Apply skip-count. Testid bulk-menu-sides-discovery-status.
 *  - A5: Bulk-action button placement handled by the consumer (MenuBuilder).
 *  - A9: Zone-radio change clears removeSelectedIds (candidate pool changes).
 *  - A13: Side item allowlist enforced server-side (dish + included).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import type { MenuAssociation, MenuItemDisplay, MenuItemJunctionSettings } from '../../../types/restaurant';
import { BulkMemberPicker } from './BulkMemberPicker';
import { BOOST_LABELS, isDrinkItem, type BoostLabel } from '../lib/menuUtils';

export type SideType = 'and' | 'or';

export interface BulkMenuSidesParent {
  /** The selected menu_item id (NOT menu_item_menu_id — server resolves). */
  id: string;
  name: string;
}

export interface PerMenuSidesResult {
  sides_and: Array<{ id: string; name: string }>;
  sides_or: Array<{ id: string; name: string }>;
}

export interface BulkMenuSidesPanelProps {
  menuId: string;
  menuName?: string;
  selectedItems: BulkMenuSidesParent[];
  /** How many of the owner's selected items were drinks and got excluded from
   *  this bulk apply (drinks have no "Includes" sides — PDD 2026-06-12 #9).
   *  Rendered as an informational note when > 0. */
  skippedDrinkCount?: number;
  /** Full item pool — drives the Includes-tab picker. The component
   *  filters to allowed side item_types (`dish` + `included`) and
   *  excludes the selected parents to prevent self-reference. */
  pool: MenuItemDisplay[];
  /** Discovery fan-out: load each parent's current sides for THIS menu.
   *  Called ONCE on tab entry per amendment 1 — switching zones does NOT
   *  re-fire. Errors → loadErrors row in the UI with retry. */
  loadPerMenuSides?: (itemId: string) => Promise<PerMenuSidesResult>;
  /** Throw-only contracts (PDD service layer mirrors this). */
  onBulkAddSides?: (
    itemIds: string[],
    body: { side_type: SideType; side_ids: string[] },
  ) => Promise<{
    updated: Array<{
      menu_item_menu_id: string;
      food_item_id: string;
      food_item_name: string;
      sides_added: number;
      sides_skipped: number;
    }>;
  }>;
  onBulkRemoveSides?: (
    itemIds: string[],
    body: { side_type: SideType; side_ids: string[] },
  ) => Promise<{
    updated: Array<{
      menu_item_menu_id: string;
      food_item_id: string;
      food_item_name: string;
      sides_removed: number;
      sides_skipped: number;
    }>;
  }>;
  /**
   * Item Info tab — price / boost / chef's special / portion, per-menu
   * settings. Opt-in and independent of the sides callbacks above: only the
   * fields the owner actually touches are sent (a true partial PATCH per
   * selected item), so a mixed selection can have some items skip a field
   * that doesn't apply — the caller (owner-webapp) fans this out as one
   * updateMenuItemInMenu call per item. For wine items (food_tags.beverage.
   * beverage_type === 'wine'), the patch's `serving_price_overrides` field
   * carries the per-menu By Glass / By Bottle prices instead of `price` —
   * mirrors InlineItemEditor.tsx's single-item save exactly. Returns the
   * updated MenuAssociation[] for that item (same as updateMenuItemInMenu's
   * own return value) so the consumer can optimistically update its local
   * item list without waiting on a refetch — see onItemInfoApplied below.
   */
  onBulkItemInfo?: (
    itemIds: string[],
    patch: Partial<MenuItemJunctionSettings>,
  ) => Promise<MenuAssociation[]>;
  /**
   * Fired once after a successful Item Info Apply with the updated
   * per-item associations, BEFORE onComplete/onClose — lets the consumer
   * merge fresh data into its local item list immediately (mirrors
   * BulkActionsPanel's onComplete(updatedItems, selected) pattern), instead
   * of relying solely on a background refetch (which required a hard
   * refresh to actually show up on the page).
   */
  onItemInfoApplied?: (updates: Array<{ itemId: string; associations: MenuAssociation[] }>) => void;
  /**
   * Bulk single-value junction tabs — Price / Boost / Chef's Special /
   * Portion. Distinct from the "Item info" tab above: each of these applies
   * ONE shared value to every selected item in a single request (via the
   * new /owner/bulk/menus/{menuId}/items/* endpoints), rather than each
   * item keeping its own independently-differing value. Each tab only
   * appears when its own callback is wired, same opt-in pattern as
   * onBulkItemInfo. Wine items use serving_price_overrides for the
   * price tab; everything else uses a flat price.
   */
  onBulkSetPrice?: (
    itemIds: string[],
    patch: { price: number | null } | { serving_price_overrides: { glass?: number; bottle?: number } },
  ) => Promise<{ updated: number }>;
  onBulkSetBoost?: (
    itemIds: string[],
    boostLevel: 'Low' | 'Moderate' | 'High' | null,
  ) => Promise<{ updated: number }>;
  onBulkSetChefsSpecial?: (itemIds: string[], chefsSpecial: boolean) => Promise<{ updated: number }>;
  onBulkSetPortion?: (
    itemIds: string[],
    portionType: 'single' | 'shared',
    portionServes: number | null,
  ) => Promise<{ updated: number }>;
  /** Fired once per successful bulk single-value Apply with the itemIds
   *  touched + the shared patch that was applied to all of them — lets the
   *  consumer force-write junctionSettings directly (same immediate-update
   *  pattern as onItemInfoApplied), no refetch required. */
  onBulkJunctionApplied?: (itemIds: string[], patch: Partial<MenuItemJunctionSettings>) => void;
  onClose: () => void;
  /** Called after a successful Apply — consumer typically refetches
   *  the menu's items + closes the drawer. */
  onComplete?: () => void;
}

type TabKey =
  | 'includes'
  | 'removeIncludes'
  | 'itemInfo'
  | 'bulkPrice'
  | 'bulkBoost'
  | 'bulkChefsSpecial'
  | 'bulkPortion';

// Allowed side item_types (mirrors server-side ALLOWED_SIDE_ITEM_TYPES
// and the existing per-item PUT endpoint's _reject_addons).
const ALLOWED_SIDE_ITEM_TYPES = new Set(['dish', 'included']);

interface CandidateSide {
  id: string;
  name: string;
  present_on: BulkMenuSidesParent[];  // parents that currently have this side in the active zone
}

export default function BulkMenuSidesPanel({
  menuId,
  menuName,
  selectedItems,
  skippedDrinkCount = 0,
  pool,
  loadPerMenuSides,
  onBulkAddSides,
  onBulkRemoveSides,
  onBulkItemInfo,
  onItemInfoApplied,
  onBulkSetPrice,
  onBulkSetBoost,
  onBulkSetChefsSpecial,
  onBulkSetPortion,
  onBulkJunctionApplied,
  onClose,
  onComplete,
}: BulkMenuSidesPanelProps) {
  // ── Tabs — each opt-in on its wired callback, mirrors BulkActionsPanel's
  // availableModes filter chain. Includes/Remove Includes need the full
  // sides trio (add + remove + discovery); Item Info and the 4 bulk
  // single-value tabs each only need their own callback. First available
  // tab wins the initial selection so a consumer that wires only one of
  // these doesn't land on a dead "Includes" tab.
  const sidesWired = !!onBulkAddSides && !!onBulkRemoveSides && !!loadPerMenuSides;
  const availableTabs = useMemo<TabKey[]>(() => {
    const tabs: TabKey[] = [];
    // Item info leads the tab bar (and is the default landing tab when
    // wired) — it's the primary per-item editing surface; everything else
    // (sides + the single-value bulk tabs) follows it.
    if (onBulkItemInfo) tabs.push('itemInfo');
    if (sidesWired) tabs.push('includes', 'removeIncludes');
    if (onBulkSetPrice) tabs.push('bulkPrice');
    if (onBulkSetBoost) tabs.push('bulkBoost');
    if (onBulkSetChefsSpecial) tabs.push('bulkChefsSpecial');
    if (onBulkSetPortion) tabs.push('bulkPortion');
    return tabs;
  }, [sidesWired, onBulkItemInfo, onBulkSetPrice, onBulkSetBoost, onBulkSetChefsSpecial, onBulkSetPortion]);

  // ── Tab + shared state ──────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>(availableTabs[0] ?? 'includes');
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);

  // ── Slide-in / slide-out animation state ─────────────────────────────
  // Component mounts off-screen (translateX(100%)) then transitions to 0
  // on the first frame after mount. On close-request, we set isOpen=false
  // so the transition reverses, then call the parent's onClose after the
  // animation duration so the panel actually unmounts cleanly.
  const SLIDE_MS = 250;
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsOpen(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  function requestClose() {
    setIsOpen(false);
    setTimeout(() => onClose(), SLIDE_MS);
  }
  // Same pattern but invokes onComplete (used after a successful Apply
  // so the success notice is visible during the slide-out instead of
  // disappearing instantly with an abrupt unmount).
  function requestComplete() {
    setIsOpen(false);
    setTimeout(() => onComplete?.(), SLIDE_MS);
  }

  // ── Includes tab state ──────────────────────────────────────────────
  const [addZone, setAddZone] = useState<SideType>('and');
  const [addSelectedIds, setAddSelectedIds] = useState<string[]>([]);
  const [addSearch, setAddSearch] = useState('');

  // ── Remove Includes tab state ───────────────────────────────────────
  // Amendment 1 — cache fires once and stores BOTH zones per parent;
  // zone radio toggle is a pure client-side filter over the cache.
  const [removeZone, setRemoveZone] = useState<SideType>('and');
  const [removeCache, setRemoveCache] = useState<Record<string, PerMenuSidesResult>>({});
  const [removeStatus, setRemoveStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [removeLoadErrors, setRemoveLoadErrors] = useState<BulkMenuSidesParent[]>([]);
  const [removeSelectedIds, setRemoveSelectedIds] = useState<Set<string>>(new Set());
  const [expandedSideIds, setExpandedSideIds] = useState<Set<string>>(new Set());

  const parentIdNameMap = useMemo(
    () => new Map(selectedItems.map((p) => [p.id, p])),
    [selectedItems],
  );

  // ── Item Info tab state — ITEM-LEVEL, not one shared value for the whole
  // selection. Each selected item gets its own editable row, pre-filled from
  // its CURRENT per-menu settings (menu_associations for `menuId`). Apply
  // diffs each item's row against its own initial snapshot and sends only
  // the fields THAT item's row actually changed — a mixed selection can
  // freely differ item to item, and an untouched item is never touched.
  interface ItemInfoRowState {
    price: string;
    boostLabel: 'none' | BoostLabel;
    chefsSpecial: boolean;
    portionType: 'single' | 'shared';
    portionServes: string;
    /** Wine only (food_tags.beverage.beverage_type === 'wine') — per-menu
     *  serving_price_overrides, in dollars. Every other item type/drink uses
     *  the flat `price` field above instead — mirrors InlineItemEditor.tsx. */
    glassPrice: string;
    bottlePrice: string;
  }

  function currentJunctionFor(item: MenuItemDisplay) {
    const assoc = item.menu_associations?.find((a) => a.menu_id === menuId);
    return {
      price: assoc?.price ?? null,
      boost_level: assoc?.boost_level ?? null,
      chefs_special: assoc?.chefs_special ?? false,
      portion_type: assoc?.portion_type ?? ('single' as const),
      portion_serves: assoc?.portion_serves ?? null,
      serving_price_overrides: assoc?.serving_price_overrides ?? null,
    };
  }

  function buildInitialItemInfoRow(item: MenuItemDisplay): ItemInfoRowState {
    const cur = currentJunctionFor(item);
    const boostLabel: 'none' | BoostLabel = cur.boost_level
      ? (BOOST_LABELS[Number(cur.boost_level) - 1] ?? 'none')
      : 'none';
    const overrides = cur.serving_price_overrides ?? {};
    return {
      price: cur.price != null ? String(cur.price) : '',
      boostLabel,
      chefsSpecial: cur.chefs_special,
      portionType: cur.portion_type,
      portionServes: cur.portion_serves != null ? String(cur.portion_serves) : '',
      glassPrice: overrides.glass != null ? String(overrides.glass / 100) : '',
      bottlePrice: overrides.bottle != null ? String(overrides.bottle / 100) : '',
    };
  }

  /** Wine only — mirrors InlineItemEditor.tsx / MenuBuilder.tsx's exact check. */
  function isWineItem(item: MenuItemDisplay): boolean {
    return item.food_tags?.beverage?.beverage_type?.toLowerCase() === 'wine';
  }

  // Seeded once at mount (the drawer is a fresh mount per open — selection
  // doesn't change while it's open) — NOT recomputed on every render, so the
  // owner's in-progress edits aren't clobbered by a pool refresh.
  const [itemInfoRows, setItemInfoRows] = useState<Record<string, ItemInfoRowState>>(() => {
    const rows: Record<string, ItemInfoRowState> = {};
    for (const parent of selectedItems) {
      const full = pool.find((i) => i.id === parent.id);
      if (full) rows[parent.id] = buildInitialItemInfoRow(full);
    }
    return rows;
  });
  const initialItemInfoRowsRef = useRef(itemInfoRows);

  function updateItemInfoRow(itemId: string, patch: Partial<ItemInfoRowState>) {
    setItemInfoRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  const itemInfoHasChanges = useMemo(
    () => Object.keys(itemInfoRows).some(
      (id) => JSON.stringify(itemInfoRows[id]) !== JSON.stringify(initialItemInfoRowsRef.current[id]),
    ),
    [itemInfoRows],
  );

  // Wine rows (By Glass / By Bottle) always render first in the table so
  // they're grouped together, with a small "Wine" badge on the name cell
  // (see render below) making the group visually distinct at a glance.
  const itemInfoOrderedItems = useMemo(() => {
    const wine: BulkMenuSidesParent[] = [];
    const rest: BulkMenuSidesParent[] = [];
    for (const parent of selectedItems) {
      const full = pool.find((i) => i.id === parent.id);
      (full && isWineItem(full) ? wine : rest).push(parent);
    }
    return [...wine, ...rest];
  }, [selectedItems, pool]);

  // ── Bulk single-value tabs — Price / Boost / Chef's Special / Portion.
  // Each applies ONE shared value to every selected item, unlike Item Info's
  // per-item rows above. Price splits the selection by wine/non-wine
  // (mirrors Item Info's own per-row branching) since wine uses
  // serving_price_overrides instead of a flat price.
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkGlassPrice, setBulkGlassPrice] = useState('');
  const [bulkBottlePrice, setBulkBottlePrice] = useState('');
  const [bulkBoostLabel, setBulkBoostLabel] = useState<'none' | BoostLabel>('none');
  // null = neither Mark/Unmark chosen yet — forces an explicit pick before
  // Apply is enabled, rather than defaulting to a value that could silently
  // unmark every selected item.
  const [bulkChefsSpecial, setBulkChefsSpecial] = useState<boolean | null>(null);
  const [bulkPortionType, setBulkPortionType] = useState<'single' | 'shared'>('single');
  const [bulkPortionServes, setBulkPortionServes] = useState('');

  const { bulkPriceWineIds, bulkPriceNonWineIds } = useMemo(() => {
    const wine: string[] = [];
    const nonWine: string[] = [];
    for (const parent of selectedItems) {
      const full = pool.find((i) => i.id === parent.id);
      (full && isWineItem(full) ? wine : nonWine).push(parent.id);
    }
    return { bulkPriceWineIds: wine, bulkPriceNonWineIds: nonWine };
  }, [selectedItems, pool]);

  const bulkPriceHasInput =
    (bulkPriceNonWineIds.length > 0 && bulkPrice.trim() !== '')
    || (bulkPriceWineIds.length > 0 && (bulkGlassPrice.trim() !== '' || bulkBottlePrice.trim() !== ''));

  // Hover tooltip on each section's "(Applies to N items)" count — lists the
  // selected items that fall into that bucket so a mixed selection's
  // wine/non-wine split is inspectable without closing the drawer. Rendered
  // as a real element (not a native title=, whose 1–2s hover delay and
  // touch/unfocused-window gaps made it look broken); capped so a max-size
  // selection doesn't produce a screen-height tooltip.
  const [hoveredPriceCount, setHoveredPriceCount] = useState<'flat' | 'wine' | null>(null);
  function bulkCountNames(ids: string[]): string[] {
    const MAX_TOOLTIP_NAMES = 15;
    const names = ids.map((id) => parentIdNameMap.get(id)?.name ?? id);
    return names.length <= MAX_TOOLTIP_NAMES
      ? names
      : [...names.slice(0, MAX_TOOLTIP_NAMES), `…and ${names.length - MAX_TOOLTIP_NAMES} more`];
  }
  // Shared renderer for the two count spans — hover (or keyboard focus)
  // reveals the bucket's item names in a dark floating list anchored below
  // the count.
  function renderBulkPriceCount(kind: 'flat' | 'wine', ids: string[]) {
    const open = hoveredPriceCount === kind;
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <span
          data-testid={`bulk-price-${kind}-count`}
          tabIndex={0}
          aria-describedby={open ? `bulk-price-${kind}-tooltip` : undefined}
          onMouseEnter={() => setHoveredPriceCount(kind)}
          onMouseLeave={() => setHoveredPriceCount((cur) => (cur === kind ? null : cur))}
          onFocus={() => setHoveredPriceCount(kind)}
          onBlur={() => setHoveredPriceCount((cur) => (cur === kind ? null : cur))}
          style={{ textDecoration: 'underline dotted', cursor: 'help' }}
        >
          (Applies to {ids.length} item{ids.length === 1 ? '' : 's'})
        </span>
        {open && (
          // White card popover — same look as the Food Items table's hover
          // popovers (FoodLibraryView popoverStyle): white bg, border,
          // radius 8, soft shadow, small uppercase header above the list.
          <div
            id={`bulk-price-${kind}-tooltip`}
            data-testid={`bulk-price-${kind}-tooltip`}
            role="tooltip"
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 10,
              minWidth: 180,
              maxWidth: 320,
              background: '#fff',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
              padding: '10px 12px',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text2)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 6,
              }}
            >
              {ids.length === 1 ? '1 item' : `${ids.length} items`}
            </div>
            <div data-testid={`bulk-price-${kind}-tooltip-names`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {bulkCountNames(ids).map((name, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{name}</div>
              ))}
            </div>
          </div>
        )}
      </span>
    );
  }

  async function runBulkPrice() {
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      let totalUpdated = 0;
      const priceTrimmed = bulkPrice.trim();
      if (bulkPriceNonWineIds.length > 0 && priceTrimmed !== '') {
        const p = parseFloat(priceTrimmed);
        if (!isFinite(p) || p < 0) throw new Error('Invalid price');
        const { updated } = await onBulkSetPrice!(bulkPriceNonWineIds, { price: p });
        totalUpdated += updated;
        onBulkJunctionApplied?.(bulkPriceNonWineIds, { price: p });
      }
      const glassTrimmed = bulkGlassPrice.trim();
      const bottleTrimmed = bulkBottlePrice.trim();
      if (bulkPriceWineIds.length > 0 && (glassTrimmed !== '' || bottleTrimmed !== '')) {
        const glassDollars = glassTrimmed === '' ? null : parseFloat(glassTrimmed);
        const bottleDollars = bottleTrimmed === '' ? null : parseFloat(bottleTrimmed);
        if (glassTrimmed !== '' && (!isFinite(glassDollars!) || glassDollars! < 0)) {
          throw new Error('Invalid glass price');
        }
        if (bottleTrimmed !== '' && (!isFinite(bottleDollars!) || bottleDollars! < 0)) {
          throw new Error('Invalid bottle price');
        }
        // An EMPTY box means "leave that serving's price alone". The backend
        // REPLACES the whole serving_price_overrides object, so fold each
        // item's existing per-menu overrides into the payload — otherwise
        // setting only By Bottle silently wiped every wine's glass price.
        // Items whose merged result is identical share one bulk call
        // (a single group in the common case; both boxes filled always
        // collapses to one group since existing values no longer matter).
        const glassCents = glassDollars == null ? null : Math.round(glassDollars * 100);
        const bottleCents = bottleDollars == null ? null : Math.round(bottleDollars * 100);
        const groups = new Map<string, { overrides: { glass?: number; bottle?: number }; ids: string[] }>();
        for (const id of bulkPriceWineIds) {
          const existing = pool.find((i) => i.id === id)?.menu_associations
            ?.find((a) => a.menu_id === menuId)?.serving_price_overrides ?? {};
          const overrides: { glass?: number; bottle?: number } = {};
          const glass = glassCents ?? existing.glass;
          const bottle = bottleCents ?? existing.bottle;
          if (glass != null) overrides.glass = glass;
          if (bottle != null) overrides.bottle = bottle;
          const key = `${overrides.glass ?? ''}:${overrides.bottle ?? ''}`;
          const group = groups.get(key) ?? { overrides, ids: [] };
          group.ids.push(id);
          groups.set(key, group);
        }
        for (const { overrides, ids } of groups.values()) {
          const { updated } = await onBulkSetPrice!(ids, { serving_price_overrides: overrides });
          totalUpdated += updated;
          onBulkJunctionApplied?.(ids, { serving_price_overrides: overrides });
        }
      }
      if (totalUpdated === 0) {
        setError('Change at least one field before applying');
        return;
      }
      setSkipNotice(`Updated ${totalUpdated} item${totalUpdated === 1 ? '' : 's'}`);
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk price update failed');
    } finally {
      setExecuting(false);
    }
  }

  async function runBulkBoost() {
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      const ids = selectedItems.map((p) => p.id);
      const level = bulkBoostLabel === 'none' ? null : bulkBoostLabel;
      const { updated } = await onBulkSetBoost!(ids, level);
      onBulkJunctionApplied?.(ids, {
        boost_level: level ? String(BOOST_LABELS.indexOf(level) + 1) : null,
      });
      setSkipNotice(`Updated ${updated} item${updated === 1 ? '' : 's'}`);
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk boost update failed');
    } finally {
      setExecuting(false);
    }
  }

  async function runBulkChefsSpecial() {
    if (bulkChefsSpecial === null) {
      setError('Choose Mark or Unmark before applying');
      return;
    }
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      const ids = selectedItems.map((p) => p.id);
      const { updated } = await onBulkSetChefsSpecial!(ids, bulkChefsSpecial);
      onBulkJunctionApplied?.(ids, { chefs_special: bulkChefsSpecial });
      setSkipNotice(`Updated ${updated} item${updated === 1 ? '' : 's'}`);
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk chef's special update failed");
    } finally {
      setExecuting(false);
    }
  }

  async function runBulkPortion() {
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      let servesNum: number | null = null;
      if (bulkPortionType === 'shared') {
        const parsed = parseInt(bulkPortionServes, 10);
        if (!isFinite(parsed) || parsed <= 0) throw new Error('Enter a valid serves count');
        servesNum = parsed;
      }
      const ids = selectedItems.map((p) => p.id);
      const { updated } = await onBulkSetPortion!(ids, bulkPortionType, servesNum);
      onBulkJunctionApplied?.(ids, { portion_type: bulkPortionType, portion_serves: servesNum });
      setSkipNotice(`Updated ${updated} item${updated === 1 ? '' : 's'}`);
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk portion update failed');
    } finally {
      setExecuting(false);
    }
  }

  // Hide Crisp chat widget while the drawer is open — the launcher's
  // fixed bottom-right position collides with the panel's Apply
  // button. Crisp uses max-int z-index so we can't out-rank it; the
  // pragmatic fix is to hide its chrome via injected CSS while the
  // drawer mount lasts. Targets every selector Crisp has shipped
  // historically so brittle to-the-vendor-changing-DOM is minimized.
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-bulk-menu-sides-crisp-hide', 'true');
    styleEl.textContent = `
      .crisp-client,
      #crisp-chatbox,
      .cc-1brb6,
      .cc-1obhb,
      [data-bind-id="bind-launcher"],
      iframe[name^="crisp-chatbox"]
        { display: none !important; visibility: hidden !important; }
    `;
    document.head.appendChild(styleEl);
    return () => {
      try { document.head.removeChild(styleEl); } catch { /* already gone */ }
    };
  }, []);

  // Allowed side pool for the Includes-tab picker. Apply the item_type
  // allowlist + exclude selected parents (self-side forbidden).
  const sidePool = useMemo(
    () => pool.filter((i) => i.item_type && ALLOWED_SIDE_ITEM_TYPES.has(i.item_type)),
    [pool],
  );
  // All currently-selected ids — used for self-reference exclusion in the
  // sides picker (a selected parent can't be added as its own side) and for
  // the Item Info tab, which does NOT skip drinks.
  const selectedParentIds = useMemo(
    () => selectedItems.map((p) => p.id),
    [selectedItems],
  );

  // Sides-eligible subset — drinks have no "Includes" sides, so the
  // Includes/Remove-Includes tabs operate on this subset only. Item Info
  // is unaffected and uses the full `selectedItems`/`selectedParentIds` above.
  const sidesEligibleItems = useMemo(() => {
    const drinkIds = new Set(pool.filter((i) => isDrinkItem(i)).map((i) => i.id));
    return selectedItems.filter((p) => !drinkIds.has(p.id));
  }, [selectedItems, pool]);
  const sidesParentIds = useMemo(
    () => sidesEligibleItems.map((p) => p.id),
    [sidesEligibleItems],
  );

  // ── Discovery: fires once on Remove-tab entry; caches BOTH zones ────
  async function fireDiscovery() {
    setRemoveStatus('loading');
    setRemoveCache({});
    setRemoveLoadErrors([]);
    setError(null);
    const results = await Promise.allSettled(
      sidesEligibleItems.map((p) => loadPerMenuSides!(p.id)),
    );
    const cache: Record<string, PerMenuSidesResult> = {};
    const errs: BulkMenuSidesParent[] = [];
    results.forEach((res, i) => {
      const parent = sidesEligibleItems[i];
      if (res.status === 'fulfilled') {
        cache[parent.id] = res.value;
      } else {
        errs.push(parent);
      }
    });
    setRemoveCache(cache);
    setRemoveLoadErrors(errs);
    setRemoveStatus('ready');
  }

  useEffect(() => {
    if (tab === 'removeIncludes' && removeStatus === 'idle') {
      void fireDiscovery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Candidate sides for the active remove zone — derived purely from
  // the cache (amendment 1: no refetch on zone toggle).
  const candidates: CandidateSide[] = useMemo(() => {
    const candidateMap = new Map<string, CandidateSide>();
    for (const parent of sidesEligibleItems) {
      const sides = removeCache[parent.id];
      if (!sides) continue;
      const zoneSides = removeZone === 'and' ? sides.sides_and : sides.sides_or;
      for (const s of zoneSides) {
        const existing = candidateMap.get(s.id);
        if (existing) {
          existing.present_on.push(parent);
        } else {
          candidateMap.set(s.id, {
            id: s.id,
            name: s.name,
            present_on: [parent],
          });
        }
      }
    }
    // Sort by name for stable ordering across re-renders.
    return Array.from(candidateMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [removeCache, removeZone, sidesEligibleItems]);

  // ── Handlers ────────────────────────────────────────────────────────
  function toggleAddMember(id: string) {
    setAddSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Amendment 5 of bulk-add-members — 50-cap at Select (BulkMember-
      // Picker handles the disabled state via maxSelections prop).
      if (prev.length >= 50) return prev;
      return [...prev, id];
    });
  }

  function toggleRemoveSide(id: string) {
    setRemoveSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleExpandSide(id: string) {
    setExpandedSideIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function switchAddZone(next: SideType) {
    if (next === addZone) return;
    setAddZone(next);
    // Per the design — clearing the picker on zone switch avoids the
    // ambiguity of "did I mean to add these to 'and' or 'or'?". The
    // picker selection is zone-specific in user mental model.
    setAddSelectedIds([]);
  }

  function switchRemoveZone(next: SideType) {
    if (next === removeZone) return;
    setRemoveZone(next);
    // Amendment 9 — candidate pool changes when zone flips, so the
    // selected set must reset (sides in 'and' typically aren't the same
    // ones in 'or').
    setRemoveSelectedIds(new Set());
    setExpandedSideIds(new Set());
  }

  async function runAdd() {
    if (addSelectedIds.length === 0) {
      setError('Pick at least one side to add');
      return;
    }
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      const result = await onBulkAddSides!(
        sidesParentIds,
        { side_type: addZone, side_ids: addSelectedIds },
      );
      const totalAdded = result.updated.reduce((s, u) => s + (u.sides_added ?? 0), 0);
      const totalSkipped = result.updated.reduce((s, u) => s + (u.sides_skipped ?? 0), 0);
      setSkipNotice(
        totalSkipped > 0
          ? `Added ${totalAdded} side${totalAdded === 1 ? '' : 's'} (${totalSkipped} already present)`
          : `Added ${totalAdded} side${totalAdded === 1 ? '' : 's'} across ${result.updated.length} item${result.updated.length === 1 ? '' : 's'}`,
      );
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk add sides failed');
    } finally {
      setExecuting(false);
    }
  }

  async function runRemove() {
    if (removeSelectedIds.size === 0) {
      setError('Pick at least one side to remove');
      return;
    }
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      const result = await onBulkRemoveSides!(
        sidesParentIds,
        { side_type: removeZone, side_ids: Array.from(removeSelectedIds) },
      );
      const totalRemoved = result.updated.reduce((s, u) => s + (u.sides_removed ?? 0), 0);
      const totalSkipped = result.updated.reduce((s, u) => s + (u.sides_skipped ?? 0), 0);
      setSkipNotice(
        totalSkipped > 0
          ? `Removed ${totalRemoved} side${totalRemoved === 1 ? '' : 's'} (${totalSkipped} were not present)`
          : `Removed ${totalRemoved} side${totalRemoved === 1 ? '' : 's'} across ${result.updated.length} item${result.updated.length === 1 ? '' : 's'}`,
      );
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk remove sides failed');
    } finally {
      setExecuting(false);
    }
  }

  async function runItemInfo() {
    if (!itemInfoHasChanges) {
      setError('Change at least one field before applying');
      return;
    }
    setExecuting(true);
    setError(null);
    setSkipNotice(null);
    try {
      const initial = initialItemInfoRowsRef.current;
      const tasks: Array<() => Promise<void>> = [];
      const touchedIds = new Set<string>();
      const itemUpdates: Array<{ itemId: string; associations: MenuAssociation[] }> = [];

      for (const parent of selectedItems) {
        const row = itemInfoRows[parent.id];
        const base = initial[parent.id];
        if (!row || !base) continue;

        // Junction fields (price/boost/special/portion) — per item, only the
        // fields THIS item's row actually changed from its own starting point.
        const patch: Partial<MenuItemJunctionSettings> = {};
        if (row.price !== base.price) {
          const trimmed = row.price.trim();
          if (trimmed === '') {
            patch.price = null;
          } else {
            const p = parseFloat(trimmed);
            if (!isFinite(p) || p < 0) throw new Error(`Invalid price for "${parent.name}"`);
            patch.price = p;
          }
        }
        if (row.boostLabel !== base.boostLabel) {
          patch.boost_level = row.boostLabel === 'none' ? null : String(BOOST_LABELS.indexOf(row.boostLabel) + 1);
        }
        if (row.chefsSpecial !== base.chefsSpecial) {
          patch.chefs_special = row.chefsSpecial;
        }
        if (row.portionType !== base.portionType || row.portionServes !== base.portionServes) {
          patch.portion_type = row.portionType;
          if (row.portionType === 'shared') {
            const serves = parseInt(row.portionServes, 10);
            patch.portion_serves = isFinite(serves) && serves > 0 ? serves : null;
          } else {
            patch.portion_serves = null;
          }
        }

        // By Glass / By Bottle (wine only) — folds into the SAME per-menu
        // junction patch as price/boost/special/portion above, exactly like
        // InlineItemEditor.tsx's single-item save (one updateMenuItemInMenu
        // call carries both). Only sent when THIS item's own glass/bottle
        // price changed; requires at least one of the two to stay populated,
        // matching InlineItemEditor's validation.
        if (row.glassPrice !== base.glassPrice || row.bottlePrice !== base.bottlePrice) {
          const glassTrimmed = row.glassPrice.trim();
          const bottleTrimmed = row.bottlePrice.trim();
          const glassDollars = glassTrimmed === '' ? null : parseFloat(glassTrimmed);
          const bottleDollars = bottleTrimmed === '' ? null : parseFloat(bottleTrimmed);
          if (glassTrimmed !== '' && (!isFinite(glassDollars!) || glassDollars! < 0)) {
            throw new Error(`Invalid glass price for "${parent.name}"`);
          }
          if (bottleTrimmed !== '' && (!isFinite(bottleDollars!) || bottleDollars! < 0)) {
            throw new Error(`Invalid bottle price for "${parent.name}"`);
          }
          if (glassDollars == null && bottleDollars == null) {
            throw new Error(`Enter at least a glass or bottle price for "${parent.name}"`);
          }
          const overrides: Record<string, number> = {};
          if (glassDollars != null) overrides.glass = Math.round(glassDollars * 100);
          if (bottleDollars != null) overrides.bottle = Math.round(bottleDollars * 100);
          patch.serving_price_overrides = overrides;
        }

        if (Object.keys(patch).length > 0) {
          touchedIds.add(parent.id);
          tasks.push(async () => {
            const associations = await onBulkItemInfo!([parent.id], patch);
            itemUpdates.push({ itemId: parent.id, associations });
          });
        }
      }

      if (tasks.length === 0) {
        setError('Change at least one field before applying');
        return;
      }
      await Promise.all(tasks.map((t) => t()));
      initialItemInfoRowsRef.current = itemInfoRows; // new baseline post-Apply
      // Optimistic update — hand the fresh per-item associations back to the
      // consumer immediately, so the main page reflects the change without
      // waiting on (or requiring) a hard refresh.
      onItemInfoApplied?.(itemUpdates);
      setSkipNotice(`Updated ${touchedIds.size} item${touchedIds.size === 1 ? '' : 's'}`);
      requestComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk item info update failed');
    } finally {
      setExecuting(false);
    }
  }

  function onApply() {
    setError(null);
    if (tab === 'includes') {
      void runAdd();
    } else if (tab === 'removeIncludes') {
      void runRemove();
    } else if (tab === 'itemInfo') {
      void runItemInfo();
    } else if (tab === 'bulkPrice') {
      void runBulkPrice();
    } else if (tab === 'bulkBoost') {
      void runBulkBoost();
    } else if (tab === 'bulkChefsSpecial') {
      void runBulkChefsSpecial();
    } else {
      void runBulkPortion();
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  const itemCount = selectedItems.length;
  const applyDisabled =
    executing
    || (tab === 'includes' && (addSelectedIds.length === 0 || sidesEligibleItems.length === 0))
    || (tab === 'removeIncludes' && (removeSelectedIds.size === 0 || sidesEligibleItems.length === 0))
    || (tab === 'itemInfo' && !itemInfoHasChanges)
    || (tab === 'bulkPrice' && !bulkPriceHasInput)
    || (tab === 'bulkChefsSpecial' && bulkChefsSpecial === null)
    || (tab === 'bulkPortion' && bulkPortionType === 'shared' && bulkPortionServes.trim() === '');

  return (
    <>
      <div
        onClick={requestClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.15)',
          opacity: isOpen ? 1 : 0,
          transition: `opacity ${SLIDE_MS}ms ease-out`,
        }}
        data-testid="bulk-menu-sides-backdrop"
      />
      <div
        data-testid="bulk-menu-sides-panel"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '50vw', minWidth: 360, zIndex: 50,
          background: 'var(--white)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: `transform ${SLIDE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          willChange: 'transform',
        }}
      >
        {/* Header — mirrors BulkActionsPanel layout (title + subtitle
            count + close icon) for visual parity. */}
        <div
          style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              Bulk actions
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
              {itemCount} item{itemCount === 1 ? '' : 's'} selected
              {menuName ? ` · ${menuName}` : ''}
            </div>
            {/* Drinks are only skipped on the sides tabs (no "Includes" for
                drinks) — Item Info applies to every selected item, drinks
                included, so this note is irrelevant there. */}
            {skippedDrinkCount > 0 && tab !== 'itemInfo' && (
              <div
                data-testid="bulk-menu-sides-skipped-drinks"
                role="status"
                style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}
              >
                {skippedDrinkCount} drink{skippedDrinkCount === 1 ? '' : 's'} skipped — drinks don’t have sides
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid="bulk-menu-sides-close-btn"
            onClick={requestClose}
            aria-label="Close bulk panel"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text2)', padding: 4, borderRadius: 4,
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Item preview chips — mirrors BulkActionsPanel. Shows up to 4
            parent names + "+N more". */}
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {selectedItems.slice(0, 4).map((p) => (
            <span
              key={p.id}
              style={{
                fontSize: 11,
                fontWeight: 500,
                background: '#f0f0f0',
                color: 'var(--text)',
                borderRadius: 4,
                padding: '2px 7px',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={p.name}
            >
              {p.name}
            </span>
          ))}
          {itemCount > 4 && (
            <span style={{ fontSize: 11, color: 'var(--text2)', padding: '2px 4px' }}>
              +{itemCount - 4} more
            </span>
          )}
        </div>

        {/* Tab bar — matches BulkActionsPanel's mode-tab style:
            var(--blue) active, var(--text2) inactive, 2px underline. */}
        <div
          data-testid="bulk-menu-sides-tab-bar"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {availableTabs.map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`bulk-menu-sides-tab-${k}`}
              onClick={() => setTab(k)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '9px 12px',
                fontSize: 11,
                fontWeight: 600,
                color: tab === k ? 'var(--blue)' : 'var(--text2)',
                background: 'transparent',
                border: 'none',
                borderBottom: tab === k ? '2px solid var(--blue)' : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {k === 'includes' ? 'Includes'
                : k === 'removeIncludes' ? 'Remove Includes'
                : k === 'itemInfo' ? 'Item info'
                : k === 'bulkPrice' ? 'Price'
                : k === 'bulkBoost' ? 'Boost'
                : k === 'bulkChefsSpecial' ? "Chef's Special"
                : 'Portion'}
            </button>
          ))}
        </div>

        {/* Body — flex column with minHeight:0 so child lists can
            flex-fill (pickers extend down to the footer). */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: 16,
          }}
        >
          {tab === 'includes' && (
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                flex: 1, minHeight: 0,
              }}
            >
              <ZoneRadio
                value={addZone}
                onChange={switchAddZone}
                testidPrefix="bulk-menu-sides-add"
              />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Adds the picked sides to the selected zone on each of the {sidesEligibleItems.length}{' '}
                eligible item{sidesEligibleItems.length === 1 ? '' : 's'} (drinks don't have sides,
                so they're skipped here). Sides already present on a particular item are silently
                skipped.
              </div>
              <BulkMemberPicker
                pool={sidePool}
                selectedIds={addSelectedIds}
                search={addSearch}
                onToggle={toggleAddMember}
                onClearAll={() => setAddSelectedIds([])}
                onChangeSearch={setAddSearch}
                onSelectAll={(ids) =>
                  setAddSelectedIds((prev) => [
                    ...prev,
                    ...ids.filter((id) => !prev.includes(id)),
                  ])
                }
                testidPrefix="bulk-menu-sides"
                excludeIds={selectedParentIds}
                searchPlaceholder="Search sides to add…"
                fillHeight
                enableCategoryFilter
              />
            </div>
          )}

          {tab === 'removeIncludes' && (
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 12,
                flex: 1, minHeight: 0,
              }}
            >
              <ZoneRadio
                value={removeZone}
                onChange={switchRemoveZone}
                testidPrefix="bulk-menu-sides-remove"
              />

              {/* Amendment 4 — aria-live region for discovery state */}
              <div
                data-testid="bulk-menu-sides-discovery-status"
                aria-live="polite"
                style={{ fontSize: 12, color: 'var(--muted)' }}
              >
                {removeStatus === 'loading' && (
                  <div data-testid="bulk-menu-sides-remove-loading">
                    Loading current sides…
                  </div>
                )}
                {removeStatus === 'ready' && candidates.length === 0 && (
                  <div data-testid="bulk-menu-sides-remove-empty">
                    No sides in {removeZone === 'and' ? 'Includes (All)' : 'Choose-One'} on the selected items.
                  </div>
                )}
              </div>

              {/* Per-parent load-error rows */}
              {removeLoadErrors.length > 0 && (
                <div
                  data-testid="bulk-menu-sides-discovery-errors"
                  role="alert"
                  style={{
                    background: '#fef3c7',
                    border: '1px solid #fcd34d',
                    borderRadius: 'var(--r-xs)',
                    padding: '8px 10px',
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
                    Couldn't load sides for {removeLoadErrors.length} item{removeLoadErrors.length === 1 ? '' : 's'}
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 16px', color: '#78350f' }}>
                    {removeLoadErrors.map((p) => (
                      <li
                        key={p.id}
                        data-testid={`bulk-menu-sides-discovery-error-${p.id}`}
                      >
                        {p.name}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    data-testid="bulk-menu-sides-discovery-retry"
                    onClick={() => { void fireDiscovery(); }}
                    style={{
                      marginTop: 6,
                      fontSize: 11, padding: '3px 8px',
                      background: '#fff', border: '1px solid #fcd34d',
                      borderRadius: 'var(--r-xs)', cursor: 'pointer',
                      color: '#92400e',
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Candidate side list with expand-to-reveal parents */}
              {removeStatus === 'ready' && candidates.length > 0 && (
                <div
                  data-testid="bulk-menu-sides-remove-candidates"
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-xs)',
                    background: '#fff',
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                  }}
                >
                  {candidates.map((c) => {
                    const expanded = expandedSideIds.has(c.id);
                    const checked = removeSelectedIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        data-testid={`bulk-menu-sides-remove-side-row-${c.id}`}
                        style={{
                          display: 'flex', flexDirection: 'column',
                          borderBottom: '1px solid var(--border)',
                          // Selected = same brand-light tint the picker
                          // uses for selected rows → visual parity across
                          // both drawers' list surfaces.
                          background: checked ? 'var(--brand-l)' : '#fff',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 10px',
                          }}
                        >
                          <input
                            type="checkbox"
                            data-testid={`bulk-menu-sides-remove-side-checkbox-${c.id}`}
                            checked={checked}
                            onChange={() => toggleRemoveSide(c.id)}
                            aria-label={`Select ${c.name} for removal`}
                          />
                          <span style={{ flex: 1, fontSize: 12 }}>
                            {c.name}
                          </span>
                          <button
                            type="button"
                            data-testid={`bulk-menu-sides-remove-side-expand-${c.id}`}
                            onClick={() => toggleExpandSide(c.id)}
                            aria-label={expanded ? `Collapse details for ${c.name}` : `Expand details for ${c.name}`}
                            aria-expanded={expanded}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              fontSize: 11, padding: '3px 6px',
                              background: 'transparent', border: 'none',
                              cursor: 'pointer', color: 'var(--muted)',
                            }}
                          >
                            on {c.present_on.length} item{c.present_on.length === 1 ? '' : 's'}
                            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        </div>
                        {expanded && (
                          <div
                            data-testid={`bulk-menu-sides-remove-side-detail-${c.id}`}
                            style={{
                              fontSize: 11, color: 'var(--muted)',
                              padding: '0 10px 8px 32px',
                            }}
                          >
                            {c.present_on.map((p) => p.name).join(' · ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'itemInfo' && (
            <div
              style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                flex: 1, minHeight: 0,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Price, boost, and portion are per-menu — each row below is that
                item's setting on {menuName ?? 'this menu'} only. Wine prices By Glass /
                By Bottle instead of a flat price. Only the cells you change are applied;
                untouched cells are left exactly as they are.
              </div>
              <div
                data-testid="bulk-item-info-table"
                style={{
                  flex: 1, minHeight: 0, overflow: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-xs)',
                  background: '#fff',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', minWidth: 140 }}>Item</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 140 }}>Price</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 100 }}>Boost</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 70 }}>Special</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 140 }}>Portion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemInfoOrderedItems.map((parent) => {
                      const row = itemInfoRows[parent.id];
                      if (!row) return null;
                      const full = pool.find((i) => i.id === parent.id);
                      const isWine = full ? isWineItem(full) : false;
                      return (
                        <tr key={parent.id} data-testid={`bulk-item-info-row-${parent.id}`}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{parent.name}</span>
                              {isWine && (
                                <span
                                  data-testid={`bulk-item-info-wine-badge-${parent.id}`}
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 8,
                                    fontWeight: 700,
                                    color: '#b91c1c',
                                    background: '#fee2e2',
                                    border: '1px solid #fca5a5',
                                    borderRadius: 8,
                                    padding: '1px 5px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.03em',
                                  }}
                                >
                                  Wine
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                            {isWine ? (
                              // Wine prices By Glass / By Bottle instead of a flat
                              // price (mirrors InlineItemEditor.tsx). Every other
                              // drink (beer, cocktails, soda, ...) uses the normal
                              // flat price input below, same as a food item.
                              <div style={{ display: 'flex', gap: 4 }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: 'var(--muted)' }}>
                                  By Glass
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    data-testid={`bulk-item-info-glass-${parent.id}`}
                                    value={row.glassPrice}
                                    onChange={(e) => updateItemInfoRow(parent.id, { glassPrice: e.target.value.replace(/[^0-9.]/g, '') })}
                                    style={{ width: 56, padding: '5px 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 12 }}
                                  />
                                </label>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: 'var(--muted)' }}>
                                  By Bottle
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    data-testid={`bulk-item-info-bottle-${parent.id}`}
                                    value={row.bottlePrice}
                                    onChange={(e) => updateItemInfoRow(parent.id, { bottlePrice: e.target.value.replace(/[^0-9.]/g, '') })}
                                    style={{ width: 56, padding: '5px 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 12 }}
                                  />
                                </label>
                              </div>
                            ) : (
                              <input
                                type="text"
                                inputMode="decimal"
                                data-testid={`bulk-item-info-price-${parent.id}`}
                                value={row.price}
                                onChange={(e) => updateItemInfoRow(parent.id, { price: e.target.value.replace(/[^0-9.]/g, '') })}
                                style={{ width: '100%', padding: '5px 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 12 }}
                              />
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                            <select
                              data-testid={`bulk-item-info-boost-${parent.id}`}
                              value={row.boostLabel}
                              onChange={(e) => updateItemInfoRow(parent.id, { boostLabel: e.target.value as ItemInfoRowState['boostLabel'] })}
                              style={{ width: '100%', padding: '5px 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 12 }}
                            >
                              <option value="none">None</option>
                              {BOOST_LABELS.map((label) => (
                                <option key={label} value={label}>{label}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              data-testid={`bulk-item-info-special-${parent.id}`}
                              checked={row.chefsSpecial}
                              onChange={(e) => updateItemInfoRow(parent.id, { chefsSpecial: e.target.checked })}
                              aria-label={`Chef's special for ${parent.name}`}
                            />
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <select
                                data-testid={`bulk-item-info-portion-type-${parent.id}`}
                                value={row.portionType}
                                onChange={(e) => updateItemInfoRow(parent.id, { portionType: e.target.value as 'single' | 'shared' })}
                                style={{ padding: '5px 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 12 }}
                              >
                                <option value="single">Single</option>
                                <option value="shared">Shared</option>
                              </select>
                              {row.portionType === 'shared' && (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  data-testid={`bulk-item-info-portion-serves-${parent.id}`}
                                  value={row.portionServes}
                                  placeholder="Serves"
                                  onChange={(e) => updateItemInfoRow(parent.id, { portionServes: e.target.value.replace(/[^0-9]/g, '') })}
                                  style={{ width: 52, padding: '5px 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 12 }}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'bulkPrice' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Sets ONE price for every selected item on {menuName ?? 'this menu'}. Wine
                items price By Glass / By Bottle instead of a flat price. A box left
                empty changes nothing — e.g. filling only By Bottle keeps each
                wine&apos;s existing glass price.
              </div>
              {bulkPriceNonWineIds.length > 0 && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span>
                    <strong>Price</strong>{' '}
                    {renderBulkPriceCount('flat', bulkPriceNonWineIds)}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    data-testid="bulk-price-flat-input"
                    value={bulkPrice}
                    onChange={(e) => setBulkPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    style={{ padding: '6px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13, width: 140 }}
                  />
                </label>
              )}
              {bulkPriceWineIds.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 12 }}>
                    <strong>Price for Wines</strong>{' '}
                    {renderBulkPriceCount('wine', bulkPriceWineIds)}
                  </span>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      By Glass
                      <input
                        type="text"
                        inputMode="decimal"
                        data-testid="bulk-price-glass-input"
                        value={bulkGlassPrice}
                        onChange={(e) => setBulkGlassPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                        style={{ padding: '6px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13, width: 100 }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                      By Bottle
                      <input
                        type="text"
                        inputMode="decimal"
                        data-testid="bulk-price-bottle-input"
                        value={bulkBottlePrice}
                        onChange={(e) => setBulkBottlePrice(e.target.value.replace(/[^0-9.]/g, ''))}
                        style={{ padding: '6px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13, width: 100 }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'bulkBoost' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Sets ONE boost level for all {itemCount} selected item{itemCount === 1 ? '' : 's'} on {menuName ?? 'this menu'}.
              </div>
              <select
                data-testid="bulk-boost-select"
                value={bulkBoostLabel}
                onChange={(e) => setBulkBoostLabel(e.target.value as 'none' | BoostLabel)}
                style={{ padding: '6px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13, width: 160 }}
              >
                <option value="none">None</option>
                {BOOST_LABELS.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </div>
          )}

          {tab === 'bulkChefsSpecial' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Sets chef&apos;s special for all {itemCount} selected item{itemCount === 1 ? '' : 's'} on {menuName ?? 'this menu'}.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="bulk-chefs-special"
                    data-testid="bulk-chefs-special-mark"
                    checked={bulkChefsSpecial === true}
                    onChange={() => setBulkChefsSpecial(true)}
                  />
                  Mark as Chef&apos;s Special
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="bulk-chefs-special"
                    data-testid="bulk-chefs-special-unmark"
                    checked={bulkChefsSpecial === false}
                    onChange={() => setBulkChefsSpecial(false)}
                  />
                  Unmark as Chef&apos;s Special
                </label>
              </div>
            </div>
          )}

          {tab === 'bulkPortion' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Sets ONE portion type for all {itemCount} selected item{itemCount === 1 ? '' : 's'} on {menuName ?? 'this menu'}.
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  data-testid="bulk-portion-type-select"
                  value={bulkPortionType}
                  onChange={(e) => setBulkPortionType(e.target.value as 'single' | 'shared')}
                  style={{ padding: '6px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
                >
                  <option value="single">Single</option>
                  <option value="shared">Shared</option>
                </select>
                {bulkPortionType === 'shared' && (
                  <input
                    type="text"
                    inputMode="numeric"
                    data-testid="bulk-portion-serves-input"
                    placeholder="Serves"
                    value={bulkPortionServes}
                    onChange={(e) => setBulkPortionServes(e.target.value.replace(/[^0-9]/g, ''))}
                    style={{ width: 70, padding: '6px 8px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', fontSize: 13 }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          {error && (
            <div
              data-testid="bulk-menu-sides-error-banner"
              role="alert"
              style={{
                fontSize: 11, color: '#b91c1c', background: '#fee2e2',
                borderRadius: 4, padding: '6px 10px',
              }}
            >
              {error}
            </div>
          )}
          {skipNotice && (
            <div
              data-testid="bulk-menu-sides-skipped-count"
              aria-live="polite"
              style={{
                fontSize: 11, color: '#065f46', background: '#d1fae5',
                borderRadius: 4, padding: '6px 10px',
              }}
            >
              {skipNotice}
            </div>
          )}
          {/* Cancel + Apply — same 1:2 flex ratio + colors as BulkActionsPanel */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="bulk-menu-sides-cancel-btn"
              onClick={requestClose}
              disabled={executing}
              style={{
                flex: 1,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text2)',
                background: '#f0f0f0',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: executing ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="bulk-menu-sides-apply-btn"
              onClick={onApply}
              disabled={applyDisabled}
              style={{
                flex: 2,
                padding: '8px 0',
                fontSize: 12,
                fontWeight: 700,
                color: 'white',
                background: applyDisabled ? 'var(--text2)' : 'var(--blue)',
                border: 'none',
                borderRadius: 'var(--r-xs)',
                cursor: applyDisabled ? 'not-allowed' : 'pointer',
                opacity: applyDisabled ? 0.6 : 1,
              }}
            >
              {executing
                ? 'Applying…'
                : tab === 'includes'
                  ? `Add ${addSelectedIds.length} side${addSelectedIds.length === 1 ? '' : 's'} to ${sidesEligibleItems.length} item${sidesEligibleItems.length === 1 ? '' : 's'}`
                  : tab === 'removeIncludes'
                    ? `Remove ${removeSelectedIds.size} side${removeSelectedIds.size === 1 ? '' : 's'} from ${sidesEligibleItems.length} item${sidesEligibleItems.length === 1 ? '' : 's'}`
                    : `Apply to ${itemCount} item${itemCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

interface ZoneRadioProps {
  value: SideType;
  onChange: (v: SideType) => void;
  testidPrefix: string;
}

function ZoneRadio({ value, onChange, testidPrefix }: ZoneRadioProps) {
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '10px 12px',
        background: '#f9fafb',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xs)',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
        <input
          type="radio"
          data-testid={`${testidPrefix}-zone-and`}
          name={`${testidPrefix}-zone`}
          checked={value === 'and'}
          onChange={() => onChange('and')}
        />
        Includes (All) — free, comes with the dish
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
        <input
          type="radio"
          data-testid={`${testidPrefix}-zone-or`}
          name={`${testidPrefix}-zone`}
          checked={value === 'or'}
          onChange={() => onChange('or')}
        />
        Choose-One — diner picks one
      </label>
    </div>
  );
}

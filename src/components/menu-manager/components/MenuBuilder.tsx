'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Star, Plus, Pencil, Check, X, Trash2 } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary, MenuItemJunctionSettings } from '../../../types/restaurant';
import { CANONICAL_CATEGORIES, type MenuColor, intToBoostLabel, BOOST_LABELS } from '../lib/menuUtils';
import { COLOR_WARNING } from '../../../constants/colors';
import { countApprovedAddons } from '../lib/addonHelpers';
import type { DragState } from '../MenuManagerClient';
import ItemModifierZones, { type ModifierEntry, type ModifierUpdatePayload } from './ItemModifierZones';
import MobileItemModifierPicker from './MobileItemModifierPicker';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useTrackAction } from '../track-action-context';

export type { ModifierUpdatePayload };
export type { ModifierEntry };

// ── Attention rules ──────────────────────────────────────────────────────────
// An item-in-menu "needs attention" when its displayed price would be empty —
// i.e. neither the per-menu price override nor the base item price is set.
// Used to paint a red border on the MenuItemRow + a count badge on the bucket
// header. STR-251 round 3.
function itemHasAttention(item: MenuItemDisplay, settings: MenuItemJunctionSettings): boolean {
  if (settings.price != null) return false;
  if (item.price != null) return false;
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
  dragOver: { menuId: string; cat: string } | 'pool' | null;
  colorMap: (index: number) => MenuColor;
  getSettings: (menuId: string, itemId: string) => MenuItemJunctionSettings;
  onTabChange: (menuId: string) => void;
  onToggleCollapse: (key: string) => void;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onDragEnterBucket: (e: React.DragEvent, menuId: string, cat: string) => void;
  onDragLeaveBucket: (menuId: string, cat: string) => void;
  onDropBucket: (e: React.DragEvent, menuId: string, cat: string) => void;
  onCreateMenu: (name: string) => Promise<void>;
  onEditMenu: (menuId: string) => void;
  onRemoveItemFromMenu: (itemId: string, menuId: string) => void;
  onEditItem: (itemId: string) => void;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  /**
   * Optional gate called before a dropped item is added as a recommendation.
   * Forwarded to both desktop (ItemModifierZones) and mobile (MobileItemModifierPicker).
   * See `ItemModifierZones.onConfirmRecommendationDrop` for the contract.
   */
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /**
   * STR-342 feature flag. When true, the sides drop zone splits into two
   * stacked zones (Included + Choice) and counters show "N included / M choice".
   * When false/undefined, legacy single-drop-zone + AND/OR dropdown renders.
   */
  enableAndOrSplit?: boolean;
  /**
   * STR-342 cross-group duplicate callback. Fires when the owner drops an item
   * onto one split-sides zone while the item already exists in the other group.
   * Arg = the group the item is ALREADY in (so the consumer can show a toast
   * like "Already in [Included/Choice] — remove first"). Only invoked when
   * `enableAndOrSplit` is true.
   */
  onCrossGroupDuplicate?: (existingGroup: 'included' | 'choice') => void;
  /** When set, scroll to + expand the first occurrence of this item in the active menu */
  scrollToItemId?: string | null;
  onScrollComplete?: () => void;
  /** Callback to re-fetch menus + items from server (for crawl-mid-session refresh). */
  onRefresh?: () => void;
  /** True while a background refresh is in flight. */
  refreshing?: boolean;
  /** Collapse or expand all category buckets at once. */
  onCollapseAll?: (collapse: boolean) => void;
}

// ── ModifierCounter ───────────────────────────────────────────────────────────
// Colored pill showing the number of modifiers of a given kind (sides,
// recommendations, addons) attached to a menu item. Distinct palettes per type
// let owners tell them apart at a glance.
const COUNTER_PALETTE: Record<'side' | 'recommendation' | 'addon', { bg: string; fg: string; border: string }> = {
  side:           { bg: '#dcfce7', fg: '#166534', border: '#86efac' }, // green
  recommendation: { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' }, // blue
  addon:          { bg: '#ffedd5', fg: '#9a3412', border: '#fb923c' }, // orange
};

function ModifierCounter({
  kind,
  count,
  itemId,
  label,
}: {
  kind: 'side' | 'recommendation' | 'addon';
  count: number;
  itemId: string;
  label: string;
}) {
  if (count <= 0) return null;
  const palette = COUNTER_PALETTE[kind];
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-px rounded shrink-0"
      data-testid={`modifier-counter-${kind}-${itemId}`}
      style={{ background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
    >
      {count} {label}{count !== 1 ? 's' : ''}
    </span>
  );
}

// ── MenuItemRow ───────────────────────────────────────────────────────────────

function MenuItemRow({
  item,
  menuId,
  cat,
  settings,
  itemsById,
  onUpdateSettings,
  onUpdateModifiers,
  onConfirmRecommendationDrop,
  enableAndOrSplit = false,
  onCrossGroupDuplicate,
  onDragStart,
  onDragEnd,
  onRemove,
  onEdit,
}: {
  item: MenuItemDisplay;
  menuId: string;
  cat: string;
  settings: MenuItemJunctionSettings;
  itemsById: Map<string, MenuItemDisplay>;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /** STR-342 — feature-flag gated split Sides UI. See MenuBuilderProps. */
  enableAndOrSplit?: boolean;
  /** STR-342 — cross-group duplicate toast callback. See MenuBuilderProps. */
  onCrossGroupDuplicate?: (existingGroup: 'included' | 'choice') => void;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onRemove: () => void;
  onEdit: () => void;
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
  // STR-342: when the split-Sides flag is ON, read split arrays directly so
  // the two counters stay accurate even before the first save round-trips
  // legacy `sides`. When flag is OFF, fall back to the combined legacy count.
  const includedCount = item.sides_and?.length ?? 0;
  const choiceCount = item.sides_or?.length ?? 0;
  const sidesCount = enableAndOrSplit
    ? includedCount + choiceCount
    : item.sides?.length ?? 0;
  const recsCount = item.recommendations?.length ?? 0;

  const borderLeftColor = attention ? 'var(--red)' : 'transparent';

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(e, item.id, menuId, cat); }}
      onDragEnd={onDragEnd}
      data-testid={`menu-item-row-${item.id}`}
      data-item-row-id={item.id}
      data-expanded={expanded ? 'true' : 'false'}
      data-attention={attention ? 'true' : undefined}
      data-approved-addons={approvedAddons > 0 ? approvedAddons : undefined}
      className={`w-full border-b border-[var(--border)] cursor-grab ${expanded ? 'bg-[var(--bg)]' : ''}`}
      style={{ borderLeft: `3px solid ${borderLeftColor}` }}
    >
      <div className="flex items-stretch w-full">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`menu-item-expand-${item.id}`}
        data-expand-btn="true"
        className={`flex-1 min-w-0 bg-transparent border-none cursor-grab text-left ${isMobile ? 'flex flex-col gap-1 px-2 py-2' : 'flex flex-row items-center gap-2 px-3 py-2'}`}
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
                {saving && (
                  <span className="text-xs text-[var(--text2)]">saving…</span>
                )}
              </div>
            </div>

            {/* Mobile row 2 — modifier counters (sides, recs, addons) */}
            {(sidesCount > 0 || recsCount > 0 || approvedAddons > 0) && (
              <div className="flex items-center gap-1.5 pl-5 w-full">
                {enableAndOrSplit ? (
                  <>
                    <ModifierCounter kind="side" count={includedCount} itemId={`${item.id}-included`} label="included" />
                    <ModifierCounter kind="side" count={choiceCount} itemId={`${item.id}-choice`} label="choice" />
                  </>
                ) : (
                  <ModifierCounter kind="side" count={sidesCount} itemId={item.id} label="side" />
                )}
                <ModifierCounter kind="recommendation" count={recsCount} itemId={item.id} label="rec" />
                <ModifierCounter kind="addon" count={approvedAddons} itemId={item.id} label="addon" />
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

            {/* Modifier counters — sides, recs, addons */}
            <div className="flex items-center gap-1 shrink-0 ml-1">
              {enableAndOrSplit ? (
                <>
                  <ModifierCounter kind="side" count={includedCount} itemId={`${item.id}-included`} label="included" />
                  <ModifierCounter kind="side" count={choiceCount} itemId={`${item.id}-choice`} label="choice" />
                </>
              ) : (
                <ModifierCounter kind="side" count={sidesCount} itemId={item.id} label="side" />
              )}
              <ModifierCounter kind="recommendation" count={recsCount} itemId={item.id} label="rec" />
              <ModifierCounter kind="addon" count={approvedAddons} itemId={item.id} label="addon" />
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
            </div>

            {saving && (
              <span className="text-xs text-[var(--text2)] ml-1">saving…</span>
            )}
          </>
        )}
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        data-testid={`edit-menu-item-${item.id}`}
        aria-label={`Edit ${item.name}`}
        title="Edit item"
        className="shrink-0 w-8 p-0 bg-transparent border-none border-l border-l-[var(--border)] text-[var(--text2)] cursor-pointer flex items-center justify-center hover:text-[var(--text)]"
      >
        <Pencil size={14} />
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        data-testid={`remove-from-menu-${item.id}`}
        aria-label={`Remove ${item.name} from menu`}
        title="Remove from menu"
        className="shrink-0 w-8 p-0 bg-transparent border-none border-l border-l-[var(--border)] text-[var(--text2)] cursor-pointer flex items-center justify-center hover:text-[var(--red)]"
      >
        <Trash2 size={14} />
      </button>
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
                    className="border-none outline-none text-xs w-[60px] bg-transparent text-[var(--text)]"
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
                    className="border-none outline-none text-xs w-[60px] bg-transparent text-[var(--text)]"
                  />
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="w-px h-4 bg-[var(--border)] shrink-0" />

            {/* Boost dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="section-header !mb-0 shrink-0">Boost</span>
              <select
                value={boostLabel ?? ''}
                onChange={(e) => handleBoostChange(e.target.value || null)}
                data-testid={`boost-select-${item.id}`}
                className="text-xs border border-[var(--border)] rounded-[var(--r-xs)] py-0.5 px-2 outline-none bg-white cursor-pointer text-[var(--text)]"
              >
                <option value="">None</option>
                {BOOST_LABELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
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
                    className="border border-[var(--border)] rounded-[var(--r-xs)] py-0.5 px-1.5 text-xs w-10 outline-none"
                  />
                  <span className="text-xs text-[var(--text2)]">guests</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Sides | Addons | Recommendations panels ─────────────────── */}
          <div className="w-full">
            {isMobile ? (
              <MobileItemModifierPicker
                parent={item}
                itemsById={itemsById}
                currentMenuId={menuId}
                onUpdate={onUpdateModifiers}
                onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                enableAndOrSplit={enableAndOrSplit}
              />
            ) : (
              <ItemModifierZones
                parent={item}
                itemsById={itemsById}
                currentMenuId={menuId}
                onUpdate={onUpdateModifiers}
                onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                enableAndOrSplit={enableAndOrSplit}
                onCrossGroupDuplicate={onCrossGroupDuplicate}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── CategoryBucket ────────────────────────────────────────────────────────────

function CategoryBucket({
  category,
  itemIds,
  itemsById,
  menuId,
  collapsed,
  getSettings,
  color,
  onToggleCollapse,
  onUpdateSettings,
  onUpdateModifiers,
  onConfirmRecommendationDrop,
  enableAndOrSplit = false,
  onCrossGroupDuplicate,
  isDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onRemoveItem,
  onEditItem,
}: {
  category: string;
  itemIds: string[];
  itemsById: Map<string, MenuItemDisplay>;
  menuId: string;
  collapsed: boolean;
  getSettings: (menuId: string, itemId: string) => MenuItemJunctionSettings;
  color: MenuColor;
  onToggleCollapse: () => void;
  onUpdateSettings: (menuId: string, itemId: string, patch: MenuItemJunctionSettings) => Promise<void>;
  onUpdateModifiers: (parentId: string, payload: ModifierUpdatePayload) => Promise<void>;
  onConfirmRecommendationDrop?: (item: MenuItemDisplay, menuId: string | null) => Promise<boolean>;
  /** STR-342 — feature-flag gated split Sides UI. See MenuBuilderProps. */
  enableAndOrSplit?: boolean;
  /** STR-342 — cross-group duplicate toast callback. See MenuBuilderProps. */
  onCrossGroupDuplicate?: (existingGroup: 'included' | 'choice') => void;
  isDragOver: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent, itemId: string, menuId: string, cat: string) => void;
  onDragEnd: () => void;
  onRemoveItem: (itemId: string, menuId: string) => void;
  onEditItem: (itemId: string) => void;
}) {
  const bucketItems = itemIds.map((id) => itemsById.get(id)).filter(Boolean) as MenuItemDisplay[];

  // STR-251 round 3 — rollup attention indicator. Empty buckets are themselves
  // "needs attention". Non-empty buckets show the count of items whose
  // displayed price is missing.
  const attentionCount = bucketItems.reduce(
    (n, it) => n + (itemHasAttention(it, getSettings(menuId, it.id)) ? 1 : 0),
    0,
  );
  const bucketEmpty = bucketItems.length === 0;
  const bucketHasAttention = bucketEmpty || attentionCount > 0;

  return (
    <div
      className="mb-1"
      data-testid={`category-bucket-${category}`}
      data-attention={bucketHasAttention ? 'true' : undefined}
    >
      {/* Bucket header */}
      <button
        type="button"
        onClick={onToggleCollapse}
        data-testid={`collapse-bucket-${category}`}
        className="w-full flex items-center gap-2 py-1.5 px-3 cursor-pointer text-left transition-colors duration-150"
        style={{
          background: isDragOver ? `${color.tab}cc` : 'var(--bg)',
          border: bucketHasAttention ? '2px solid var(--red)' : 'none',
          borderLeft: bucketHasAttention ? '4px solid var(--red)' : `3px solid ${color.bucket}`,
        }}
      >
        <span className="text-[var(--text2)] shrink-0">
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </span>
        <span className="text-xs font-bold text-[var(--text)] flex-1">
          {category}
        </span>
        {bucketEmpty ? (
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
      </button>

      {/* Bucket items + drop zone */}
      {!collapsed && (
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          data-testid={`bucket-drop-${category}`}
          className="min-h-10 transition-all duration-150"
          style={{
            background: isDragOver ? color.tab : 'transparent',
            border: isDragOver ? `2px dashed ${color.tabBorder}` : '2px dashed transparent',
            borderRadius: isDragOver ? 'var(--r-xs)' : 0,
            margin: isDragOver ? '2px 4px' : 0,
          }}
        >
          {bucketItems.length === 0 ? (
            <div
              data-testid={`category-empty-${category}`}
              className="px-3 py-2.5 text-xs text-[var(--text2)] italic"
            >
              {isDragOver ? 'Drop to assign here' : 'No items in this category yet'}
            </div>
          ) : (
            bucketItems.map((item) => (
              <MenuItemRow
                key={item.id}
                item={item}
                menuId={menuId}
                cat={category}
                settings={getSettings(menuId, item.id)}
                itemsById={itemsById}
                onUpdateSettings={onUpdateSettings}
                onUpdateModifiers={onUpdateModifiers}
                onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                enableAndOrSplit={enableAndOrSplit}
                onCrossGroupDuplicate={onCrossGroupDuplicate}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onRemove={() => {
                  const s = getSettings(menuId, item.id);
                  const cats = s.canonical_categories ?? [];
                  if (cats.length > 1) {
                    // Item spans multiple categories on this menu — remove only
                    // this category rather than the whole menu placement.
                    void onUpdateSettings(menuId, item.id, {
                      canonical_categories: cats.filter((c) => c !== category),
                    });
                  } else {
                    // Last (or only) category — remove from menu entirely.
                    onRemoveItem(item.id, menuId);
                  }
                }}
                onEdit={() => onEditItem(item.id)}
              />
            ))
          )}
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
  onCreateMenu,
  onEditMenu,
  onRemoveItemFromMenu,
  onEditItem,
  onUpdateModifiers,
  onConfirmRecommendationDrop,
  enableAndOrSplit = false,
  onCrossGroupDuplicate,
  scrollToItemId,
  onScrollComplete,
  onRefresh,
  refreshing = false,
  onCollapseAll,
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
  const [addingMenu, setAddingMenu] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [creating, setCreating] = useState(false);
  const newMenuInputRef = useRef<HTMLInputElement>(null);
  const activeMenu = menus.find((m) => m.id === activeMenuId) ?? menus[0] ?? null;
  const activeMenuIndex = activeMenu ? menus.findIndex((m) => m.id === activeMenu.id) : 0;
  const activeColor = colorMap(activeMenuIndex);

  // Buckets to render: canonical categories only
  const activeAssignments = activeMenu ? (assignments[activeMenu.id] ?? {}) : {};
  const ALL_BUCKETS = [...CANONICAL_CATEGORIES] as const;
  // Always show all canonical categories, even empty ones
  const visibleBuckets = ALL_BUCKETS;

  const totalItems = activeMenu
    ? Object.values(activeAssignments).reduce((s, ids) => s + ids.length, 0)
    : 0;

  const allCollapsed = activeMenu
    ? visibleBuckets.every((cat) => collapsed[`${activeMenu.id}:${cat}`])
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
      {/* Tab bar */}
      <div
        className="flex items-end px-3 border-b border-[var(--border)] overflow-x-auto shrink-0"
        data-testid="menu-tab-bar"
      >
        {menus.map((menu) => {
          const isActive = menu.id === activeMenu?.id;
          return (
            <div key={menu.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onTabChange(menu.id)}
                data-testid={`menu-tab-${menu.id}`}
                className={`flex items-center gap-1.5 px-3.5 py-3 text-sm border-none cursor-pointer whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? 'font-semibold text-[var(--brand-s)] bg-[rgba(255,107,43,0.05)] border-b-2 border-b-[var(--brand-s)]'
                    : 'font-medium text-[var(--text2)] bg-transparent border-b-2 border-b-transparent'
                }`}
              >
                {menu.name}
                {isActive && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onEditMenu(menu.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onEditMenu(menu.id); } }}
                    data-testid={`edit-menu-tab-${menu.id}`}
                    aria-label={`Edit ${menu.name}`}
                    className="inline-flex items-center p-0.5 rounded-[var(--r-xs)] text-[var(--brand-s)] cursor-pointer opacity-70 hover:opacity-100"
                  >
                    <Pencil size={11} />
                  </span>
                )}
              </button>
            </div>
          );
        })}

        {/* Inline new-menu form / + button */}
        {addingMenu ? (
          <div className="flex items-center gap-1 px-2 py-1.5 shrink-0">
            <input
              ref={newMenuInputRef}
              type="text"
              value={newMenuName}
              onChange={(e) => setNewMenuName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  if (!newMenuName.trim()) return;
                  setCreating(true);
                  await onCreateMenu(newMenuName.trim());
                  setNewMenuName('');
                  setAddingMenu(false);
                  setCreating(false);
                }
                if (e.key === 'Escape') { setAddingMenu(false); setNewMenuName(''); }
              }}
              placeholder="Menu name…"
              autoFocus
              data-testid="new-menu-name-input"
              className="text-xs border border-[var(--blue)] rounded-[var(--r-xs)] py-0.5 px-2 outline-none w-[130px]"
            />
            <button
              type="button"
              disabled={creating || !newMenuName.trim()}
              onClick={async () => {
                if (!newMenuName.trim()) return;
                setCreating(true);
                await onCreateMenu(newMenuName.trim());
                setNewMenuName('');
                setAddingMenu(false);
                setCreating(false);
              }}
              data-testid="confirm-new-menu-btn"
              className="bg-transparent border-none cursor-pointer text-[var(--blue)] flex items-center p-0.5"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => { setAddingMenu(false); setNewMenuName(''); }}
              data-testid="cancel-new-menu-btn"
              className="bg-transparent border-none cursor-pointer text-[var(--text2)] flex items-center p-0.5"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setAddingMenu(true); setTimeout(() => newMenuInputRef.current?.focus(), 0); }}
            data-testid="add-menu-btn"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[var(--blue)] bg-transparent border-none cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus size={13} />
            New menu
          </button>
        )}
      </div>

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
              className="text-xs text-[var(--text2)] bg-transparent border-none cursor-pointer opacity-60 hover:opacity-100 transition-opacity whitespace-nowrap"
            >
              {allCollapsed ? 'Expand All' : 'Collapse All'}
            </button>
          )}
          {!activeMenu.active && (
            <span className="badge badge-green text-xs !bg-[var(--red-bg)] !text-[var(--red)]">
              Inactive
            </span>
          )}
        </div>
      )}

      {/* Category buckets */}
      <div className="flex-1 overflow-y-auto py-2">
        {(visibleBuckets as readonly string[]).map((cat) => {
            const collapseKey = `${activeMenu?.id}:${cat}`;
            const isDragOverBucket =
              dragOver !== null &&
              dragOver !== 'pool' &&
              dragOver.menuId === activeMenu?.id &&
              dragOver.cat === cat;

            return (
              <CategoryBucket
                key={cat}
                category={cat}
                itemIds={activeAssignments[cat] ?? []}
                itemsById={itemsById}
                menuId={activeMenu!.id}
                collapsed={collapsed[collapseKey] ?? false}
                getSettings={getSettings}
                color={activeColor}
                onToggleCollapse={() => handleToggleCollapseTracked(collapseKey)}
                onUpdateSettings={onUpdateSettings}
                onUpdateModifiers={onUpdateModifiers}
                onConfirmRecommendationDrop={onConfirmRecommendationDrop}
                enableAndOrSplit={enableAndOrSplit}
                onCrossGroupDuplicate={onCrossGroupDuplicate}
                isDragOver={isDragOverBucket}
                onDragEnter={(e) => onDragEnterBucket(e, activeMenu!.id, cat)}
                onDragLeave={() => onDragLeaveBucket(activeMenu!.id, cat)}
                onDrop={(e) => onDropBucket(e, activeMenu!.id, cat)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onRemoveItem={handleRemoveItemFromMenuTracked}
                onEditItem={onEditItem}
              />
            );
          })}
      </div>
    </div>
  );
}

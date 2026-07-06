'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Pencil, Search, Check, X, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary } from '../../../types/restaurant';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { type MenuColor, MENU_SECTIONS, sectionForCanonical } from '../lib/menuUtils';
import type { BulkMode, DragState } from '../MenuManagerClient';
import { useTrackAction } from '../track-action-context';
import { SWEETNESS_VISIBLE } from '../../../constants/feature-flags';

// ── Canonical-section grouping ────────────────────────────────────────────────
// The pool groups items by the 4 owner-facing CANONICAL SECTIONS the menu
// builder's left column uses — Drinks / Starters / Mains / Desserts
// (MENU_SECTIONS in menuUtils.ts) — NOT the raw 8-value canonical taxonomy
// (Beverages/Appetizers/Soups/Salads/Sides/Breads/Entrees/Desserts) and NOT
// the scraped sub-category label. Each item is placed by its PRIMARY canonical
// (singular `canonical_category`, else first non-empty `canonical_categories`
// entry) → one card per item. The section's owner label is the display key;
// the Mains section absorbs Soups/Salads/Sides/Breads. Items whose canonical
// maps to no section (or have none) fall into a catch-all bucket rendered last.
const UNCATEGORIZED_POOL_KEY = 'Uncategorized';
/** Owner-facing section LABEL (Drinks/Starters/Mains/Desserts) for an item's
 *  primary canonical, or 'Uncategorized' when it maps to no section. */
function poolSectionLabelOf(item: MenuItemDisplay): string {
  const primary =
    item.canonical_category?.trim() ||
    item.canonical_categories?.find((c) => c && c.trim())?.trim() ||
    '';
  if (!primary) return UNCATEGORIZED_POOL_KEY;
  return sectionForCanonical(primary)?.label ?? UNCATEGORIZED_POOL_KEY;
}
// Section labels in owner order — used to sort the pool's group headers.
const POOL_SECTION_ORDER: string[] = MENU_SECTIONS.map((s) => s.label);

/** RAW sub-category label (the menu's own scraped `category`, e.g. "Beverages",
 *  "Bottle Beers") — the same grouping the Food Items page rail uses. Opt-in via
 *  `groupByRawCategory`; falls back to 'Uncategorized'. */
function poolRawCategoryOf(item: MenuItemDisplay): string {
  return (item.category || UNCATEGORIZED_POOL_KEY).trim() || UNCATEGORIZED_POOL_KEY;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ItemPoolProps {
  items: MenuItemDisplay[];
  menus: MenuSummary[];
  filtered: MenuItemDisplay[];
  selected: Set<string>;
  search: string;
  dragOver: 'pool' | null;
  dragging: DragState | null;
  editItemId: string | null;
  onSearchChange: (v: string) => void;
  onSelectClick: (
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    itemId: string,
    listKey: string,
    orderedIds: string[],
  ) => void;
  onSelectAll: () => void;
  onClearSelect: () => void;
  onSelectCategoryItems: (ids: string[], selectAll: boolean) => void;
  onEditItem: (id: string) => void;
  /** STR-858 — mobile tap-to-place. Forwarded to each pool card so a phone can
   *  add an item to the active menu without native drag. */
  onPlaceItem?: (item: MenuItemDisplay) => void;
  visibilityFilter: 'All' | 'Visible' | 'Hidden';
  onVisibilityFilterChange: (v: 'All' | 'Visible' | 'Hidden') => void;
  itemTypeFilter: 'dishes' | 'addons' | 'included';
  onItemTypeFilterChange: (v: 'dishes' | 'addons' | 'included') => void;
  onOpenBulk: (mode: BulkMode) => void;
  onOpenBulkModifiers: () => void;
  onDragStart: (e: React.DragEvent, itemId: string) => void;
  /** Drag a whole pool category to add all its items at once (PDD 2026-06-12 #4). */
  onCategoryDragStart?: (e: React.DragEvent, itemIds: string[]) => void;
  onDragEnd: () => void;
  onDragEnterPool: (e: React.DragEvent) => void;
  onDragLeavePool: () => void;
  onDropPool: (e: React.DragEvent) => void;
  colorMap: (index: number) => MenuColor;
  /**
   * When true, clicking the row body (not just the pencil icon) calls
   * `onEdit(id)`. Used by the Food Items page to make the whole row act
   * as the "open editor" affordance, since the right panel IS the editor
   * and there's no separate drag-into-menu interaction.
   * Default: false (Menu page behavior — row click bulk-selects, pencil
   * opens the edit modal).
   */
  activateOnRowClick?: boolean;
  /**
   * When false, hides the Menu-page-specific bulk action buttons in the
   * select-all bar ("Bulk Actions →", "Bulk actions →", "Assign addons →").
   * Used by the Food Items page which has its own bulk-actions bar with
   * different actions (Activate / Deactivate / Delete / Boost / Add to menu).
   * Default: true (Menu page behavior).
   */
  showBulkActions?: boolean;
  /**
   * When false, hides the Visible / Hidden toggle in the filter row. The
   * filter state still exists in the parent — it just stays at 'All'.
   * Default: true.
   */
  showVisibilityFilter?: boolean;
  /**
   * When true, render a Dish / Add-ons toggle next to the visibility
   * filter — re-enables the item-type filter that was retired from the
   * default pool (see filter-row comment below). Used by qrate-admin-webapp
   * so admins can navigate to addons from the same food library that
   * shows dishes. Owner-webapp + waiter-webapp leave this off; their
   * addon management lives elsewhere. Default: false.
   */
  showItemTypeFilter?: boolean;
  /**
   * When true, the pool groups items by their RAW sub-category label
   * (item.category — the menu's own scraped labels, e.g. "Beverages" /
   * "Bottle Beers"), matching the Food Items page rail, instead of the 4
   * canonical course sections (Drinks / Starters / Mains / Desserts). Owner
   * menu page opts in; other consumers keep the course grouping. Default: false.
   */
  groupByRawCategory?: boolean;
}

// ── ItemPoolCard ─────────────────────────────────────────────────────────────

function ItemPoolCard({
  item,
  isSelected,
  isEditing,
  itemMenus,
  colorMap,
  onSelectClick,
  onEdit,
  onPlaceItem,
  onDragStart,
  onDragEnd,
  activateOnRowClick = false,
}: {
  item: MenuItemDisplay;
  isSelected: boolean;
  isEditing: boolean;
  itemMenus: Array<{ menu: MenuSummary; index: number }>;
  colorMap: (index: number) => MenuColor;
  onSelectClick: (e: React.MouseEvent) => void;
  onEdit: (id: string) => void;
  /** STR-858 — mobile tap-to-place. Native drag can't place on touch; when
   *  wired, the card shows a "＋ Add to menu" button. */
  onPlaceItem?: (item: MenuItemDisplay) => void;
  onDragStart: (e: React.DragEvent, itemId: string) => void;
  onDragEnd: () => void;
  activateOnRowClick?: boolean;
}) {
  const isMobile = useIsMobile();
  const bg = isEditing
    ? 'var(--blue-bg)'
    : isSelected
      ? '#e8f0fe'
      : 'var(--white)';

  const border = isEditing || isSelected ? '1px solid var(--blue)' : '1px solid var(--border)';

  // Chrome/Blink: -webkit-user-drag on children controls whether they
  // intercept the parent's drag. 'none' on children forces the parent to
  // be the drag source regardless of where the user clicks.
  const noDrag: React.CSSProperties = { WebkitUserDrag: 'none' } as React.CSSProperties;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item.id)}
      onDragEnd={onDragEnd}
      onClick={activateOnRowClick ? () => onEdit(item.id) : undefined}
      data-testid={`item-card-${item.id}`}
      style={{
        background: bg,
        border,
        borderRadius: 'var(--r-xs)',
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: activateOnRowClick ? 'pointer' : 'grab',
        userSelect: 'none',
        transition: 'background 0.1s',
      }}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSelectClick(e); }}
        data-testid={`select-item-${item.id}`}
        aria-label={isSelected ? 'Deselect item' : 'Select item'}
        aria-pressed={isSelected}
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          border: isSelected ? '2px solid var(--blue)' : '2px solid #ccc',
          background: isSelected ? 'var(--blue)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          ...noDrag,
        }}
      >
        {isSelected && <Check size={11} color="white" strokeWidth={3} />}
      </button>

      {/* Thumbnail — dishes only */}
      {item.item_type !== 'addon' && (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--r-xs)',
            background: '#f0f0f0',
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            ...noDrag,
          }}
        >
          {item.thumbnail_url ? (
            <img draggable={false} src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            '🍽'
          )}
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0, ...noDrag }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: '1 1 0',
            }}
            title={item.name}
          >
            {item.name}
          </span>
          {item.item_type === 'addon' && item.price != null && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>
              ${Number(item.price).toFixed(2)}
            </span>
          )}

          {!item.active && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: '#b91c1c',
                background: '#fee2e2',
                borderRadius: 4,
                padding: '1px 5px',
              }}
            >
              86'd
            </span>
          )}
        </div>

        {/* Menu chips — dishes only */}
        {item.item_type !== 'addon' && itemMenus.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
            {itemMenus.map(({ menu, index }) => {
              const color = colorMap(index);
              return (
                <span
                  key={menu.id}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    background: color.chip,
                    color: color.chipText,
                    borderRadius: 4,
                    padding: '1px 5px',
                    whiteSpace: 'nowrap',
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={menu.name}
                >
                  {menu.name}
                </span>
              );
            })}
          </div>
        )}

        {/* Sweetness chip — Desserts only. Gated behind SWEETNESS_VISIBLE per STR-480. */}
        {item.canonical_categories?.includes('Desserts') && SWEETNESS_VISIBLE && item.food_tags?.sweetness_label && (
          <div style={{ marginTop: 4 }}>
            <span
              style={{
                fontSize: 10,
                color: '#be185d',
                background: 'rgba(249,168,212,0.18)',
                border: '1px solid #f9a8d4',
                borderRadius: 4,
                padding: '1px 5px',
              }}
            >
              ✦ {item.food_tags.sweetness_label}
            </span>
          </div>
        )}
      </div>

      {/* STR-858 — mobile tap-to-place. Native drag is dead on touch, so a
          phone gets an explicit "＋ Add to menu" button that opens the course
          picker. 44px target; stops propagation so it doesn't select the row. */}
      {onPlaceItem && isMobile && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPlaceItem(item); }}
          data-testid={`pool-place-item-${item.id}`}
          aria-label={`Add ${item.name} to a menu`}
          title="Add to menu"
          style={{
            background: 'var(--brand-gradient)', color: '#fff', border: 'none',
            cursor: 'pointer', minWidth: 44, minHeight: 44, borderRadius: 8,
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            ...noDrag,
          }}
        >
          <Plus size={18} />
        </button>
      )}

      {/* Edit button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(item.id); }}
        data-testid={`edit-item-${item.id}`}
        aria-label={`Edit ${item.name}`}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text2)',
          padding: 4,
          borderRadius: 4,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...noDrag,
        }}
      >
        <Pencil size={13} />
      </button>
    </div>
  );
}

// ── CategorySection ───────────────────────────────────────────────────────────

function CategorySection({
  category,
  categoryItems,
  itemCount,
  selected,
  editItemId,
  itemMenuMap,
  colorMap,
  collapsed,
  onToggleCollapse,
  onSelectCategory,
  onSelectClick,
  onEdit,
  onPlaceItem,
  onDragStart,
  onCategoryDragStart,
  onDragEnd,
  activateOnRowClick = false,
}: {
  category: string;
  categoryItems: MenuItemDisplay[];
  /** Total non-addon items in this category across the whole catalogue
   *  (dishes + included). Used by the count badge — driven from `items`,
   *  not the post-filter list, so the number doesn't dance as the owner
   *  searches. */
  itemCount: number;
  selected: Set<string>;
  editItemId: string | null;
  itemMenuMap: Map<string, Array<{ menu: MenuSummary; index: number }>>;
  colorMap: (index: number) => MenuColor;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectCategory: (ids: string[], selectAll: boolean) => void;
  onSelectClick: (e: React.MouseEvent, itemId: string) => void;
  onEdit: (id: string) => void;
  onPlaceItem?: (item: MenuItemDisplay) => void;
  onDragStart: (e: React.DragEvent, itemId: string) => void;
  /** Drag the whole category header to add ALL its items at once (PDD
   *  2026-06-12 #4). When omitted, the header isn't draggable. */
  onCategoryDragStart?: (e: React.DragEvent, itemIds: string[]) => void;
  onDragEnd: () => void;
  activateOnRowClick?: boolean;
}) {
  const categoryIds = categoryItems.map((i) => i.id);
  const allSelected = categoryIds.length > 0 && categoryIds.every((id) => selected.has(id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Category header — the whole row toggles collapse (not just the
          chevron). Keyboard-accessible via role=button + Enter/Space. The
          select-all checkbox stops propagation so it keeps its own action. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(); }
        }}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${category}` : `Collapse ${category}`}
        data-testid={`pool-category-header-${category.toLowerCase().replace(/\s+/g, '-')}`}
        draggable={!!onCategoryDragStart && categoryIds.length > 0}
        onDragStart={
          onCategoryDragStart && categoryIds.length > 0
            ? (e) => onCategoryDragStart(e, categoryIds)
            : undefined
        }
        onDragEnd={onCategoryDragStart ? onDragEnd : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 4px 6px 0',
          borderBottom: '1px solid var(--border)',
          marginBottom: collapsed ? 0 : 6,
          // grab cursor signals the header is draggable (drag the whole
          // category onto a course to add all its items — PDD #4); falls back
          // to pointer when drag isn't wired, matching the collapse-toggle role.
          cursor: !!onCategoryDragStart && categoryIds.length > 0 ? 'grab' : 'pointer',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#f6f6f6'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Collapse indicator (visual only — the whole header toggles) */}
        <span
          aria-hidden="true"
          style={{
            color: 'var(--text2)',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {collapsed
            ? <ChevronRight size={14} />
            : <ChevronDown size={14} />
          }
        </span>

        {/* Category name */}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0 }}>
          {category}
        </span>

        {/* Count — single orange badge covering every non-addon item in
            the category. Included items used to render a separate cyan
            badge; collapsed into one count so owners stop wondering why a
            category shows two numbers. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {itemCount > 0 && (
            <span
              aria-label={`${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
              title={`${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--brand-s)',
                background: 'rgba(255,107,43,0.08)',
                borderRadius: 4,
                padding: '1px 5px',
                whiteSpace: 'nowrap',
              }}
            >
              {itemCount}
            </span>
          )}
        </div>

        {/* Select-all checkbox for category */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSelectCategory(categoryIds, !allSelected); }}
          aria-label={allSelected ? `Deselect all in ${category}` : `Select all in ${category}`}
          aria-pressed={allSelected}
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            border: allSelected ? '2px solid var(--blue)' : '2px solid #ccc',
            background: allSelected ? 'var(--blue)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          {allSelected && <Check size={9} color="white" strokeWidth={3} />}
        </button>
      </div>

      {/* Items */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {categoryItems.map((item) => (
            <ItemPoolCard
              key={item.id}
              item={item}
              isSelected={selected.has(item.id)}
              isEditing={editItemId === item.id}
              itemMenus={itemMenuMap.get(item.id) ?? []}
              colorMap={colorMap}
              onSelectClick={(e) => onSelectClick(e, item.id)}
              onEdit={onEdit}
              onPlaceItem={onPlaceItem}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              activateOnRowClick={activateOnRowClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ItemPool ─────────────────────────────────────────────────────────────────

export default function ItemPool({
  items,
  menus,
  filtered,
  selected,
  search,
  dragOver,
  dragging: _dragging,
  editItemId,
  onSearchChange,
  onSelectClick,
  onSelectAll,
  onClearSelect,
  onSelectCategoryItems,
  onEditItem,
  onPlaceItem,
  visibilityFilter,
  onVisibilityFilterChange,
  itemTypeFilter,
  onItemTypeFilterChange,
  onOpenBulk,
  onOpenBulkModifiers,
  onDragStart,
  onCategoryDragStart,
  onDragEnd,
  onDragEnterPool,
  onDragLeavePool,
  onDropPool,
  colorMap,
  activateOnRowClick = false,
  showBulkActions = true,
  showVisibilityFilter = true,
  showItemTypeFilter = false,
  groupByRawCategory = false,
}: ItemPoolProps) {
  const trackAction = useTrackAction();
  // Group key: raw sub-category (Food Items rail parity) when opted in, else
  // the 4 canonical course sections.
  const poolCategoryOf = groupByRawCategory ? poolRawCategoryOf : poolSectionLabelOf;

  // Per-category collapsed state (local — no need to persist)
  // Start all-collapsed; initialised once when categories first populate
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const initialCollapseApplied = useRef(false);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const handleOpenBulkTracked = (mode: BulkMode) => {
    trackAction('menu.itemPool.bulkActions', { metadata: { mode } });
    onOpenBulk(mode);
  };

  const handleOpenBulkModifiersTracked = () => {
    trackAction('menu.itemPool.bulkModifiers');
    onOpenBulkModifiers();
  };

  const handleEditItemTracked = (id: string) => {
    trackAction('menu.itemPool.openEdit', { metadata: { itemId: id } });
    onEditItem(id);
  };

  const allSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  const someSelected = selected.size > 0;

  // Map itemId → list of {menu, index} for chips
  const itemMenuMap = useMemo(() => {
    const map = new Map<string, Array<{ menu: MenuSummary; index: number }>>();
    for (const item of items) {
      const assocMenuIds = new Set((item.menu_associations ?? []).map((a) => a.menu_id));
      const matched: Array<{ menu: MenuSummary; index: number }> = [];
      menus.forEach((menu, idx) => {
        if (assocMenuIds.has(menu.id)) matched.push({ menu, index: idx });
      });
      map.set(item.id, matched);
    }
    return map;
  }, [items, menus]);

  // Per-category total — counts every non-addon item (dishes + any items
  // flipped to item_type='included' by the sides flow). Computed against
  // all items so the badge stays stable while the owner searches.
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      if (item.item_type === 'addon') continue;
      const cat = poolCategoryOf(item);
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [items, poolCategoryOf]);

  // CANONICAL-SECTION GROUPING: the pool groups items by the 4 owner-facing
  // sections (Drinks/Starters/Mains/Desserts via poolSectionLabelOf) instead of
  // the scraped sub-category label — matching the menu builder's left column.
  // The pool does not separate dishes from included; both render in the same
  // per-section bucket.
  const groupedItems = useMemo(() => {
    if (itemTypeFilter === 'addons') return null;
    const groups: Record<string, MenuItemDisplay[]> = {};
    for (const item of filtered) {
      const cat = poolCategoryOf(item);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [filtered, itemTypeFilter, poolCategoryOf]);

  // Section render order: owner section order (Drinks → Starters → Mains →
  // Desserts) first, then the "Uncategorized" catch-all always last.
  const orderedCategories = useMemo(() => {
    if (!groupedItems) return [];
    // Raw-category mode: alphabetical with 'Uncategorized' last (Food Items
    // rail parity). Course mode: fixed section order (Drinks → … → Desserts),
    // 'Uncategorized' last.
    const rank = (c: string): number => {
      if (c === UNCATEGORIZED_POOL_KEY) return 1000;
      if (groupByRawCategory) return 500;
      const idx = POOL_SECTION_ORDER.indexOf(c);
      return idx >= 0 ? idx : 500;
    };
    return Object.keys(groupedItems)
      .filter((c) => (groupedItems[c]?.length ?? 0) > 0)
      .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra !== rb ? ra - rb : a.localeCompare(b);
      });
  }, [groupedItems, groupByRawCategory]);

  // Auto-collapse all categories on first data load
  useEffect(() => {
    if (!initialCollapseApplied.current && orderedCategories.length > 0) {
      initialCollapseApplied.current = true;
      setCollapsedCategories(new Set(orderedCategories));
    }
  }, [orderedCategories]);

  // True only when every visible category is in the collapsed set — survives async category additions.
  const allCollapsed = orderedCategories.length > 0 && orderedCategories.every((c) => collapsedCategories.has(c));

  const handleCollapseAllCategories = (collapse: boolean) => {
    setCollapsedCategories(collapse ? new Set(orderedCategories) : new Set());
  };

  return (
    <div
      data-testid="item-pool"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--white)',
        borderRadius: 'var(--r)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* Header — count only. New items are created exclusively from the
          /owner/food-items library; the menu page is for arranging the
          existing pool into menus, not authoring new dishes. */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span data-testid="item-pool-count" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          Food Items ({items.length})
        </span>
      </div>

      {/* Search + filter */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#f6f6f6',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xs)',
            padding: '6px 10px',
          }}
        >
          <Search size={13} color="var(--text2)" />
          <input
            type="text"
            placeholder="Search items…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            data-testid="item-pool-search"
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: 12,
              color: 'var(--text)',
              flex: 1,
              minWidth: 0,
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text2)',
                display: 'flex',
                alignItems: 'center',
                padding: 2,
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Filter row — visibility toggle + optional item-type toggle.
            The item-type filter (Dishes / Add-ons) was retired from the
            default pool because addons/included are managed via the
            owner-webapp Food Items page. qrate-admin-webapp re-enables
            it via showItemTypeFilter=true so admin staff can navigate
            to addons from the same food library. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', rowGap: 6, columnGap: 6 }}>
          {/* Dish / Add-ons toggle — admin-only, opt-in via showItemTypeFilter */}
          {showItemTypeFilter && (
            <div
              data-testid="item-type-filter"
              style={{
                display: 'inline-flex',
                borderRadius: 20,
                border: '1px solid var(--border)',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {([
                { key: 'dishes', label: 'Dishes' },
                { key: 'addons', label: 'Add-ons' },
              ] as const).map((tab, idx) => (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`item-type-filter-${tab.key}`}
                  aria-pressed={itemTypeFilter === tab.key}
                  aria-label={`Show only ${tab.label.toLowerCase()}`}
                  onClick={() => onItemTypeFilterChange(tab.key)}
                  style={{
                    padding: '4px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    borderRight: idx === 0 ? '1px solid var(--border)' : 'none',
                    background: itemTypeFilter === tab.key ? '#fff7ed' : 'transparent',
                    color: itemTypeFilter === tab.key ? '#c2410c' : 'var(--text2)',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          {/* Visible / Hidden toggle */}
          {showVisibilityFilter && (
            <div
              style={{
                display: 'inline-flex',
                borderRadius: 20,
                border: '1px solid var(--border)',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {(['Visible', 'Hidden'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  data-testid={`visibility-filter-${tab.toLowerCase()}`}
                  aria-pressed={visibilityFilter === tab}
                  aria-label={`Show only ${tab.toLowerCase()} items (click to show all)`}
                  onClick={() => onVisibilityFilterChange(visibilityFilter === tab ? 'All' : tab)}
                  style={{
                    padding: '4px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    borderRight: tab === 'Visible' ? '1px solid var(--border)' : 'none',
                    background: visibilityFilter === tab ? 'var(--brand-s)' : 'var(--white)',
                    color: visibilityFilter === tab ? 'white' : 'var(--text2)',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Select-all row */}
      <div
        style={{
          padding: '4px 12px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          type="button"
          onClick={allSelected ? onClearSelect : onSelectAll}
          data-testid="select-all-checkbox"
          aria-label={allSelected ? 'Deselect all' : 'Select all'}
          aria-pressed={allSelected}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--text2)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              border: allSelected ? '2px solid var(--blue)' : '2px solid #ccc',
              background: allSelected ? 'var(--blue)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {allSelected && <Check size={9} color="white" strokeWidth={3} />}
          </span>
          {someSelected ? `${selected.size} selected` : 'Select all'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {showBulkActions && someSelected && itemTypeFilter === 'addons' && (
            <button
              type="button"
              onClick={handleOpenBulkModifiersTracked}
              data-testid="bulk-assign-modifiers-btn"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--blue)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Bulk Actions →
            </button>
          )}
          {/* Enrich for addons now lives as a tab inside BulkModifierPanel
              (opened via the "Bulk Actions →" button above) — no separate
              shortcut needed. The previous standalone Enrich → button was
              removed 2026-05-19 per Avi to consolidate addon bulk actions
              into a single drawer. */}
          {showBulkActions && someSelected && itemTypeFilter === 'dishes' && (
            <button
              type="button"
              onClick={() => handleOpenBulkTracked('assign')}
              data-testid="bulk-actions-btn"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--blue)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Bulk actions →
            </button>
          )}
          {/* "Assign addons →" reverse-direction button (STR-415, 2026-04-29)
              removed 2026-05-22 per Avi — the dish-side surface is the
              EditModal Groupings tab now; this entry was redundant. The
              addon-filter version of the bulk-modifier flow ("Bulk Actions →"
              at line ~800) is untouched. */}
          {orderedCategories.length > 0 && (
            <button
              type="button"
              onClick={() => handleCollapseAllCategories(!allCollapsed)}
              data-testid="food-items-collapse-expand-all-btn"
              aria-pressed={allCollapsed}
              style={{
                fontSize: 12,
                color: 'var(--text2)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                whiteSpace: 'nowrap',
                opacity: 0.6,
                transition: 'opacity 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
            >
              {allCollapsed ? 'Expand All' : 'Collapse All'}
            </button>
          )}
        </div>
      </div>

      {/* Item list (also acts as drop-to-remove target) */}
      <div
        onDragEnter={onDragEnterPool}
        onDragLeave={onDragLeavePool}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropPool}
        data-testid="item-pool-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '0 12px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 80,
              fontSize: 12,
              color: 'var(--text2)',
            }}
          >
            {search ? 'No items match' : 'No items yet'}
          </div>
        ) : itemTypeFilter === 'addons' ? (
          /* Flat list for addons — no category grouping */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
            {filtered.map((item) => (
              <ItemPoolCard
                key={item.id}
                item={item}
                isSelected={selected.has(item.id)}
                isEditing={editItemId === item.id}
                itemMenus={itemMenuMap.get(item.id) ?? []}
                colorMap={colorMap}
                onSelectClick={(e) =>
                  onSelectClick(e, item.id, 'pool', filtered.map((i) => i.id))
                }
                onEdit={handleEditItemTracked}
                onPlaceItem={onPlaceItem}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        ) : (
          /* Grouped by category for dishes / included */
          <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 4 }}>
            {orderedCategories.map((cat) => {
              const catItems = groupedItems![cat] ?? [];
              const itemCount = categoryCounts[cat] ?? 0;
              return (
                <CategorySection
                  key={cat}
                  category={cat}
                  categoryItems={catItems}
                  itemCount={itemCount}
                  selected={selected}
                  editItemId={editItemId}
                  itemMenuMap={itemMenuMap}
                  colorMap={colorMap}
                  collapsed={collapsedCategories.has(cat)}
                  onToggleCollapse={() => toggleCategory(cat)}
                  onSelectCategory={onSelectCategoryItems}
                  onSelectClick={(e, itemId) =>
                    onSelectClick(e, itemId, `pool:${cat}`, catItems.map((i) => i.id))
                  }
                  onEdit={handleEditItemTracked}
                  onPlaceItem={onPlaceItem}
                  onDragStart={onDragStart}
                  onCategoryDragStart={onCategoryDragStart}
                  onDragEnd={onDragEnd}
                  activateOnRowClick={activateOnRowClick}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

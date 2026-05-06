'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Pencil, Plus, Search, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary } from '../../../types/restaurant';
import { type MenuColor, toCanonical, CANONICAL_CATEGORIES } from '../lib/menuUtils';
import type { BulkMode, DragState } from '../MenuManagerClient';
import { useTrackAction } from '../track-action-context';

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
  visibilityFilter: 'All' | 'Visible' | 'Hidden';
  onVisibilityFilterChange: (v: 'All' | 'Visible' | 'Hidden') => void;
  itemTypeFilter: 'dishes' | 'addons' | 'included';
  onItemTypeFilterChange: (v: 'dishes' | 'addons' | 'included') => void;
  onOpenBulk: (mode: BulkMode) => void;
  onOpenBulkModifiers: () => void;
  onDragStart: (e: React.DragEvent, itemId: string) => void;
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
  onDragStart: (e: React.DragEvent, itemId: string) => void;
  onDragEnd: () => void;
  activateOnRowClick?: boolean;
}) {
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

        {/* Sweetness chip — Desserts only */}
        {item.canonical_categories?.includes('Desserts') && item.food_tags?.sweetness_label && (
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
  dishCount,
  includedCount,
  selected,
  editItemId,
  itemMenuMap,
  colorMap,
  collapsed,
  onToggleCollapse,
  onSelectCategory,
  onSelectClick,
  onEdit,
  onDragStart,
  onDragEnd,
  activateOnRowClick = false,
}: {
  category: string;
  categoryItems: MenuItemDisplay[];
  dishCount: number;
  includedCount: number;
  selected: Set<string>;
  editItemId: string | null;
  itemMenuMap: Map<string, Array<{ menu: MenuSummary; index: number }>>;
  colorMap: (index: number) => MenuColor;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectCategory: (ids: string[], selectAll: boolean) => void;
  onSelectClick: (e: React.MouseEvent, itemId: string) => void;
  onEdit: (id: string) => void;
  onDragStart: (e: React.DragEvent, itemId: string) => void;
  onDragEnd: () => void;
  activateOnRowClick?: boolean;
}) {
  const categoryIds = categoryItems.map((i) => i.id);
  const allSelected = categoryIds.length > 0 && categoryIds.every((id) => selected.has(id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Category header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 4px 6px 0',
          borderBottom: '1px solid var(--border)',
          marginBottom: collapsed ? 0 : 6,
        }}
      >
        {/* Collapse toggle */}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? `Expand ${category}` : `Collapse ${category}`}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
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
        </button>

        {/* Category name */}
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 0 }}>
          {category}
        </span>

        {/* Counts */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {dishCount > 0 && (
            <span
              aria-label={`${dishCount} ${dishCount === 1 ? 'dish' : 'dishes'}`}
              title={`${dishCount} ${dishCount === 1 ? 'dish' : 'dishes'}`}
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
              {dishCount}
            </span>
          )}
          {includedCount > 0 && (
            <span
              aria-label={`${includedCount} ${includedCount === 1 ? 'included item' : 'included items'}`}
              title={`${includedCount} ${includedCount === 1 ? 'included item' : 'included items'}`}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#0369a1',
                background: '#e0f2fe',
                borderRadius: 4,
                padding: '1px 5px',
                whiteSpace: 'nowrap',
              }}
            >
              {includedCount}
            </span>
          )}
        </div>

        {/* Select-all checkbox for category */}
        <button
          type="button"
          onClick={() => onSelectCategory(categoryIds, !allSelected)}
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
  visibilityFilter,
  onVisibilityFilterChange,
  itemTypeFilter,
  onItemTypeFilterChange,
  onOpenBulk,
  onOpenBulkModifiers,
  onDragStart,
  onDragEnd,
  onDragEnterPool,
  onDragLeavePool,
  onDropPool,
  colorMap,
  activateOnRowClick = false,
  showBulkActions = true,
  showVisibilityFilter = true,
}: ItemPoolProps) {
  const trackAction = useTrackAction();

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

  // Per-category dish/included counts from ALL items (not just filtered)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, { dishes: number; included: number }> = {};
    for (const item of items) {
      if (item.item_type === 'addon') continue;
      const cat = item.canonical_category ?? toCanonical(item.category) ?? 'Other';
      if (!counts[cat]) counts[cat] = { dishes: 0, included: 0 };
      if (item.item_type === 'included') {
        counts[cat].included++;
      } else {
        counts[cat].dishes++;
      }
    }
    return counts;
  }, [items]);

  // Group filtered items by canonical category (only for dishes/included tabs)
  const groupedItems = useMemo(() => {
    if (itemTypeFilter === 'addons') return null;
    const groups: Record<string, MenuItemDisplay[]> = {};
    for (const item of filtered) {
      const cat = item.canonical_category ?? toCanonical(item.category) ?? 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [filtered, itemTypeFilter]);

  // Category render order: canonical order first, then any uncategorised
  const orderedCategories = useMemo(() => {
    if (!groupedItems) return [];
    const canonical = (CANONICAL_CATEGORIES as readonly string[]).filter((c) => (groupedItems[c]?.length ?? 0) > 0);
    const others = Object.keys(groupedItems).filter(
      (c) => !(CANONICAL_CATEGORIES as readonly string[]).includes(c) && (groupedItems[c]?.length ?? 0) > 0,
    );
    return [...canonical, ...others];
  }, [groupedItems]);

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

        {/* Combined filter row — item type + visibility. Wraps on narrow viewports to prevent clipping. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6, columnGap: 6 }}>
          {/* Dishes / Included / Add-ons toggle */}
          <div
            style={{
              display: 'inline-flex',
              borderRadius: 20,
              border: '1px solid var(--border)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {(['dishes', 'included', 'addons'] as const).map((tab, idx, arr) => (
              <button
                key={tab}
                type="button"
                data-testid={`item-type-filter-${tab}`}
                onClick={() => onItemTypeFilterChange(tab)}
                style={{
                  padding: '4px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  borderRight: idx < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  background: itemTypeFilter === tab
                    ? 'var(--brand-s)'
                    : 'var(--white)',
                  color: itemTypeFilter === tab ? 'white' : 'var(--text2)',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {tab === 'dishes' ? 'Dishes' : tab === 'included' ? 'Included' : 'Add-ons'}
              </button>
            ))}
          </div>
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
          {/* STR-415: reverse-direction entry — pre-selected entrees → BulkModifierPanel.
              Visually differentiated from sibling "Bulk actions →" via Plus icon
              prefix to avoid twin-button muscle-memory misclicks (Phase 6 UX-Reviewer
              feedback 2026-04-29). */}
          {showBulkActions && someSelected && itemTypeFilter === 'dishes' && (
            <button
              type="button"
              onClick={handleOpenBulkModifiersTracked}
              data-testid="bulk-modifier-reverse-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--blue)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <Plus size={12} strokeWidth={2.5} />
              Assign addons →
            </button>
          )}
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
              const counts = categoryCounts[cat] ?? { dishes: 0, included: 0 };
              return (
                <CategorySection
                  key={cat}
                  category={cat}
                  categoryItems={catItems}
                  dishCount={counts.dishes}
                  includedCount={counts.included}
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
                  onDragStart={onDragStart}
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

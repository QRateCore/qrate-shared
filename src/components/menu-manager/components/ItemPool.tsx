'use client';

import { AlertCircle, ChevronDown, Pencil, Plus, Search, Check } from 'lucide-react';
import type { MenuItemDisplay, MenuSummary } from '../../../types/restaurant';
import { type MenuColor } from '../lib/menuUtils';
import type { BulkMode, DragState } from '../MenuManagerClient';
import Button from '../../common/Button';

// ── Types ────────────────────────────────────────────────────────────────────

interface ItemPoolProps {
  items: MenuItemDisplay[];
  menus: MenuSummary[];
  filtered: MenuItemDisplay[];
  selected: Set<string>;
  search: string;
  filterTag: string;
  /**
   * Raw crawler-extracted categories for the dropdown (NOT canonical buckets).
   * Sorted alphabetically. The MenuBuilder still uses canonical categories for
   * its bucket headers.
   */
  rawCategories: string[];
  dragOver: 'pool' | null;
  dragging: DragState | null;
  editItemId: string | null;
  onSearchChange: (v: string) => void;
  onFilterChange: (v: string) => void;
  onSelectClick: (
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    itemId: string,
    listKey: string,
    orderedIds: string[],
  ) => void;
  onSelectAll: () => void;
  onClearSelect: () => void;
  onEditItem: (id: string) => void;
  onAddItem: () => void;
  visibilityFilter: 'All' | 'Visible' | 'Hidden';
  onVisibilityFilterChange: (v: 'All' | 'Visible' | 'Hidden') => void;
  itemTypeFilter: 'dishes' | 'addons';
  onItemTypeFilterChange: (v: 'dishes' | 'addons') => void;
  onOpenBulk: (mode: BulkMode) => void;
  onOpenBulkModifiers: () => void;
  onDragStart: (e: React.DragEvent, itemId: string) => void;
  onDragEnd: () => void;
  onDragEnterPool: (e: React.DragEvent) => void;
  onDragLeavePool: () => void;
  onDropPool: (e: React.DragEvent) => void;
  colorMap: (index: number) => MenuColor;
  attentionExpanded: boolean;
  onToggleAttention: () => void;
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
}) {
  const bg = isEditing
    ? 'var(--blue-bg)'
    : isSelected
      ? '#e8f0fe'
      : 'var(--white)';

  const border = isEditing || isSelected ? '1px solid var(--blue)' : '1px solid var(--border)';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, item.id)}
      onDragEnd={onDragEnd}
      data-testid={`item-card-${item.id}`}
      style={{
        background: bg,
        border,
        borderRadius: 'var(--r-xs)',
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'grab',
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
        }}
      >
        {isSelected && <Check size={11} color="white" strokeWidth={3} />}
      </button>

      {/* Thumbnail */}
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
        }}
      >
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          '🍽'
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 120,
            }}
          >
            {item.name}
          </span>
          {item.item_type === 'addon' && (
            <span
              data-testid={`addon-badge-${item.id}`}
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: '#92400e',
                background: '#fef3c7',
                borderRadius: 4,
                padding: '1px 5px',
                border: '1px solid #fde68a',
              }}
            >
              ADDON
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

        {/* Menu chips */}
        {itemMenus.length > 0 && (
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
                >
                  {menu.name}
                </span>
              );
            })}
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
        }}
      >
        <Pencil size={13} />
      </button>
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
  filterTag,
  rawCategories,
  dragOver,
  dragging,
  editItemId,
  onSearchChange,
  onFilterChange,
  onSelectClick,
  onSelectAll,
  onClearSelect,
  onEditItem,
  onAddItem,
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
  attentionExpanded,
  onToggleAttention,
}: ItemPoolProps) {
  const allSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));
  const someSelected = selected.size > 0;

  // Items needing attention: missing image or no menu assignment
  const attentionItems = items.filter(
    (item) =>
      !item.thumbnail_url ||
      !(item.menu_associations?.length),
  );

  // Map itemId → list of {menu, index} for chips
  const itemMenuMap = new Map<string, Array<{ menu: MenuSummary; index: number }>>();
  for (const item of items) {
    const assocMenuIds = new Set((item.menu_associations ?? []).map((a) => a.menu_id));
    const matched: Array<{ menu: MenuSummary; index: number }> = [];
    menus.forEach((menu, idx) => {
      if (assocMenuIds.has(menu.id)) matched.push({ menu, index: idx });
    });
    itemMenuMap.set(item.id, matched);
  }

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
      {/* Header */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>Total count of Food Items</span>
          <span data-testid="item-pool-count" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{items.length}</span>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={13} />}
          onClick={onAddItem}
          data-testid="add-item-btn"
          aria-label="Add menu item"
        >
          New Food Item
        </Button>
      </div>

      {/* Search + filter */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Category subsection */}
        <span style={{ fontSize: 11, color: 'var(--text2)' }}>List of Categories identified from your Menus:</span>
        <select
          value={filterTag}
          onChange={(e) => onFilterChange(e.target.value)}
          data-testid="item-pool-category-filter"
          aria-label="Filter by category"
          style={{
            fontSize: 12,
            color: 'var(--text)',
            background: '#f6f6f6',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xs)',
            padding: '6px 10px',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          <option value="All">All categories</option>
          {rawCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

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
        </div>

        {/* Combined filter row — item type + visibility */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          {/* Dishes / Add-ons toggle */}
          <div
            style={{
              display: 'inline-flex',
              borderRadius: 20,
              border: '1px solid var(--border)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {(['dishes', 'addons'] as const).map((tab) => (
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
                  borderRight: tab === 'dishes' ? '1px solid var(--border)' : 'none',
                  background: itemTypeFilter === tab
                    ? (tab === 'addons' ? '#f59e0b' : 'var(--brand-s)')
                    : 'var(--white)',
                  color: itemTypeFilter === tab ? 'white' : 'var(--text2)',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {tab === 'dishes' ? 'Dishes' : 'Add-ons'}
              </button>
            ))}
          </div>
          {/* Visible / Hidden toggle */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {(['Visible', 'Hidden'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`visibility-filter-${tab.toLowerCase()}`}
                onClick={() => onVisibilityFilterChange(visibilityFilter === tab ? 'All' : tab)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                  border: visibilityFilter === tab ? 'none' : '1px solid var(--border)',
                  background: visibilityFilter === tab ? 'var(--brand-s)' : 'var(--white)',
                  color: visibilityFilter === tab ? 'white' : 'var(--text2)',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
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
            fontSize: 11,
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

        {someSelected && itemTypeFilter === 'addons' && (
          <button
            type="button"
            onClick={onOpenBulkModifiers}
            data-testid="bulk-assign-modifiers-btn"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#92400e',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Assign to dishes →
          </button>
        )}
        {someSelected && itemTypeFilter === 'dishes' && (
          <button
            type="button"
            onClick={() => onOpenBulk('assign')}
            data-testid="bulk-actions-btn"
            style={{
              fontSize: 11,
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
      </div>

      {/* Drop-to-remove zone */}
      <div
        onDragEnter={onDragEnterPool}
        onDragLeave={onDragLeavePool}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropPool}
        data-testid="drop-to-remove-zone"
        style={{
          margin: '0 12px 8px',
          borderRadius: 'var(--r-xs)',
          border: `2px dashed ${dragOver === 'pool' ? 'var(--blue)' : '#ddd'}`,
          background: dragOver === 'pool' ? 'var(--blue-bg)' : 'transparent',
          padding: '8px 12px',
          fontSize: 11,
          color: dragOver === 'pool' ? 'var(--blue)' : 'var(--text2)',
          textAlign: 'center',
          transition: 'all 0.15s',
          display: dragging ? 'block' : 'none',
        }}
      >
        {dragOver === 'pool' ? '↩ Drop to remove from menu' : 'Drag here to remove from menu'}
      </div>

      {/* Item list */}
      <div
        data-testid="item-pool-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '0 12px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* Needs-attention panel */}
        {attentionItems.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <button
              type="button"
              onClick={onToggleAttention}
              data-testid="attention-toggle"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 700,
                color: '#92400e',
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: attentionExpanded ? '4px 4px 0 0' : 'var(--r-xs)',
                cursor: 'pointer',
              }}
            >
              <AlertCircle size={12} />
              <span style={{ flex: 1, textAlign: 'left' }}>
                {attentionItems.length} item{attentionItems.length !== 1 ? 's' : ''} need attention
              </span>
              <ChevronDown
                size={12}
                style={{ transition: 'transform 0.15s', transform: attentionExpanded ? 'rotate(180deg)' : 'none' }}
              />
            </button>
            {attentionExpanded && (
              <div
                style={{
                  border: '1px solid #fde68a',
                  borderTop: 'none',
                  borderRadius: '0 0 4px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                data-testid="attention-panel"
              >
                {attentionItems.map((item) => {
                  const issues: string[] = [];
                  if (!item.thumbnail_url) issues.push('No image');
                  if (!item.menu_associations?.length) issues.push('Unassigned');
                  return (
                    <div
                      key={item.id}
                      data-testid={`attention-item-${item.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        background: '#fffbeb',
                        borderBottom: '1px solid #fde68a',
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 12,
                          fontWeight: 500,
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.name}
                      </span>
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {issues.map((issue) => (
                          <span
                            key={issue}
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              color: '#92400e',
                              background: '#fde68a',
                              borderRadius: 4,
                              padding: '1px 5px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {issue}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => onEditItem(item.id)}
                        data-testid={`attention-edit-${item.id}`}
                        aria-label={`Fix ${item.name}`}
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
                        <Pencil size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
            {search || filterTag !== 'All' ? 'No items match' : 'No items yet'}
          </div>
        ) : (
          filtered.map((item) => (
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
              onEdit={onEditItem}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}
